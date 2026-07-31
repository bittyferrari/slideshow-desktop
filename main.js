const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// 支援的圖片副檔名
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

let settingsWin = null;
let slideshowWin = null;

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

  // 頁面載入完成後把設定傳過去
  slideshowWin.webContents.once('did-finish-load', () => {
    slideshowWin.webContents.send('slideshow-config', config);
  });

  if (settingsWin) settingsWin.hide();

  slideshowWin.on('closed', () => {
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

// 由播放頁請求退出 slideshow
ipcMain.handle('exit-slideshow', async () => {
  if (slideshowWin) {
    slideshowWin.close();
    slideshowWin = null;
  }
});
