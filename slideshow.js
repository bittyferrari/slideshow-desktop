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
//       其中一張慢慢提高亮度 → 放大成大圖停留 → 收回。
//       一輪可聚焦多張，一輪結束後依設定比例換掉舊圖，持續循環。
//
// 版面：自製 masonry。每塊磚絕對定位、用 transform 決定位置，高度依圖片原始
// 比例算好；圖片一律先 decode 完成才進場，所以不會有「載入後把版面撐開」的跳動。
// 換圖有兩種方式：
//   fade — 原地淡出換圖再淡入（磚塊高度不變）
//   push — 移除那張，同一欄下面的往上推補位，欄底再補上新圖
let wallMode = false;
let wallStopped = false;
let wallTiles = [];      // 所有磚塊（扁平）
let wallCols = [];       // 每一欄的磚塊陣列
let wallColH = [];       // 每一欄目前的高度
let wallColW = 0;        // 欄寬
let wallH = 0;           // 可視高度
let wallHeroImg = null;  // 目前大圖對應的 <img>（給資訊面板用）
let W = null;            // 圖牆各項設定（由 cfg 展開，含預設值）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

// 把設定攤平成圖牆用的參數（未設定時給預設值）
function wallSettings() {
  return {
    cols: num(cfg.wallCols, 6),                       // 0 = 自動
    gap: num(cfg.wallGap, 10),                        // px
    radius: num(cfg.wallRadius, 20),                  // px
    rows: num(cfg.wallRows, 8),                       // 每欄大約幾張（張數上限用）
    staggerMs: num(cfg.wallStaggerMs, 60),            // 逐張顯示的間隔
    holdMs: num(cfg.wallHoldMs, 1000),                // 圖牆停留
    dim: num(cfg.wallDim, 40) / 100,                  // 變暗後亮度
    dimMs: num(cfg.wallDimMs, 500),                   // 變暗過程
    spotMs: num(cfg.wallSpotMs, 800),                // 慢慢提高亮度
    flyMs: num(cfg.wallFlyMs, 1000),                   // 放大／收回
    bigMs: num(cfg.wallBigMs, 3000),// 大圖停留
    bigScale: num(cfg.wallBigScale, 100) / 100,        // 大圖占畫面比例
    spots: Math.max(1, num(cfg.wallSpots, 2)),        // 一輪聚焦幾張
    replacePct: num(cfg.wallReplacePct, 80),          // 一輪換掉幾 % 的圖
    swap: cfg.wallSwapMode || 'push',                 // 換圖方式 fade / push
    pushMs: num(cfg.wallPushMs, 4000),                 // 往上推的動畫時間
  };
}

function applyWallVars() {
  const r = document.documentElement.style;
  r.setProperty('--wall-gap', W.gap + 'px');
  r.setProperty('--wall-radius', W.radius + 'px');
  r.setProperty('--wall-dim', String(W.dim));
  r.setProperty('--dim-ms', W.dimMs + 'ms');
  r.setProperty('--spot-ms', W.spotMs + 'ms');
  r.setProperty('--fly-ms', W.flyMs + 'ms');
  r.setProperty('--push-ms', W.pushMs + 'ms');
  r.setProperty('--tile-ms', Math.max(300, Math.round(W.dimMs * 0.8)) + 'ms');
  r.setProperty('--breathe-ms', Math.max(4000, W.bigMs * 2) + 'ms');
}

// 依序取下一張圖片路徑（走完一輪視設定決定是否重新洗牌）
function nextImagePath() {
  if (images.length === 0) return null;
  if (idx >= images.length) {
    if (!cfg.loop) return null;
    idx = 0;
    if (cfg.shuffle) shuffleArr(images);
  }
  return images[idx++];
}

// 自動欄數：依視窗寬度決定（每欄約 300px）
function autoColumns() {
  return Math.max(3, Math.min(10, Math.round(window.innerWidth / 300)));
}

function currentCols() {
  return W.cols > 0 ? W.cols : autoColumns();
}

// 先把圖片解碼完成（拿到真實寬高）才回傳；壞圖回傳 null
function preload(path) {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = toFileURL(path);
    const done = async () => {
      try { await img.decode(); } catch { return resolve(null); }
      if (!img.naturalWidth) return resolve(null);
      resolve({ path, img, w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onload = done;
    img.onerror = () => resolve(null);
    if (img.complete) done();
  });
}

// 併發載入 n 張可用的圖（自動跳過壞圖），全部 decode 完成才回傳
async function preloadMany(n, concurrency = 6) {
  const out = [];
  let exhausted = false;
  async function worker() {
    while (out.length < n && !exhausted && !wallStopped) {
      const p = nextImagePath();
      if (!p) { exhausted = true; return; }
      const r = await preload(p);
      if (r && out.length < n) out.push(r);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, n)) }, worker));
  return out;
}

// ---- 版面：絕對定位的 masonry ----
function tileX(c) { return c * (wallColW + W.gap); }

function place(t, animate) {
  if (!animate) {
    t.box.style.transition = 'none';
    t.box.style.transform = `translate3d(${tileX(t.col)}px, ${t.y}px, 0)`;
    void t.box.offsetWidth;
    t.box.style.transition = '';
  } else {
    t.box.style.transform = `translate3d(${tileX(t.col)}px, ${t.y}px, 0)`;
  }
}

// 重排某一欄（由上往下重新堆疊）→ 移除一張後下面的會往上推
function relayoutColumn(c, animate = true) {
  let y = 0;
  for (const t of wallCols[c]) {
    t.y = y;
    t.col = c;
    place(t, animate);
    y += t.h + W.gap;
  }
  wallColH[c] = y;
}

function shortestCol() {
  let best = 0;
  for (let c = 1; c < wallColH.length; c++) if (wallColH[c] < wallColH[best]) best = c;
  return best;
}

// 在指定欄的最底部加一塊磚
function addTile(c, loaded) {
  const h = Math.round(wallColW * (loaded.h / loaded.w));
  const box = document.createElement('div');
  box.className = 'tile';
  box.style.width = wallColW + 'px';
  box.style.height = h + 'px';
  const inner = document.createElement('div');
  inner.className = 'tile-inner';
  loaded.img.dataset.path = loaded.path;
  inner.appendChild(loaded.img);
  box.appendChild(inner);

  const t = { box, img: loaded.img, col: c, y: wallColH[c], h };
  el('wallInner').appendChild(box);
  place(t, false); // 首次定位不做動畫
  wallCols[c].push(t);
  wallColH[c] += h + W.gap;
  wallTiles.push(t);
  return t;
}

function removeTile(t) {
  const list = wallCols[t.col];
  const i = list.indexOf(t);
  if (i >= 0) list.splice(i, 1);
  const j = wallTiles.indexOf(t);
  if (j >= 0) wallTiles.splice(j, 1);
  t.box.classList.add('gone');
  setTimeout(() => t.box.remove(), W.pushMs + 200);
}

// 建立整面圖牆：全部載入完成 → 算好位置 → 一張張顯示
async function buildWall() {
  const wall = el('wall');
  wall.innerHTML = '<div id="wallInner"></div>';
  wallTiles = [];

  const cols = currentCols();
  const rect = wall.getBoundingClientRect();
  const innerW = rect.width - W.gap * 2;
  wallH = rect.height - W.gap * 2;
  wallColW = Math.floor((innerW - W.gap * (cols - 1)) / cols);
  wallCols = Array.from({ length: cols }, () => []);
  wallColH = new Array(cols).fill(0);

  // 每欄填到超出畫面一些（下方留有備援磚塊，往上推時才有東西補進來）
  const target = wallH * 1.25;
  const cap = Math.max(cols, Math.round(cols * W.rows));
  const created = [];
  while (!wallStopped && wallTiles.length < cap) {
    if (wallColH[shortestCol()] >= target) break;
    const batch = await preloadMany(Math.min(cols, cap - wallTiles.length));
    if (batch.length === 0) break;
    for (const ld of batch) created.push(addTile(shortestCol(), ld));
  }
  if (wallStopped) return;

  // 短時間一張一張顯示（只動 opacity，不影響版面）
  created.forEach((t, i) => setTimeout(() => t.box.classList.add('shown'), W.staggerMs * i));
  await sleep(W.staggerMs * created.length + 400);
}

// ---- 換圖方式 A：原地淡出／淡入（磚塊高度不變）----
async function replaceFade(picks, loaded) {
  picks.forEach((t, k) => setTimeout(() => t.box.classList.remove('shown'), W.staggerMs * k));
  await sleep(W.staggerMs * picks.length + Math.max(400, W.dimMs * 0.8));
  if (wallStopped) return;

  const done = [];
  picks.forEach((t, k) => {
    const nd = loaded[k];
    if (!nd) return;
    nd.img.dataset.path = nd.path;
    t.box.querySelector('.tile-inner').replaceChild(nd.img, t.img);
    t.img = nd.img;
    done.push(t);
  });
  done.forEach((t, k) => setTimeout(() => t.box.classList.add('shown'), W.staggerMs * k));
  await sleep(W.staggerMs * done.length + 400);
}

// ---- 換圖方式 B：移除 → 下面的往上推 → 欄底補新圖 ----
function pushOne(t, loaded) {
  const c = t.col;
  removeTile(t);
  relayoutColumn(c, true);      // 同一欄下面的磚塊往上推補位
  const nt = addTile(c, loaded); // 欄底補上新圖（從畫面下緣進場）
  requestAnimationFrame(() => nt.box.classList.add('shown'));
}

async function replacePush(picks, loaded) {
  const step = Math.max(90, W.staggerMs * 2);
  for (let k = 0; k < picks.length && !wallStopped; k++) {
    if (!loaded[k]) break;
    pushOne(picks[k], loaded[k]);
    await sleep(step);
  }
  await sleep(W.pushMs);
  await topUpColumns();
}

// 新圖比例跟舊圖不同，欄底可能露出空白 → 補到超出畫面為止
async function topUpColumns() {
  const target = wallH * 1.15;
  const cap = Math.max(wallCols.length, Math.round(wallCols.length * W.rows * 1.5));
  while (!wallStopped && wallTiles.length < cap) {
    const short = wallColH.map((h, c) => (h < target ? c : -1)).filter((c) => c >= 0);
    if (short.length === 0) return;
    const batch = await preloadMany(short.length);
    if (batch.length === 0) return;
    for (const ld of batch) {
      const t = addTile(shortestCol(), ld);
      requestAnimationFrame(() => t.box.classList.add('shown'));
    }
  }
}

// 一輪結束後換掉一定比例的舊圖：新圖先在背景載入完成，才開始動
async function replaceTiles(pct) {
  const n = Math.min(wallTiles.length, Math.round(wallTiles.length * (pct / 100)));
  if (n <= 0) return;

  const order = wallTiles.slice();
  shuffleArr(order);
  const picks = order.slice(0, n);

  const loaded = await preloadMany(picks.length);
  if (wallStopped || loaded.length === 0) return;

  if (W.swap === 'fade') await replaceFade(picks, loaded);
  else await replacePush(picks, loaded);
}

// 把某張磚塊的圖飛出來變成大圖。
// 起點用「完整圖片在該磚塊裁切前的虛擬矩形」，讓大圖是從那張圖長出來的，不會變形。
function tileFullRect(tileImg) {
  const r = tileImg.getBoundingClientRect();
  const nw = tileImg.naturalWidth || r.width;
  const nh = tileImg.naturalHeight || r.height;
  const s = Math.max(r.width / nw, r.height / nh); // object-fit: cover
  const w = nw * s, h = nh * s;
  return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h, nw, nh };
}

function setRect(h, r) {
  h.style.left = r.left + 'px';
  h.style.top = r.top + 'px';
  h.style.width = r.width + 'px';
  h.style.height = r.height + 'px';
}

function heroOpen(tileImg) {
  const hero = el('hero');
  const h = el('heroImg');
  const from = tileFullRect(tileImg);
  h.classList.remove('breathe');
  h.src = tileImg.src;
  h.style.transition = 'none';
  setRect(h, from);
  void h.offsetWidth;
  h.style.transition = '';
  hero.classList.add('on');

  const s = Math.min((window.innerWidth * W.bigScale) / from.nw, (window.innerHeight * W.bigScale) / from.nh);
  const w = from.nw * s, ht = from.nh * s;
  setRect(h, { left: (window.innerWidth - w) / 2, top: (window.innerHeight - ht) / 2, width: w, height: ht });
}

// 大圖收回原本磚塊的位置
function heroClose(tileImg) {
  const h = el('heroImg');
  h.classList.remove('breathe');
  setRect(h, tileFullRect(tileImg));
  el('hero').classList.remove('on');
}

// 聚焦一張：提高亮度 → 放大成大圖 → 停留 → 收回
async function spotlightOne() {
  // 只挑看得到的（完全在畫面外的備援磚塊不參加）
  const visible = (t) => t.box.classList.contains('shown') && t.img.naturalWidth && t.y < wallH;
  const cands = wallTiles.filter((t) => visible(t) && !t.box.classList.contains('used'));
  const pool = cands.length ? cands : wallTiles.filter(visible);
  if (pool.length === 0) { await sleep(600); return; }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  pick.box.classList.add('used');

  pick.box.classList.add('spot');
  wallHeroImg = pick.img;
  current = { path: pick.img.dataset.path, index: 0 };
  if (infoVisible) updateInfo();
  await sleep(W.spotMs);
  if (wallStopped) return;

  heroOpen(pick.img);
  await sleep(W.flyMs);
  el('heroImg').classList.add('breathe');
  await sleep(W.bigMs);
  if (wallStopped) return;

  heroClose(pick.img);
  await sleep(W.flyMs);
  pick.box.classList.remove('spot');
  wallHeroImg = null;
}

async function wallLoop() {
  while (!wallStopped) {
    // 1) 圖牆停留
    await sleep(W.holdMs);
    if (wallStopped) return;

    // 2) 畫面變暗
    el('wall').classList.add('dimmed');
    await sleep(W.dimMs);
    if (wallStopped) return;

    // 3) 一輪聚焦 N 張
    for (let i = 0; i < W.spots && !wallStopped; i++) {
      await spotlightOne();
      if (i < W.spots - 1) await sleep(Math.round(W.dimMs / 2));
    }
    if (wallStopped) return;

    // 4) 回復亮度
    el('wall').classList.remove('dimmed');
    await sleep(W.dimMs);
    if (wallStopped) return;

    // 5) 一輪結束：依比例換掉舊圖
    wallTiles.forEach((t) => t.box.classList.remove('used'));
    await replaceTiles(W.replacePct);
  }
}

async function wallStart() {
  if (images.length === 0) {
    showMessage(window.I18N.t('msg.noImages'));
    return;
  }
  wallMode = true;
  wallStopped = false;
  W = wallSettings();
  applyWallVars();
  document.body.classList.add('wall-mode');
  await buildWall();
  if (!wallStopped) wallLoop();
}

// 視窗大小改變時重建圖牆（欄寬變了，高度要重算）
let resizeTimer = null;
window.addEventListener('resize', () => {
  if (!wallMode) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (!wallStopped) buildWall(); }, 400);
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
