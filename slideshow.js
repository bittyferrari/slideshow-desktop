let images = [];
let idx = 0;
let timer = null;
let cfg = null;
let showingA = true;
let current = null; // { path, index }

const EFFECTS = window.FX.EFFECTS;
let FXS = null;              // 各效果的專屬設定（由 cfg.fx 正規化而來）
const fxOf = (name) => (FXS && FXS[name]) || {};
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

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const numv = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

// 把某個效果的設定換算成 CSS 變數。
//   incoming / outgoing：進場、退場的 slide 元素（負責進出場動畫的變數）
//   img：進場那張圖（負責慢動作類的變數；寫在 img 上，才不會蓋掉舊圖正在跑的動畫）
function applyEffectVars(ef, incoming, outgoing, img) {
  const f = fxOf(ef);
  const dur = ef === 'none' ? 0 : numv(f.durMs, 700);
  const S = incoming.style, O = outgoing.style, I = img.style;

  S.setProperty('--dur', dur + 'ms');
  O.setProperty('--dur', dur + 'ms');
  if (f.ease) { S.setProperty('--ease', f.ease); O.setProperty('--ease', f.ease); }

  // 慢動作（Ken Burns 類）總長度 = 這張的停留時間 + 進場時間
  I.setProperty('--kb-dur', (cfg.intervalMs + dur) + 'ms');

  // 縮放原點：隨機讓每張圖的移動方向不同，或固定置中
  const origins = ['20% 20%', '80% 20%', '20% 80%', '80% 80%', '50% 50%'];
  img.style.transformOrigin = f.origin === 'center' ? '50% 50%' : rand(origins);

  const dirOf = (d) => (d && d !== 'random' ? d : rand(['left', 'right', 'up', 'down']));
  const z = (v, d) => String(numv(v, d) / 100);

  switch (ef) {
    case 'slide': {
      // 新圖從一側滑入，舊圖往同方向滑出
      const map = {
        left:  ['100%, 0', '-100%, 0'],
        right: ['-100%, 0', '100%, 0'],
        up:    ['0, 100%', '0, -100%'],
        down:  ['0, -100%', '0, 100%'],
      };
      const [sf, st] = map[dirOf(f.dir)];
      S.setProperty('--sf', sf); S.setProperty('--st', st);
      O.setProperty('--st', st);
      break;
    }
    case 'wipe': {
      // clip-path 的起始 inset（top right bottom left）決定往哪個方向揭開
      const map = {
        right: '0 100% 0 0',
        left:  '0 0 0 100%',
        up:    '100% 0 0 0',
        down:  '0 0 100% 0',
      };
      S.setProperty('--wipe', map[dirOf(f.dir)]);
      break;
    }
    case 'zoom':
      S.setProperty('--zin', z(f.zoomFrom, 120));
      break;
    case 'kenburns':
    case 'zoomout':
      I.setProperty('--z0', z(f.zoomFrom, 100));
      I.setProperty('--z1', z(f.zoomTo, 118));
      break;
    case 'pan': {
      const dist = numv(f.dist, 5).toFixed(2);
      const axis = f.axis && f.axis !== 'random' ? f.axis : rand(['h', 'v']);
      const pd = rand(axis === 'h'
        ? [[`-${dist}%, 0`, `${dist}%, 0`], [`${dist}%, 0`, `-${dist}%, 0`]]
        : [[`0, -${dist}%`, `0, ${dist}%`], [`0, ${dist}%`, `0, -${dist}%`]]);
      I.setProperty('--z0', z(f.zoom, 122));
      I.setProperty('--pf', pd[0]);
      I.setProperty('--pt', pd[1]);
      break;
    }
    case 'drift':
      I.setProperty('--z0', z(f.zoomFrom, 106));
      I.setProperty('--z1', z(f.zoomTo, 116));
      I.setProperty('--rot', numv(f.rotate, 1.6) + 'deg');
      break;
    case 'crosszoom':
      S.setProperty('--czi', z(f.zoomFrom, 86));
      S.setProperty('--czo', z(f.zoomTo, 120));
      O.setProperty('--czo', z(f.zoomTo, 120));
      I.setProperty('--z0', '1');
      I.setProperty('--z1', z(f.slowZoom, 118));
      break;
    case 'focus':
      I.setProperty('--blur', numv(f.blur, 14) + 'px');
      I.setProperty('--fdur', numv(f.focusMs, 2100) + 'ms');
      I.setProperty('--z0', z(f.zoomFrom, 106));
      break;
  }
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
    const ef = pickEffect();
    incoming.className = 'slide effect-' + ef;

    // 依「這個效果自己的設定」把 CSS 變數寫進 inline style
    applyEffectVars(ef, incoming, outgoing, img);

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
  if (img && img.naturalWidth) meta += `　${img.naturalWidth} × ${img.naturalHeight}`;

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
// 任何滑鼠或鍵盤按鍵按一下即退出（wallStopped 也是輪盤模式的停止旗標）
function exitNow(e) {
  if (e) e.preventDefault();
  wallStopped = true;
  if (typeof reelAnim !== 'undefined' && reelAnim) reelAnim.pause();
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
// 版面：自製 masonry。每塊磚絕對定位、用 transform 決定位置。
// 效能：磚塊放的是 <canvas> 縮圖（原圖用完即釋放），變暗用單一全域黑幕，
//       大圖只動 transform，所以在低階機器上也能維持流暢。
let wallMode = false;
let wallStopped = false;
let wallTiles = [];      // 所有磚塊（扁平）
let wallCols = [];       // 每一欄的磚塊陣列
let wallColH = [];       // 每一欄目前的高度
let wallColW = 0;        // 欄寬
let wallThumbW = 0;      // 縮圖的實際像素寬
let wallH = 0;           // 可視高度
let wallHeroImg = null;  // 目前大圖（給資訊面板取尺寸用）
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
    spotMs: num(cfg.wallSpotMs, 800),                 // 慢慢提高亮度
    flyMs: num(cfg.wallFlyMs, 1000),                  // 放大／收回
    bigMs: num(cfg.wallBigMs, 3000),                  // 大圖停留
    bigScale: num(cfg.wallBigScale, 100) / 100,       // 大圖占畫面比例
    spots: Math.max(1, num(cfg.wallSpots, 2)),        // 一輪聚焦幾張
    replacePct: num(cfg.wallReplacePct, 80),          // 一輪換掉幾 % 的圖
    swap: cfg.wallSwapMode || 'push',                 // 換圖方式 fade / push
    pushMs: num(cfg.wallPushMs, 4000),                // 往上推的動畫時間
    thumbScale: num(cfg.wallThumbScale, 1),           // 縮圖畫質倍率
    breathe: cfg.wallBreathe !== false,               // 大圖呼吸動畫
  };
}

function applyWallVars() {
  const r = document.documentElement.style;
  r.setProperty('--wall-gap', W.gap + 'px');
  r.setProperty('--wall-radius', W.radius + 'px');
  r.setProperty('--veil', String(1 - W.dim));
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

// 讀原圖 → 縮成剛好夠用的 <canvas> → 立刻釋放原圖。
// 這是低階機器能不能跑順的關鍵：牆上幾十張若都掛原始大圖，
// 光是解碼後的點陣資料就可能吃掉好幾 GB 記憶體。
function makeThumb(path) {
  return new Promise((resolve) => {
    const img = new Image();
    const fail = () => { img.src = ''; resolve(null); };
    img.onerror = fail;
    img.onload = async () => {
      try { await img.decode(); } catch { return fail(); }
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) return fail();
      const tw = Math.max(1, Math.min(w, Math.round(wallThumbW)));
      const th = Math.max(1, Math.round(tw * h / w));
      const cv = document.createElement('canvas');
      cv.width = tw; cv.height = th;
      const ctx = cv.getContext('2d', { alpha: false });
      try {
        const bmp = await createImageBitmap(img, { resizeWidth: tw, resizeHeight: th, resizeQuality: 'high' });
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
      } catch {
        ctx.drawImage(img, 0, 0, tw, th);
      }
      img.src = ''; // 釋放原圖
      resolve({ path, canvas: cv, nw: w, nh: h });
    };
    img.src = toFileURL(path);
  });
}

// 併發做 n 張縮圖（自動跳過壞圖）。併發數不開太高，免得縮圖把 CPU 佔滿。
async function preloadMany(n, concurrency = 3, maker = makeThumb) {
  const out = [];
  let exhausted = false;
  async function worker() {
    while (out.length < n && !exhausted && !wallStopped) {
      const p = nextImagePath();
      if (!p) { exhausted = true; return; }
      const r = await maker(p);
      if (r && out.length < n) out.push(r);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, n)) }, worker));
  return out;
}

// 大圖才載入原始解析度（一次只有一張）
function loadFull(path) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(null);
    img.onload = async () => {
      try { await img.decode(); } catch { return resolve(null); }
      resolve(img.naturalWidth ? img : null);
    };
    img.src = toFileURL(path);
  });
}

// ---- 版面：絕對定位的 masonry ----
function tileX(c) { return c * (wallColW + W.gap); }

function place(t, animate) {
  const tr = `translate3d(${tileX(t.col)}px, ${t.y}px, 0)`;
  if (animate) { t.box.style.transform = tr; return; }
  t.box.style.transition = 'none';
  t.box.style.transform = tr;
  void t.box.offsetWidth;
  t.box.style.transition = '';
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
function addTile(c, thumb) {
  const h = Math.round(wallColW * (thumb.nh / thumb.nw));
  const box = document.createElement('div');
  box.className = 'tile';
  box.style.width = wallColW + 'px';
  box.style.height = h + 'px';
  const inner = document.createElement('div');
  inner.className = 'tile-inner';
  const veil = document.createElement('div');
  veil.className = 'tile-veil';
  inner.appendChild(thumb.canvas);
  inner.appendChild(veil);
  box.appendChild(inner);

  const t = { box, inner, veil, canvas: thumb.canvas, path: thumb.path, nw: thumb.nw, nh: thumb.nh, col: c, y: wallColH[c], h };
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
  setTimeout(() => {
    t.box.remove();
    t.canvas.width = t.canvas.height = 0; // 主動釋放縮圖記憶體
  }, W.pushMs + 200);
}

// 建立整面圖牆：縮圖全部做好 → 算好位置 → 一張張顯示
async function buildWall() {
  const wall = el('wall');
  el('wallInner').innerHTML = '';
  wallTiles = [];

  const cols = currentCols();
  const rect = wall.getBoundingClientRect();
  const innerW = rect.width - W.gap * 2;
  wallH = rect.height - W.gap * 2;
  wallColW = Math.floor((innerW - W.gap * (cols - 1)) / cols);
  // 縮圖只要夠實際顯示大小即可（含螢幕縮放），再乘上畫質倍率
  wallThumbW = Math.round(wallColW * (window.devicePixelRatio || 1) * W.thumbScale);
  wallCols = Array.from({ length: cols }, () => []);
  wallColH = new Array(cols).fill(0);

  // 每欄填到超出畫面一些（下方留有備援磚塊，往上推時才有東西補）
  const target = wallH * 1.25;
  const cap = Math.max(cols, Math.round(cols * W.rows));
  const created = [];
  while (!wallStopped && wallTiles.length < cap) {
    if (wallColH[shortestCol()] >= target) break;
    const batch = await preloadMany(Math.min(cols, cap - wallTiles.length));
    if (batch.length === 0) break;
    for (const th of batch) created.push(addTile(shortestCol(), th));
  }
  if (wallStopped) return;

  created.forEach((t, i) => setTimeout(() => t.box.classList.add('shown'), W.staggerMs * i));
  await sleep(W.staggerMs * created.length + 400);
}

// ---- 換圖方式 A：原地淡出／淡入（磚塊高度不變）----
async function replaceFade(picks, thumbs) {
  picks.forEach((t, k) => setTimeout(() => t.box.classList.remove('shown'), W.staggerMs * k));
  await sleep(W.staggerMs * picks.length + Math.max(400, W.dimMs * 0.8));
  if (wallStopped) return;

  const done = [];
  picks.forEach((t, k) => {
    const nd = thumbs[k];
    if (!nd) return;
    t.inner.replaceChild(nd.canvas, t.canvas);
    t.canvas.width = t.canvas.height = 0;
    t.canvas = nd.canvas; t.path = nd.path; t.nw = nd.nw; t.nh = nd.nh;
    done.push(t);
  });
  done.forEach((t, k) => setTimeout(() => t.box.classList.add('shown'), W.staggerMs * k));
  await sleep(W.staggerMs * done.length + 400);
}

// ---- 換圖方式 B：移除 → 下面的往上推 → 欄底補新圖 ----
function pushOne(t, thumb) {
  const c = t.col;
  removeTile(t);
  relayoutColumn(c, true);      // 同一欄下面的磚塊往上推補位
  const nt = addTile(c, thumb); // 欄底補上新圖（從畫面下緣進場）
  requestAnimationFrame(() => nt.box.classList.add('shown'));
}

async function replacePush(picks, thumbs) {
  const step = Math.max(90, W.staggerMs * 2);
  for (let k = 0; k < picks.length && !wallStopped; k++) {
    if (!thumbs[k]) break;
    pushOne(picks[k], thumbs[k]);
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
    const short = wallColH.filter((h) => h < target).length;
    if (short === 0) return;
    const batch = await preloadMany(short);
    if (batch.length === 0) return;
    for (const th of batch) {
      const t = addTile(shortestCol(), th);
      requestAnimationFrame(() => t.box.classList.add('shown'));
    }
  }
}

// 一輪結束後換掉一定比例的舊圖：縮圖先在背景做好，才開始動
async function replaceTiles(pct) {
  const n = Math.min(wallTiles.length, Math.round(wallTiles.length * (pct / 100)));
  if (n <= 0) return;

  const order = wallTiles.slice();
  shuffleArr(order);
  const picks = order.slice(0, n);

  const thumbs = await preloadMany(picks.length);
  if (wallStopped || thumbs.length === 0) return;

  if (W.swap === 'fade') await replaceFade(picks, thumbs);
  else await replacePush(picks, thumbs);
}

// ---- 大圖：全程只動 transform（translate + scale）與 clip-path，不動版面屬性 ----
// 從畫面上那張圖「本身」長大成大圖：
//   起點＝把大圖等比縮到蓋住那張圖的位置，再用 clip-path 裁成跟它一模一樣的可見範圍（含圓角），
//   終點＝完整大圖。圖片本身全程不透明，只有背後的黑底淡入 → 看起來就是那張圖被放大。
// from：大圖要從哪個元素飛出來（取它的實際螢幕矩形，含 scale）；bigScale：大圖占畫面比例；radius：該圖圓角
const HERO_RADIUS = 8; // 大圖本身的圓角（與 #heroImg 的 border-radius 一致）

// 回傳「縮回 from 元素」時的 transform 與 clip-path
function heroFromRect(from, dims) {
  const r = from.getBoundingClientRect();
  const k = Math.max(r.width / dims.tw, r.height / dims.th);
  const fx = r.left + (r.width - dims.tw * k) / 2;
  const fy = r.top + (r.height - dims.th * k) / 2;
  // clip 用的是 heroBox 自己（縮放前）的座標，所以要除以 k
  const ix = Math.max(0, (dims.tw - r.width / k) / 2);
  const iy = Math.max(0, (dims.th - r.height / k) / 2);
  return {
    transform: `translate3d(${fx}px, ${fy}px, 0) scale(${k})`,
    clip: `inset(${iy}px ${ix}px round ${dims.radius / k}px)`,
  };
}

const HERO_FULL_CLIP = `inset(0px 0px round ${HERO_RADIUS}px)`;

function heroSet(box, transform, clip, animate) {
  if (!animate) box.style.transition = 'none';
  box.style.transform = transform;
  box.style.clipPath = clip;
  if (!animate) { void box.offsetWidth; box.style.transition = ''; }
}

function heroOpen(fullImg, from, bigScale, radius = 0) {
  const hero = el('hero');
  const box = el('heroBox');
  const im = el('heroImg');

  const nw = fullImg.naturalWidth, nh = fullImg.naturalHeight;
  const s = Math.min((window.innerWidth * bigScale) / nw, (window.innerHeight * bigScale) / nh);
  const tw = nw * s, th = nh * s;
  const tx = (window.innerWidth - tw) / 2, ty = (window.innerHeight - th) / 2;
  const dims = { tw, th, radius };

  im.classList.remove('breathe');
  im.src = fullImg.src;
  box.style.width = tw + 'px';
  box.style.height = th + 'px';

  const f = heroFromRect(from, dims);
  heroSet(box, f.transform, f.clip, false);   // 起點：跟那張圖完全重疊
  box.style.visibility = 'visible';
  hero.classList.add('on');                   // 背後黑底淡入
  heroSet(box, `translate3d(${tx}px, ${ty}px, 0) scale(1)`, HERO_FULL_CLIP, true);
  return dims;
}

// 放大完成後拿掉裁切，呼吸動畫才不會被框住
function heroSettled() {
  const box = el('heroBox');
  box.style.transition = 'none';
  box.style.clipPath = 'none';
  void box.offsetWidth;
  box.style.transition = '';
}

// 收回後整層藏起來再放掉原圖（空的 <img> 在 Chrome 會畫出外框，會變成畫面上的細線）
function heroHide() {
  el('heroBox').style.visibility = 'hidden';
  el('heroImg').removeAttribute('src');
}

function heroClose(from, dims) {
  const box = el('heroBox');
  el('heroImg').classList.remove('breathe');
  heroSet(box, box.style.transform, HERO_FULL_CLIP, false); // 先把裁切接回來（視覺上無變化）
  const f = heroFromRect(from, dims);
  heroSet(box, f.transform, f.clip, true);    // 縮回那張圖的位置與形狀
  el('hero').classList.remove('on');
}

// 聚焦一張：提高亮度 → 放大成大圖 → 停留 → 收回
async function spotlightOne() {
  const visible = (t) => t.box.classList.contains('shown') && t.y < wallH;
  const cands = wallTiles.filter((t) => visible(t) && !t.box.classList.contains('used'));
  const pool = cands.length ? cands : wallTiles.filter(visible);
  if (pool.length === 0) { await sleep(600); return; }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  pick.box.classList.add('used');

  // 這張浮到黑幕之上，先用自己的黑幕蓋著（視覺上跟其他一樣暗）
  pick.veil.style.transition = 'none';
  pick.veil.style.opacity = String(1 - W.dim);
  void pick.veil.offsetWidth;
  pick.veil.style.transition = '';
  pick.box.classList.add('spot');

  current = { path: pick.path, index: 0 };
  if (infoVisible) updateInfo();

  // 慢慢提高亮度；同時在背景載入原始大圖
  requestAnimationFrame(() => { pick.veil.style.opacity = '0'; });
  const [full] = await Promise.all([loadFull(pick.path), sleep(W.spotMs)]);
  if (wallStopped) return;

  if (full) {
    wallHeroImg = full;
    const dims = heroOpen(full, pick.inner, W.bigScale, W.radius);
    await sleep(W.flyMs);
    if (wallStopped) return;
    heroSettled();
    // 大圖定住後把整面牆藏起來，這段期間 GPU 只需要處理一張圖
    document.body.classList.add('big');
    if (W.breathe) el('heroImg').classList.add('breathe');
    await sleep(W.bigMs);
    document.body.classList.remove('big');
    if (wallStopped) return;
    heroClose(pick.inner, dims);
    await sleep(W.flyMs);
    heroHide();
    wallHeroImg = null;
  }

  pick.box.classList.remove('spot');
  pick.veil.style.transition = 'none';
  pick.veil.style.opacity = '0';
}

async function wallLoop() {
  while (!wallStopped) {
    // 1) 圖牆停留
    await sleep(W.holdMs);
    if (wallStopped) return;

    // 2) 畫面變暗（單一黑幕）
    el('dimVeil').classList.add('on');
    await sleep(W.dimMs);
    if (wallStopped) return;

    // 3) 一輪聚焦 N 張
    for (let i = 0; i < W.spots && !wallStopped; i++) {
      await spotlightOne();
      if (i < W.spots - 1) await sleep(Math.round(W.dimMs / 2));
    }
    if (wallStopped) return;

    // 4) 回復亮度
    el('dimVeil').classList.remove('on');
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

// ==================== 輪盤模式（Reel，可水平或垂直）====================
// 流程：一排圖片左右（或上下）排列 → 加速 → 等速平移（無限循環）→ 減速停下，
//       停在正中間那張就是選中的 → 其他變暗、選中那張浮起 →
//       放大成大圖停留 → 收回 → 依比例換掉一部分圖片 → 下一輪。
//
// 軸向：水平（向左／向右）時沿 x 排列；垂直（向上／向下）時沿 y 排列。
//       以下「長度」都是指沿著平移方向（主軸）的長度。
// 做法：一組 N 張圖排成一條，複製幾份接在後面蓋滿畫面，
//       位移取「一組總長度」的餘數 → 視覺上無縫循環。
// 效能：縮圖存成 ImageBitmap，畫面上每塊用 <canvas>；整段平移（加速／等速／減速）
//       做成一個 Web Animations 動畫交給合成器（compositor）跑，不靠主執行緒的
//       requestAnimationFrame → 主執行緒偶爾忙碌（GC、解碼…）也不會讓輪盤卡頓。
// 停準：先決定這輪要停哪張，再微調等速平移的距離，讓減速（ease-out cubic，
//       起始速度＝平移速度）剛好停在它正中間 → 全程速度連續、沒有頓挫。
let reelMode = false;
let R = null;           // 輪盤設定
let reelBase = [];      // 一組圖片：{ path, nw, nh, w, h, len(主軸長), x(主軸位置), bmp(母版 ImageBitmap), nodes[], used }
let reelL = 1;          // 一組圖片的總長度（含間距）＝循環週期
let reelK = 0;          // 複本份數
let reelCross = 0;      // 圖片在交叉軸的尺寸（水平時＝高、垂直時＝寬）
let reelO = 0;          // 捲動位移（顯示時取 reelL 的餘數）
let reelLast = null;    // 上一輪選中的（避免連續選到同一張）
let reelNeedsRebuild = false;

const mod = (a, n) => ((a % n) + n) % n;

function reelSettings() {
  return {
    count: Math.max(3, num(cfg.reelCount, 12)),
    size: num(cfg.reelHeight, 50) / 100,             // 交叉軸尺寸，占畫面短邊的比例
    axis: cfg.reelDir === 'up' || cfg.reelDir === 'down' ? 'y' : 'x',
    aspect: num(cfg.reelAspect, 0.75),               // 寬/高，0 = 保留原圖比例
    gap: num(cfg.reelGap, 24),
    radius: num(cfg.reelRadius, 16),
    dirSign: cfg.reelDir === 'right' || cfg.reelDir === 'down' ? -1 : 1, // 向左／上：位移遞增
    speed: Math.max(10, num(cfg.reelSpeed, 2000)),    // px/秒
    accelMs: num(cfg.reelAccelMs, 1000),
    spinMs: num(cfg.reelSpinMs, 3000),
    stopMs: Math.max(300, num(cfg.reelStopMs, 3000)),
    dim: num(cfg.reelDim, 35) / 100,
    dimMs: num(cfg.reelDimMs, 500),
    spotMs: num(cfg.reelSpotMs, 800),
    flyMs: num(cfg.reelFlyMs, 1000),
    bigMs: num(cfg.reelBigMs, 3000),
    bigScale: num(cfg.reelBigScale, 100) / 100,
    replacePct: num(cfg.reelReplacePct, 50),
    thumbScale: num(cfg.reelThumbScale, 1),
    breathe: cfg.reelBreathe !== false,
  };
}

function applyReelVars() {
  const r = document.documentElement.style;
  r.setProperty('--reel-radius', R.radius + 'px');
  r.setProperty('--veil', String(1 - R.dim));
  r.setProperty('--dim-ms', R.dimMs + 'ms');
  r.setProperty('--spot-ms', R.spotMs + 'ms');
  r.setProperty('--fly-ms', R.flyMs + 'ms');
  r.setProperty('--breathe-ms', Math.max(4000, R.bigMs * 2) + 'ms');
}

// 螢幕在主軸方向的長度
const reelScreen = () => (R.axis === 'y' ? window.innerHeight : window.innerWidth);

// 磚塊尺寸：交叉軸固定為 reelCross，主軸長度依比例（寬/高）決定
function reelTileSize(nw, nh) {
  const a = R.aspect > 0 ? R.aspect : Math.max(0.4, Math.min(2.5, nw / nh));
  if (R.axis === 'y') {
    const w = reelCross, h = Math.max(8, Math.round(reelCross / a));
    return { w, h, len: h };
  }
  const w = Math.max(8, Math.round(reelCross * a)), h = reelCross;
  return { w, h, len: w };
}

// 讀原圖 → cover 裁成磚塊比例的 <canvas> 縮圖 → 釋放原圖
function makeReelThumb(path) {
  return new Promise((resolve) => {
    const img = new Image();
    const fail = () => { img.src = ''; resolve(null); };
    img.onerror = fail;
    img.onload = async () => {
      try { await img.decode(); } catch { return fail(); }
      const nw = img.naturalWidth, nh = img.naturalHeight;
      if (!nw || !nh) return fail();
      const { w, h, len } = reelTileSize(nw, nh);
      const k = (window.devicePixelRatio || 1) * R.thumbScale;
      const pw = Math.max(1, Math.round(w * k)), ph = Math.max(1, Math.round(h * k));
      let sx = 0, sy = 0, sw = nw, sh = nh;
      if (nw / nh > w / h) { sw = Math.round(nh * w / h); sx = Math.round((nw - sw) / 2); }
      else { sh = Math.round(nw * h / w); sy = Math.round((nh - sh) / 2); }
      let bmp = null;
      try {
        bmp = await createImageBitmap(img, sx, sy, sw, sh, { resizeWidth: pw, resizeHeight: ph, resizeQuality: 'high' });
      } catch {
        const cv = document.createElement('canvas');
        cv.width = pw; cv.height = ph;
        cv.getContext('2d', { alpha: false }).drawImage(img, sx, sy, sw, sh, 0, 0, pw, ph);
        try { bmp = await createImageBitmap(cv); } catch { bmp = null; }
        cv.width = cv.height = 0;
      }
      img.src = '';
      if (!bmp) return resolve(null);
      resolve({ path, bmp, nw, nh, w, h, len });
    };
    img.src = toFileURL(path);
  });
}

// 母版 ImageBitmap → 畫面上用的 <canvas>
function tileCanvas(bmp) {
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d', { alpha: false }).drawImage(bmp, 0, 0);
  return c;
}

function freeReelNodes(b) {
  for (const n of b.nodes) {
    const c = n.querySelector('canvas');
    if (c) c.width = c.height = 0;
    n.remove();
  }
  b.nodes = [];
}

// 排版：一組圖沿主軸排好，再複製 reelK 份接在後面
function layoutReel() {
  const track = el('reelTrack');
  const vert = R.axis === 'y';
  let x = 0;
  for (const b of reelBase) { b.x = x; x += b.len + R.gap; }
  reelL = Math.max(1, x);
  reelK = Math.ceil(reelScreen() / reelL) + 1;
  for (const b of reelBase) {
    freeReelNodes(b);
    for (let m = 0; m < reelK; m++) {
      const box = document.createElement('div');
      box.className = 'rtile';
      box.style[vert ? 'top' : 'left'] = (m * reelL + b.x) + 'px';
      box.style.width = b.w + 'px';
      box.style.height = b.h + 'px';
      const inner = document.createElement('div');
      inner.className = 'rtile-inner';
      inner.appendChild(tileCanvas(b.bmp));
      box.appendChild(inner);
      track.appendChild(box);
      b.nodes.push(box);
    }
  }
  // 主軸方向接成一長條，交叉軸置中
  const main = reelK * reelL + 'px', cross = reelCross + 'px';
  track.style.width = vert ? cross : main;
  track.style.height = vert ? main : cross;
  track.style.left = vert ? Math.round((window.innerWidth - reelCross) / 2) + 'px' : '0px';
  track.style.top = vert ? '0px' : Math.round((window.innerHeight - reelCross) / 2) + 'px';
  renderReel();
}

function renderReel() {
  const d = -mod(reelO, reelL);
  el('reelTrack').style.transform = R.axis === 'y' ? `translate3d(0, ${d}px, 0)` : `translate3d(${d}px, 0, 0)`;
}

// ---- 平移動畫（交給合成器）----
// 整段運動：加速 A 毫秒（等加速度）→ 等速 Cm 毫秒 → 減速 T 毫秒（ease-out cubic）
// u(t)＝開始後 t 毫秒走了多遠（px），du(t)＝當下速度（px/ms）。
function reelMotionPlan(v, A, Cm, T) {
  const uA = A > 0 ? (v * A) / 2 : 0, uC = v * Cm, dDec = (v * T) / 3;
  const u = (t) => {
    if (t <= A) return A > 0 ? (v * t * t) / (2 * A) : 0;
    if (t <= A + Cm) return uA + v * (t - A);
    const s = Math.min(1, (t - A - Cm) / T);
    return uA + uC + dDec * (1 - Math.pow(1 - s, 3));
  };
  const du = (t) => {
    if (t < A) return (v * t) / A;
    if (t <= A + Cm) return v;
    const s = Math.min(1, (t - A - Cm) / T);
    return v * (1 - s) * (1 - s);
  };
  return { A, Cm, T, total: A + Cm + T, dist: uA + uC + dDec, u, du };
}

// 把運動轉成關鍵影格：
//  - 在「階段交界」和「位移跨過一個週期 reelL（要跳回去）」的時間點切段；
//  - 每段的位移是時間的 ≤3 次多項式，可以用 cubic-bezier(1/3, y1, 2/3, y2)
//    精確表示（x 控制點取 1/3、2/3 時 x(t)=t），y1、y2 由兩端速度算出；
//  - 跨週期處放兩個同 offset 的影格 → 瞬間跳回，視覺上無縫。
function reelKeyframes(o0, plan) {
  const { total, u, du, dist } = plan, sgn = R.dirSign, L = reelL, vert = R.axis === 'y';
  const px = (d) => (Math.abs(d) < 1e-3 ? '0' : d.toFixed(3)); // 避免 1e-13 這種科學記號
  const tf = (d) => (vert ? `translate3d(0, ${px(d)}px, 0)` : `translate3d(${px(d)}px, 0, 0)`);
  const timeAt = (target) => { // u 單調遞增 → 二分搜尋
    let lo = 0, hi = total;
    for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (u(mid) < target) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };
  const cuts = [0, plan.A, plan.A + plan.Cm, total];
  const o0m = mod(o0, L);
  let first = sgn > 0 ? L - o0m : o0m;
  if (first < 1e-6) first += L;
  for (let c = first; c < dist - 1e-6; c += L) cuts.push(timeAt(c));
  cuts.sort((a, b) => a - b);

  const kf = [];
  let last = 0;
  const off = (t) => (last = Math.max(last, Math.min(1, t / total)));
  for (let k = 0; k + 1 < cuts.length; k++) {
    const ta = cuts[k], tb = cuts[k + 1], dt = tb - ta;
    if (dt < 1e-3) continue;
    const pa = o0 + sgn * u(ta), pb = o0 + sgn * u(tb), du_ = u(tb) - u(ta);
    const base = Math.floor((pa + pb) / 2 / L) * L; // 這一段落在哪個週期
    let easing = 'linear';
    if (du_ > 1e-6) {
      const y1 = (du(ta) * dt) / du_ / 3, y2 = 1 - (du(tb) * dt) / du_ / 3;
      easing = `cubic-bezier(0.333333, ${y1.toFixed(6)}, 0.666667, ${y2.toFixed(6)})`;
    }
    kf.push({ offset: off(ta), transform: tf(-(pa - base)), easing });
    kf.push({ offset: off(tb), transform: tf(-(pb - base)) });
  }
  if (kf.length) kf[kf.length - 1].offset = 1;
  return kf;
}

let reelAnim = null;
function runReelMotion(plan) {
  const o0 = reelO;
  const kf = plan.total > 0 ? reelKeyframes(o0, plan) : [];
  reelO = o0 + R.dirSign * plan.dist;
  if (kf.length < 2) { renderReel(); return Promise.resolve(); }
  const anim = el('reelTrack').animate(kf, { duration: plan.total, fill: 'forwards' });
  reelAnim = anim;
  return anim.finished.catch(() => {}).then(() => {
    renderReel();   // 終點寫回 style 再拿掉動畫，畫面不會跳
    anim.cancel();
    if (reelAnim === anim) reelAnim = null;
  });
}

async function buildReel() {
  const track = el('reelTrack');
  track.classList.add('fade');
  reelBase.forEach((b) => { freeReelNodes(b); b.bmp.close(); });
  reelBase = [];
  el('reelTrack').className = R.axis === 'y' ? 'vert fade' : 'fade';
  reelCross = Math.max(40, Math.round(Math.min(window.innerWidth, window.innerHeight) * R.size));
  const thumbs = await preloadMany(Math.min(R.count, images.length), 3, makeReelThumb);
  if (wallStopped) return false;
  if (thumbs.length === 0) { showMessage(window.I18N.t('msg.noImages')); return false; }
  reelBase = thumbs.map((th) => ({ ...th, x: 0, nodes: [], used: false }));
  layoutReel();
  reelO = Math.random() * reelL;
  renderReel();
  void track.offsetWidth;
  track.classList.remove('fade');
  await sleep(450);
  return true;
}

function reelPick() {
  let pool = reelBase.filter((b) => !b.used && b !== reelLast);
  if (pool.length === 0) {
    reelBase.forEach((b) => { b.used = false; });
    pool = reelBase.filter((b) => b !== reelLast);
  }
  if (pool.length === 0) pool = reelBase;
  return pool[Math.floor(Math.random() * pool.length)];
}

// 選中那張：其他變暗 → 浮起 → 放大成大圖 → 停留 → 收回
async function reelSpotlight(b, node) {
  reelLast = b;
  b.used = true;
  current = { path: b.path, index: 0 };
  if (infoVisible) updateInfo();

  node.classList.add('spot');
  el('reelVeil').classList.add('on');
  const [full] = await Promise.all([loadFull(b.path), sleep(Math.max(R.dimMs, R.spotMs))]);
  if (wallStopped) return;

  if (full) {
    wallHeroImg = full;
    const dims = heroOpen(full, node.firstChild, R.bigScale, R.radius);
    await sleep(R.flyMs);
    if (wallStopped) return;
    heroSettled();
    document.body.classList.add('big');
    if (R.breathe) el('heroImg').classList.add('breathe');
    await sleep(R.bigMs);
    document.body.classList.remove('big');
    if (wallStopped) return;
    heroClose(node.firstChild, dims);
    await sleep(R.flyMs);
    heroHide();
    wallHeroImg = null;
  }

  node.classList.remove('spot');
  el('reelVeil').classList.remove('on');
  await sleep(R.dimMs);
}

// 一輪結束：依比例換掉一部分圖（縮圖先在背景做好才開始動）
async function reelReplace() {
  const n = Math.min(reelBase.length, Math.round(reelBase.length * (R.replacePct / 100)));
  if (n <= 0) return;
  const picks = shuffleArr(reelBase.slice()).slice(0, n);
  const thumbs = await preloadMany(n, 3, makeReelThumb);
  if (wallStopped || thumbs.length === 0) return;
  const pairs = picks.slice(0, thumbs.length).map((b, k) => [b, thumbs[k]]);
  const setData = (b, th) => {
    b.bmp.close();
    Object.assign(b, { bmp: th.bmp, path: th.path, nw: th.nw, nh: th.nh, w: th.w, h: th.h, len: th.len, used: false });
  };

  if (R.aspect > 0) {
    // 固定比例：主軸長度不變 → 原地淡出、換圖、淡入，位置完全不動
    const step = 60;
    pairs.forEach(([b], k) => setTimeout(() => b.nodes.forEach((nd) => nd.classList.add('swap')), step * k));
    await sleep(step * pairs.length + 450);
    if (wallStopped) return;
    for (const [b, th] of pairs) {
      setData(b, th);
      for (const nd of b.nodes) {
        const inner = nd.firstChild;
        const old = inner.firstChild;
        inner.replaceChild(tileCanvas(b.bmp), old);
        old.width = old.height = 0;
      }
    }
    pairs.forEach(([b], k) => setTimeout(() => b.nodes.forEach((nd) => nd.classList.remove('swap')), step * k));
    await sleep(step * pairs.length + 450);
  } else {
    // 原圖比例：主軸長度會變 → 整條淡出、重新排版、淡入
    const track = el('reelTrack');
    track.classList.add('fade');
    await sleep(450);
    if (wallStopped) return;
    for (const [b, th] of pairs) setData(b, th);
    layoutReel();
    track.classList.remove('fade');
    await sleep(450);
  }
}

async function reelLoop() {
  while (!wallStopped) {
    if (reelNeedsRebuild) {
      reelNeedsRebuild = false;
      if (!(await buildReel())) return;
    }
    reelO = mod(reelO, reelL);
    const v = R.speed / 1000; // px/ms
    const A = Math.max(0, R.accelMs), T = R.stopMs;

    // 先選好這輪要停的那張，再把等速平移的距離微調到剛好停在正中間：
    // 加速距離 uA ＋ 等速距離 C ＋ 減速距離 dDec ≡ 目標位移 (mod L)
    const b = reelPick();
    const uA = A > 0 ? (v * A) / 2 : 0;
    const dDec = (v * T) / 3;                               // ease-out cubic 起速 v 的減速距離
    const cruise0 = v * Math.max(0, R.spinMs);
    const want = b.x + b.len / 2 - reelScreen() / 2;
    const C = cruise0 + mod(R.dirSign * (want - reelO) - uA - cruise0 - dDec, reelL);

    // 1)～3) 加速 → 等速 → 減速停下：一個動畫，全程在合成器上跑
    await runReelMotion(reelMotionPlan(v, A, C / v, T));
    if (wallStopped) return;

    // 正中間那一份複本
    const m = Math.round((reelScreen() / 2 - b.len / 2 - b.x + mod(reelO, reelL)) / reelL);
    const node = b.nodes[Math.max(0, Math.min(b.nodes.length - 1, m))];

    // 4) 放大 → 收回
    await reelSpotlight(b, node);
    if (wallStopped) return;

    // 5) 換圖，進入下一輪
    await reelReplace();
  }
}

async function reelStart() {
  if (images.length === 0) {
    showMessage(window.I18N.t('msg.noImages'));
    return;
  }
  reelMode = true;
  wallStopped = false;
  R = reelSettings();
  applyReelVars();
  document.body.classList.add('reel-mode');
  if (await buildReel()) reelLoop();
}

// 視窗大小改變時重建圖牆（欄寬變了，高度要重算）；輪盤則在下一輪開始前重建
let resizeTimer = null;
window.addEventListener('resize', () => {
  if (reelMode) { reelNeedsRebuild = true; return; }
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

  // 各效果的專屬設定（缺的欄位補預設值；舊設定用 intensity 換算，手感不變）
  FXS = window.FX.normalize(cfg);
  const root = document.documentElement.style;
  root.setProperty('--scale-mode', cfg.scaleMode || 'contain');
  // 動態幅度倍率：控制縮放／平移／旋轉的移動量（預設 2）
  root.setProperty('--i', String(cfg.intensity || 2));

  images = await window.api.listImages(config.dir, config.recursive);
  if (config.shuffle) shuffleArr(images);
  idx = 0;
  // Pinterest 圖牆模式走另一條播放流程
  if (cfg.effect === 'wall') wallStart();
  else if (cfg.effect === 'reel') reelStart();
  else start();
});
