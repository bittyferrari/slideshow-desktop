let images = [];
let idx = 0;
let timer = null;
let cfg = null;
let showingA = true;
let current = null; // { path, index }

const EFFECTS = ['fade', 'slide', 'zoom', 'wipe', 'kenburns', 'zoomout', 'pan', 'drift', 'crosszoom', 'focus'];
const el = (id) => document.getElementById(id);

// 把本機路徑轉成 file:// URL（處理 Windows 反斜線與特殊字元）
function toFileURL(p) {
  let s = p.replace(/\\/g, '/');
  if (!s.startsWith('/')) s = '/' + s; // C:/... -> /C:/...
  return 'file://' + encodeURI(s).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

function shuffleArr(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function showMessage(text) {
  const m = el('msg');
  m.textContent = text;
  m.style.display = 'flex';
}

// 挑選切換效果（random 時每次隨機挑一種）
function pickEffect() {
  let ef = cfg.effect || 'fade';
  if (ef === 'random') ef = EFFECTS[Math.floor(Math.random() * EFFECTS.length)];
  return ef;
}

let switching = false; // 防止重入：上一次切換還沒完成時忽略新的觸發

async function next() {
  if (images.length === 0 || switching) return;
  switching = true;
  try {
    const incoming = showingA ? el('slideB') : el('slideA');
    const outgoing = showingA ? el('slideA') : el('slideB');
    const img = incoming.querySelector('img');

    // 找到下一張能成功解碼的圖（壞圖自動跳過），解碼完成才開始切換，
    // 避免圖還沒好就淡入造成黑屏或閃爍
    let loaded = false;
    for (let tries = 0; tries < images.length && !loaded; tries++) {
      if (idx >= images.length) {
        if (cfg.loop) {
          idx = 0;
          if (cfg.shuffle) shuffleArr(images);
        } else {
          // 不循環：停在最後並結束
          stop();
          showMessage(window.I18N.t('msg.finished'));
          setTimeout(() => window.api.exitSlideshow(), 1500);
          return;
        }
      }
      const filePath = images[idx];
      current = { path: filePath, index: idx + 1 };
      idx++;
      img.src = toFileURL(filePath);
      try {
        await img.decode();
        loaded = true;
      } catch { /* 壞圖，試下一張 */ }
    }
    if (!loaded) return;

    // 效果套在 slide 元素上（而非舞台）：舊圖的 img 動畫在淡出期間才能無縫延續，
    // 不會因規則失效而瞬間跳回原始 transform。
    incoming.className = 'slide effect-' + pickEffect();

    // Ken Burns / 拉遠 / 漂移：隨機縮放原點，讓每張圖的移動方向不同
    const origins = ['20% 20%', '80% 20%', '20% 80%', '80% 80%', '50% 50%'];
    img.style.transformOrigin = origins[Math.floor(Math.random() * origins.length)];

    // 平移效果：隨機挑一個移動方向（左→右、右→左、上→下、下→上）
    // 平移距離也隨動態幅度 intensity 放大（基準 2.5% × 倍率）
    const pa = (2.5 * (cfg.intensity || 2)).toFixed(2);
    const panDirs = [
      [`-${pa}%, 0`, `${pa}%, 0`],
      [`${pa}%, 0`, `-${pa}%, 0`],
      [`0, -${pa}%`, `0, ${pa}%`],
      [`0, ${pa}%`, `0, -${pa}%`],
    ];
    const pd = panDirs[Math.floor(Math.random() * panDirs.length)];
    img.style.setProperty('--pf', pd[0]);
    img.style.setProperty('--pt', pd[1]);

    // in→out 在同一次樣式計算內完成，且 .in/.out 的 img 動畫宣告相同 → 動畫不中斷
    outgoing.classList.remove('in');
    outgoing.classList.add('out');
    void incoming.offsetWidth; // 強制重排：此刻 incoming 無 in/out，動畫歸零以便重新觸發
    incoming.classList.add('in');
    showingA = !showingA;

    if (infoVisible) updateInfo();
  } finally {
    switching = false;
  }
}

// 自排程計時：這張播完才排下一張。
// 不用 setInterval——它在系統卡頓後會「補發」積欠的回呼，造成連切兩張的閃爍。
let stopped = false;

async function tick() {
  await next();
  if (!stopped) timer = setTimeout(tick, cfg.intervalMs);
}

function start() {
  if (images.length === 0) {
    showMessage(window.I18N.t('msg.noImages'));
    return;
  }
  stopped = false;
  tick();
}

function stop() {
  stopped = true;
  if (timer) { clearTimeout(timer); timer = null; }
}

// ---- 圖片資訊面板（移動滑鼠顯示路徑 + 檔案資訊）----
let infoVisible = false;
let infoTimer = null;
let lastMouse = null;
const fileInfoCache = new Map();

function formatSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}

async function updateInfo() {
  if (!current) return;
  const parts = current.path.split(/[\\/]/).filter(Boolean);
  const name = parts[parts.length - 1];
  el('info-name').textContent = name;
  // 只顯示 上層資料夾\檔名（若無上層則只顯示檔名）
  el('info-path').textContent = parts.length > 1
    ? parts[parts.length - 2] + '\\' + name
    : name;

  let meta = current.index ? `${current.index} / ${images.length}` : '';
  const img = wallHeroImg || (showingA ? el('slideA') : el('slideB')).querySelector('img');
  if (img.naturalWidth) meta += `　${img.naturalWidth} × ${img.naturalHeight}`;

  let fi = fileInfoCache.get(current.path);
  if (fi === undefined) {
    fi = await window.api.fileInfo(current.path);
    fileInfoCache.set(current.path, fi);
  }
  if (fi) meta += `　${formatSize(fi.size)}　${new Date(fi.mtime).toLocaleString()}`;
  el('info-meta').textContent = meta;
}

function showInfo() {
  infoVisible = true;
  el('info').classList.add('visible');
  document.body.classList.add('show-cursor');
  updateInfo();
  clearTimeout(infoTimer);
  infoTimer = setTimeout(hideInfo, 2500);
}

function hideInfo() {
  infoVisible = false;
  el('info').classList.remove('visible');
  document.body.classList.remove('show-cursor');
}

document.addEventListener('mousemove', (e) => {
  // 忽略載入時系統自動觸發的第一次 mousemove
  if (!lastMouse) { lastMouse = [e.screenX, e.screenY]; return; }
  const moved = Math.abs(e.screenX - lastMouse[0]) + Math.abs(e.screenY - lastMouse[1]);
  lastMouse = [e.screenX, e.screenY];
  if (moved === 0) return;
  showInfo();
});

// ---- 退出方式 ----
// 任何滑鼠或鍵盤按鍵按一下即退出
function exitNow(e) {
  if (e) e.preventDefault();
  wallStopped = true;
  window.api.exitSlideshow();
}
document.addEventListener('mousedown', exitNow);
document.addEventListener('keydown', exitNow);

// 幾秒後把提示淡出
setTimeout(() => {
  const h = el('hint');
  if (h) h.classList.add('hidden');
}, 4000);

// ==================== Pinterest 圖牆模式 ====================
// 流程：滿版磚牆顯示很多張圖 → 隔幾秒整個畫面變暗 →
//       其中一張慢慢提高亮度 → 放大成大圖停留 → 收回圖牆 → 重複。
let wallMode = false;
let wallStopped = false;
let wallTiles = [];      // { box, img }
let wallHeroImg = null;  // 目前大圖對應的 <img>（給資訊面板用）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 依序取下一張圖片路徑（走完一輪視設定決定是否重新洗牌／結束）
function nextImagePath() {
  if (images.length === 0) return null;
  if (idx >= images.length) {
    if (!cfg.loop) return null;
    idx = 0;
    if (cfg.shuffle) shuffleArr(images);
  }
  return images[idx++];
}

// 依視窗寬度決定欄數（越寬欄數越多，維持類似 Pinterest 的密度）
function wallColumns() {
  const target = 300; // 每欄約略寬度
  return Math.max(3, Math.min(8, Math.round(window.innerWidth / target)));
}

function makeTile(path) {
  const box = document.createElement('div');
  box.className = 'tile';
  const img = document.createElement('img');
  img.src = toFileURL(path);
  img.dataset.path = path;
  img.addEventListener('load', () => box.classList.add('shown'));
  img.addEventListener('error', () => box.remove());
  box.appendChild(img);
  return { box, img };
}

// 建立整面圖牆
function buildWall() {
  const wall = el('wall');
  wall.innerHTML = '';
  wallTiles = [];
  const cols = wallColumns();
  document.documentElement.style.setProperty('--wall-cols', String(cols));
  const count = Math.min(images.length, cols * 6);
  for (let i = 0; i < count; i++) {
    const p = nextImagePath();
    if (!p) break;
    const t = makeTile(p);
    wall.appendChild(t.box);
    wallTiles.push(t);
    setTimeout(() => t.box.classList.add('shown'), 60 * i); // 交錯淡入
  }
}

// 替換掉部分磚塊，讓圖牆持續有新圖出現
function refreshTiles(n) {
  const wall = el('wall');
  for (let k = 0; k < n; k++) {
    if (wallTiles.length === 0) return;
    const i = Math.floor(Math.random() * wallTiles.length);
    const old = wallTiles[i];
    const p = nextImagePath();
    if (!p) return;
    old.box.classList.remove('shown');
    setTimeout(() => {
      const t = makeTile(p);
      if (old.box.parentNode === wall) wall.replaceChild(t.box, old.box);
      else wall.appendChild(t.box);
      wallTiles[i] = t;
    }, 700);
  }
}

// 把某張磚塊的圖飛出來變成大圖
function heroOpen(tileImg) {
  const hero = el('hero');
  const h = el('heroImg');
  const r = tileImg.getBoundingClientRect();
  h.classList.remove('breathe');
  h.src = tileImg.src;
  h.style.transition = 'none';
  h.style.left = r.left + 'px';
  h.style.top = r.top + 'px';
  h.style.width = r.width + 'px';
  h.style.height = r.height + 'px';
  void h.offsetWidth;
  h.style.transition = '';
  hero.classList.add('on');

  const nw = tileImg.naturalWidth || r.width;
  const nh = tileImg.naturalHeight || r.height;
  const s = Math.min((window.innerWidth * 0.86) / nw, (window.innerHeight * 0.88) / nh);
  const w = nw * s, ht = nh * s;
  h.style.left = ((window.innerWidth - w) / 2) + 'px';
  h.style.top = ((window.innerHeight - ht) / 2) + 'px';
  h.style.width = w + 'px';
  h.style.height = ht + 'px';
}

// 大圖收回原本磚塊的位置
function heroClose(tileImg) {
  const h = el('heroImg');
  h.classList.remove('breathe');
  const r = tileImg.getBoundingClientRect();
  h.style.left = r.left + 'px';
  h.style.top = r.top + 'px';
  h.style.width = r.width + 'px';
  h.style.height = r.height + 'px';
  el('hero').classList.remove('on');
}

async function wallLoop() {
  const base = cfg.intervalMs || 4000;
  const wallHold = Math.max(2500, base);        // 圖牆停留
  const spotMs = 1600;                          // 慢慢提高亮度
  const flyMs = 900;                            // 放大／收回
  const bigHold = Math.max(3000, base * 1.5);   // 大圖停留

  while (!wallStopped) {
    await sleep(wallHold);
    if (wallStopped) return;

    // 挑一張已載入完成的磚塊
    const cands = wallTiles.filter((t) => t.box.classList.contains('shown') && t.img.naturalWidth);
    if (cands.length === 0) { await sleep(600); continue; }
    const pick = cands[Math.floor(Math.random() * cands.length)];

    // 1) 畫面變暗
    el('wall').classList.add('dimmed');
    await sleep(900);
    if (wallStopped) return;

    // 2) 那張慢慢提高亮度
    pick.box.classList.add('spot');
    wallHeroImg = pick.img;
    current = { path: pick.img.dataset.path, index: 0 };
    if (infoVisible) updateInfo();
    await sleep(spotMs);
    if (wallStopped) return;

    // 3) 顯示這張大圖
    heroOpen(pick.img);
    await sleep(flyMs);
    el('heroImg').classList.add('breathe');
    await sleep(bigHold);
    if (wallStopped) return;

    // 4) 收回圖牆，回復亮度
    heroClose(pick.img);
    await sleep(flyMs);
    pick.box.classList.remove('spot');
    el('wall').classList.remove('dimmed');
    wallHeroImg = null;

    // 5) 換上一些新圖，讓牆面持續更新
    refreshTiles(Math.max(2, Math.round(wallTiles.length / 5)));
    await sleep(600);
  }
}

function wallStart() {
  if (images.length === 0) {
    showMessage(window.I18N.t('msg.noImages'));
    return;
  }
  wallMode = true;
  wallStopped = false;
  document.body.classList.add('wall-mode');
  buildWall();
  wallLoop();
}

// 視窗大小改變時重算欄數
window.addEventListener('resize', () => {
  if (wallMode) document.documentElement.style.setProperty('--wall-cols', String(wallColumns()));
});

// 接收主行程送來的設定並開始
window.api.onConfig(async (config) => {
  cfg = config;
  // 套用語言（由設定頁傳入），並翻譯畫面上的提示文字
  window.I18N.setLang(cfg.lang || navigator.language || window.I18N.DEFAULT_LANG);
  window.I18N.apply();
  // 舊設定相容：fade 布林 → effect
  if (!cfg.effect) cfg.effect = cfg.fade === false ? 'none' : 'fade';

  const dur = cfg.effect === 'none' ? 0 : 700;
  const root = document.documentElement.style;
  root.setProperty('--dur', dur + 'ms');
  root.setProperty('--kb-dur', (cfg.intervalMs + dur) + 'ms');
  root.setProperty('--scale-mode', cfg.scaleMode || 'contain');
  // 動態幅度倍率：控制縮放／平移／旋轉的移動量（預設 2）
  root.setProperty('--i', String(cfg.intensity || 2));

  images = await window.api.listImages(config.dir, config.recursive);
  if (config.shuffle) shuffleArr(images);
  idx = 0;
  // Pinterest 圖牆模式走另一條播放流程
  if (cfg.effect === 'wall') wallStart();
  else start();
});
