const { app, BrowserWindow, ipcMain, dialog, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');

// 支援的圖片副檔名
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

let settingsWin = null;
let slideshowWin = null;

// 播放期間避免螢幕關閉 / 電腦睡眠（'prevent-display-sleep' 同時會阻止系統睡眠）
let sleepBlockerId = null;
function preventSleep() {
  if (sleepBlockerId !== null && powerSaveBlocker.isStarted(sleepBlockerId)) return;
  sleepBlockerId = powerSaveBlocker.start('prevent-display-sleep');
}
function allowSleep() {
  if (sleepBlockerId !== null && powerSaveBlocker.isStarted(sleepBlockerId)) {
    powerSaveBlocker.stop(sleepBlockerId);
  }
  sleepBlockerId = null;
}

// 設定檔路徑（存於使用者資料夾，不會被程式更新覆蓋）
function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'));
  } catch (e) {
    return {};
  }
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
    return true;
  } catch (e) {
    return false;
  }
}

function createSettingsWindow() {
  settingsWin = new BrowserWindow({
    width: 480,
    height: 860,
    resizable: false,
    title: 'Slideshow 設定',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile('index.html');
  settingsWin.on('closed', () => { settingsWin = null; });
}

app.whenReady().then(() => {
  createSettingsWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createSettingsWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 讀取 / 寫入設定
ipcMain.handle('load-settings', async () => loadSettings());
ipcMain.handle('save-settings', async (_evt, settings) => saveSettings(settings));

// 開啟目錄選擇對話框
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(settingsWin, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// 遞迴/單層讀取目錄內的圖片
ipcMain.handle('list-images', async (_evt, dirPath, recursive) => {
  const images = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (recursive) walk(full);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (IMAGE_EXTS.includes(ext)) images.push(full);
      }
    }
  }
  walk(dirPath);
  return images;
});

// 啟動 slideshow：開一個全螢幕視窗
ipcMain.handle('start-slideshow', async (_evt, config) => {
  if (slideshowWin) {
    slideshowWin.close();
    slideshowWin = null;
  }
  slideshowWin = new BrowserWindow({
    fullscreen: true,
    frame: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  slideshowWin.setMenuBarVisibility(false);
  slideshowWin.loadFile('slideshow.html');
  preventSleep();

  // 頁面載入完成後把設定傳過去
  slideshowWin.webContents.once('did-finish-load', () => {
    slideshowWin.webContents.send('slideshow-config', config);
  });

  if (settingsWin) settingsWin.hide();

  const thisWin = slideshowWin;
  slideshowWin.on('closed', () => {
    if (slideshowWin !== thisWin) return; // 已被新的播放視窗取代
    allowSleep();
    slideshowWin = null;
    if (settingsWin) settingsWin.show();
  });
});

// 取得單一檔案的資訊（大小、修改時間）
ipcMain.handle('file-info', async (_evt, filePath) => {
  try {
    const st = fs.statSync(filePath);
    return { size: st.size, mtime: st.mtimeMs };
  } catch (e) {
    return null;
  }
});

// ---- 拍攝日期（時間軸模式用）----
// 不用任何套件：只讀檔案開頭 128KB，從 JPEG 的 EXIF（APP1）找 DateTimeOriginal，
// 找不到再用 DateTimeDigitized、IFD0 的 DateTime；都沒有（或非 JPEG）就用檔案修改時間。
const exifDateCache = new Map();

function exifToMs(s) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s || '');
  if (!m || m[1] === '0000') return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function parseTiffDate(b, t, end) {
  const le = b.toString('ascii', t, t + 2) === 'II';
  const u16 = (o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const readIfd = (off) => {
    const tags = {};
    const base = t + off;
    if (off <= 0 || base + 2 > end) return tags;
    const n = u16(base);
    for (let i = 0; i < n; i++) {
      const e = base + 2 + i * 12;
      if (e + 12 > end) break;
      tags[u16(e)] = { type: u16(e + 2), cnt: u32(e + 4), at: e + 8 };
    }
    return tags;
  };
  const str = (ent) => {
    if (!ent || ent.type !== 2) return null;
    const o = ent.cnt <= 4 ? ent.at : t + u32(ent.at);
    if (o + ent.cnt > end) return null;
    return b.toString('ascii', o, o + ent.cnt).replace(/\0[\s\S]*$/, '');
  };
  const ifd0 = readIfd(u32(t + 4));
  let s = null;
  if (ifd0[0x8769]) {
    const exif = readIfd(u32(ifd0[0x8769].at));
    s = exifToMs(str(exif[0x9003])) || exifToMs(str(exif[0x9004]));
  }
  return s || exifToMs(str(ifd0[0x0132]));
}

function parseExifDate(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let p = 2;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) return null;
    const marker = b[p + 1];
    if (marker === 0xd9 || marker === 0xda) return null; // 影像資料開始了，不會再有 EXIF
    const len = b.readUInt16BE(p + 2);
    if (marker === 0xe1 && b.toString('ascii', p + 4, p + 10) === 'Exif\0\0') {
      try { return parseTiffDate(b, p + 10, Math.min(b.length, p + 2 + len)); } catch (e) { return null; }
    }
    p += 2 + len;
  }
  return null;
}

async function photoDate(file) {
  if (exifDateCache.has(file)) return exifDateCache.get(file);
  let t = null;
  let fh = null;
  try {
    fh = await fs.promises.open(file, 'r');
    const buf = Buffer.alloc(131072);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    t = parseExifDate(buf.subarray(0, bytesRead));
  } catch (e) { t = null; }
  finally { if (fh) await fh.close().catch(() => {}); }
  let r;
  if (t) r = { t, exif: true };
  else {
    try { r = { t: fs.statSync(file).mtimeMs, exif: false }; } catch (e) { r = { t: 0, exif: false }; }
  }
  exifDateCache.set(file, r);
  return r;
}

// 一次查一批檔案的拍攝日期（併發 8 個）
ipcMain.handle('photo-dates', async (_evt, files) => {
  const out = new Array(files.length);
  let i = 0;
  async function worker() {
    while (i < files.length) {
      const k = i++;
      out[k] = await photoDate(files[k]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, files.length) }, worker));
  return out;
});

// 由播放頁請求退出 slideshow
ipcMain.handle('exit-slideshow', async () => {
  if (slideshowWin) {
    slideshowWin.close();
    slideshowWin = null;
  }
});
