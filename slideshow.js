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
  else if (current.nw) meta += `　${current.nw} × ${current.nh}`; // 拍立得／封面流：用縮圖記下的原圖尺寸

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

// ==================== 共用：依指定顯示尺寸做 cover 裁切縮圖 ====================
// boxFn(nw, nh) → { w, h }：這張圖在畫面上的顯示尺寸（CSS px）。
// 縮圖解析度＝顯示尺寸 × 螢幕縮放 × 畫質倍率；原圖用完立刻釋放。
function makeBoxThumb(path, boxFn, thumbScale = 1) {
  return new Promise((resolve) => {
    const img = new Image();
    const fail = () => { img.src = ''; resolve(null); };
    img.onerror = fail;
    img.onload = async () => {
      try { await img.decode(); } catch { return fail(); }
      const nw = img.naturalWidth, nh = img.naturalHeight;
      if (!nw || !nh) return fail();
      const { w, h } = boxFn(nw, nh);
      const k = (window.devicePixelRatio || 1) * thumbScale;
      const pw = Math.max(1, Math.round(w * k)), ph = Math.max(1, Math.round(h * k));
      let sx = 0, sy = 0, sw = nw, sh = nh;
      if (nw / nh > w / h) { sw = Math.round(nh * w / h); sx = Math.round((nw - sw) / 2); }
      else { sh = Math.round(nw * h / w); sy = Math.round((nh - sh) / 2); }
      const cv = document.createElement('canvas');
      cv.width = pw; cv.height = ph;
      const ctx = cv.getContext('2d', { alpha: false });
      try {
        const bmp = await createImageBitmap(img, sx, sy, sw, sh, { resizeWidth: pw, resizeHeight: ph, resizeQuality: 'high' });
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
      } catch {
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, pw, ph);
      }
      img.src = '';
      resolve({ path, canvas: cv, nw, nh, w, h });
    };
    img.src = toFileURL(path);
  });
}

// 依比例設定算出放進 box×box 方框內的尺寸；aspect = 寬/高，0 = 原圖比例（限制在 1:2～2:1）
function fitBox(box, aspect, nw, nh) {
  const a = aspect > 0 ? aspect : Math.max(0.5, Math.min(2, nw / nh));
  return a >= 1
    ? { w: Math.round(box), h: Math.max(8, Math.round(box / a)) }
    : { w: Math.max(8, Math.round(box * a)), h: Math.round(box) };
}

const shortSide = () => Math.min(window.innerWidth, window.innerHeight);
const freeCanvas = (c) => { if (c) c.width = c.height = 0; };

// ==================== 拍立得散落模式（Polaroid）====================
// 流程：白框照片一張張「丟」到桌面上（從稍大、半透明的位置落下並帶隨機傾斜），
//       最上面那張停留一段時間 → 下一張蓋上去 → 堆到上限後整疊淡出、清空重來。
// 效能：每張只有一個 <canvas> 縮圖；只有正在落下的那張跑動畫（Web Animations，交給合成器），
//       落地後把終點寫回 style 再拿掉動畫，桌上其他照片完全靜止。
let polaMode = false;
let P = null;
let polaCount = 0;

function polaSettings() {
  return {
    size: num(cfg.polaSize, 55) / 100,              // 照片（不含白框）占畫面短邊
    aspect: num(cfg.polaAspect, 0),                 // 寬/高，0 = 原圖比例
    rotate: num(cfg.polaRotate, 12),                // 最大傾斜角度
    spread: num(cfg.polaSpread, 20) / 100,          // 落點離中心的散布範圍（占畫面）
    dropMs: Math.max(100, num(cfg.polaDropMs, 900)),
    holdMs: num(cfg.polaHoldMs, 3000),
    stack: Math.max(1, num(cfg.polaStack, 10)),     // 堆幾張後整疊淡出
    fadeMs: num(cfg.polaFadeMs, 1200),
    thumbScale: num(cfg.polaThumbScale, 1),
    caption: cfg.polaCaption === true,              // 白框下緣寫檔名
  };
}

function polaThumb(path) {
  const box = shortSide() * P.size;
  return makeBoxThumb(path, (nw, nh) => fitBox(box, P.aspect, nw, nh), P.thumbScale);
}

// 一張照片：白框（左右上等寬、下緣較寬）＋ 縮圖 ＋ 可選的檔名
function polaNode(th) {
  const S = Math.max(th.w, th.h);
  const pad = Math.round(S * 0.05), bottom = Math.round(S * 0.17);
  const W = th.w + pad * 2, H = th.h + pad + bottom;
  const node = document.createElement('div');
  node.className = 'pola';
  node.style.width = W + 'px';
  node.style.height = H + 'px';
  th.canvas.style.left = pad + 'px';
  th.canvas.style.top = pad + 'px';
  th.canvas.style.width = th.w + 'px';
  th.canvas.style.height = th.h + 'px';
  node.appendChild(th.canvas);
  if (P.caption) {
    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.style.height = bottom + 'px';
    cap.style.fontSize = Math.max(12, Math.round(bottom * 0.32)) + 'px';
    const sp = document.createElement('span');
    sp.textContent = th.path.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    cap.appendChild(sp);
    node.appendChild(cap);
  }
  return { node, W, H };
}

async function polaDrop(th) {
  const { node, W, H } = polaNode(th);
  const vw = window.innerWidth, vh = window.innerHeight;
  // 落點：畫面中心附近的橢圓範圍內隨機，並確保照片大部分在畫面內
  const ang = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random());
  let cx = vw / 2 + Math.cos(ang) * rr * P.spread * vw;
  let cy = vh / 2 + Math.sin(ang) * rr * P.spread * vh;
  cx = Math.max(W * 0.45, Math.min(vw - W * 0.45, cx));
  cy = Math.max(H * 0.45, Math.min(vh - H * 0.45, cy));
  const rot = (Math.random() * 2 - 1) * P.rotate;
  const x = cx - W / 2, y = cy - H / 2;
  const end = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${rot.toFixed(2)}deg)`;
  // 起點：從畫面外側某個方向丟進來，比較大（離鏡頭近）、多轉一點
  const ta = Math.random() * Math.PI * 2, td = shortSide() * 0.18;
  const sx = x + Math.cos(ta) * td, sy = y + Math.sin(ta) * td;
  const srot = rot + (Math.random() * 2 - 1) * 18;
  const start = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) rotate(${srot.toFixed(2)}deg) scale(1.45)`;

  node.style.transform = start;
  node.style.opacity = '0';
  el('polaPile').appendChild(node);
  polaCount++;
  current = { path: th.path, index: 0, nw: th.nw, nh: th.nh };
  if (infoVisible) updateInfo();

  const anim = node.animate([
    { transform: start, opacity: 0, boxShadow: '0 30px 70px rgba(0,0,0,0.45)' },
    { opacity: 1, offset: 0.3 },
    { transform: end, opacity: 1, boxShadow: '0 2px 4px rgba(0,0,0,0.35), 0 10px 26px rgba(0,0,0,0.45)' },
  ], { duration: P.dropMs, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'forwards' });
  await anim.finished.catch(() => {});
  // 終點寫回 style 再拿掉動畫（陰影回到 CSS 預設），之後這張完全靜止
  node.style.transform = end;
  node.style.opacity = '';
  anim.cancel();
}

// 整疊淡出 → 清空 → 恢復
async function polaClear() {
  const pile = el('polaPile');
  pile.classList.add('clear');
  await sleep(P.fadeMs);
  pile.querySelectorAll('canvas').forEach(freeCanvas);
  pile.innerHTML = '';
  polaCount = 0;
  pile.style.transition = 'none';
  pile.classList.remove('clear');
  void pile.offsetWidth;
  pile.style.transition = '';
}

async function polaLoop() {
  // 下一張的縮圖永遠在前一張停留期間先做好
  const prepare = () => preloadMany(1, 1, polaThumb).then((a) => a[0] || null);
  let pending = prepare();
  while (!wallStopped) {
    const th = await pending;
    if (wallStopped) return;
    if (!th) {
      // 不循環且圖已用完：跟一般模式一樣結束
      showMessage(window.I18N.t('msg.finished'));
      setTimeout(() => window.api.exitSlideshow(), 1500);
      return;
    }
    if (polaCount >= P.stack) await polaClear();
    if (wallStopped) return;
    pending = prepare();
    await polaDrop(th);
    await sleep(P.holdMs);
  }
}

function polaStart() {
  if (images.length === 0) { showMessage(window.I18N.t('msg.noImages')); return; }
  polaMode = true;
  wallStopped = false;
  P = polaSettings();
  document.documentElement.style.setProperty('--pola-fade-ms', P.fadeMs + 'ms');
  document.body.classList.add('polaroid-mode');
  polaLoop();
}

// ==================== 3D 封面流模式（Coverflow）====================
// 流程：中間一張正面，兩側各 N 張斜擺成 3D 透視 → 停留 → 整排往前移一格（下一張轉到正中）→ …
//       每隔幾格，正中那張用輪盤／圖牆同一套 hero 動畫放大成大圖、停留、收回。
// 做法：每張以「邏輯位置 li」記錄，畫面位置 d = li − c（c＝目前正中的邏輯位置）。
//       前移只是 c++ 後重新寫每張的 transform，由 CSS transition 補間；
//       右端（或左端）外面先放一張透明的，前移時淡入；另一端移出畫面的那張淡出後移除。
// 效能：同時最多 2N+2 張 <canvas>；只動 transform / opacity；側邊變暗用每張自己的黑幕。
let cfMode = false;
let C = null;
let cfItems = [];      // { node, inner, veil, canvas, path, nw, nh, li }
let cfC = 0;
let cfBox = 0;         // 基準尺寸（px）
let cfNeedsRebuild = false;

function cfSettings() {
  return {
    side: Math.max(1, Math.min(8, num(cfg.cfSide, 4))),   // 每側顯示幾張
    size: num(cfg.cfSize, 55) / 100,                     // 圖片大小（占畫面短邊）
    aspect: num(cfg.cfAspect, 1),                        // 寬/高，0 = 原圖比例
    angle: num(cfg.cfAngle, 55),                         // 側邊傾斜角度
    spacing: num(cfg.cfSpacing, 28) / 100,               // 側邊每張的間距（占圖片寬）
    depth: num(cfg.cfDepth, 45) / 100,                   // 側邊往後退的深度（占圖片寬）
    sideDim: num(cfg.cfSideDim, 55) / 100,               // 側邊亮度
    moveMs: Math.max(100, num(cfg.cfMoveMs, 800)),
    holdMs: num(cfg.cfHoldMs, 2500),
    dir: cfg.cfDir === 'right' ? -1 : 1,                 // 1：往左流（新圖從右邊進來）
    bigEvery: Math.max(0, num(cfg.cfBigEvery, 4)),       // 每幾格放大一次，0 = 不放大
    flyMs: num(cfg.cfFlyMs, 1000),
    bigMs: num(cfg.cfBigMs, 3000),
    bigScale: num(cfg.cfBigScale, 100) / 100,
    radius: num(cfg.cfRadius, 8),
    reflect: cfg.cfReflect !== false,
    breathe: cfg.cfBreathe !== false,
    thumbScale: num(cfg.cfThumbScale, 1),
  };
}

function applyCfVars() {
  const r = document.documentElement.style;
  r.setProperty('--cf-move-ms', C.moveMs + 'ms');
  r.setProperty('--cf-radius', C.radius + 'px');
  r.setProperty('--cf-persp', Math.round(Math.max(800, cfBox * 3)) + 'px');
  r.setProperty('--fly-ms', C.flyMs + 'ms');
  r.setProperty('--breathe-ms', Math.max(4000, C.bigMs * 2) + 'ms');
  el('cf').classList.toggle('reflect', C.reflect);
}

function cfThumb(path) {
  return makeBoxThumb(path, (nw, nh) => fitBox(cfBox, C.aspect, nw, nh), C.thumbScale);
}

// 畫面位置 d 的 transform / 亮度 / 是否可見
function cfPose(d) {
  const k = Math.abs(d), s = Math.sign(d) * C.dir;
  // 有倒影時整排往上提一點，讓倒影也在畫面內
  const ty = C.reflect ? -Math.round(cfBox * 0.1) : 0;
  if (k === 0) {
    return { tf: `translate3d(0px, ${ty}px, 0px) rotateY(0deg)`, veil: 0, op: 1, z: 1000 };
  }
  const x = s * (cfBox * 0.78 + (k - 1) * cfBox * C.spacing);
  const z = -cfBox * C.depth;
  return {
    tf: `translate3d(${x.toFixed(1)}px, ${ty}px, ${z.toFixed(1)}px) rotateY(${(s * C.angle).toFixed(1)}deg)`,
    veil: Math.min(0.92, (1 - C.sideDim) + (k - 1) * 0.08),
    op: k > C.side ? 0 : 1,
    z: 1000 - k,
  };
}

function cfApply(it, animate) {
  const p = cfPose(it.li - cfC);
  if (!animate) { it.node.style.transition = 'none'; it.veil.style.transition = 'none'; }
  it.node.style.transform = p.tf;
  it.node.style.opacity = String(p.op);
  it.node.style.zIndex = String(p.z);
  it.veil.style.opacity = String(p.veil);
  if (!animate) { void it.node.offsetWidth; it.node.style.transition = ''; it.veil.style.transition = ''; }
}

function cfMakeItem(th, li) {
  const node = document.createElement('div');
  node.className = 'cfi';
  node.style.width = th.w + 'px';
  node.style.height = th.h + 'px';
  node.style.marginLeft = -th.w / 2 + 'px';
  node.style.marginTop = -th.h / 2 + 'px';
  const inner = document.createElement('div');
  inner.className = 'cfi-inner';
  const veil = document.createElement('div');
  veil.className = 'cfi-veil';
  inner.appendChild(th.canvas);
  inner.appendChild(veil);
  node.appendChild(inner);
  const it = { node, inner, veil, canvas: th.canvas, path: th.path, nw: th.nw, nh: th.nh, w: th.w, h: th.h, li };
  el('cfStage').appendChild(node);
  cfApply(it, false);
  return it;
}

// 圖不夠時（張數少且不循環）把現有的複製一份來用
function cfClone(src) {
  const c = document.createElement('canvas');
  c.width = src.canvas.width; c.height = src.canvas.height;
  c.getContext('2d', { alpha: false }).drawImage(src.canvas, 0, 0);
  return { canvas: c, path: src.path, nw: src.nw, nh: src.nh, w: src.w, h: src.h };
}

function cfRemove(it) {
  freeCanvas(it.canvas);
  it.node.remove();
}

function cfCenter() {
  return cfItems.find((it) => it.li === cfC) || null;
}

function cfSetCurrent() {
  const it = cfCenter();
  if (!it) return;
  current = { path: it.path, index: 0, nw: it.nw, nh: it.nh };
  if (infoVisible) updateInfo();
}

async function cfBuild() {
  const stage = el('cfStage');
  stage.classList.add('fade');
  if (cfItems.length) await sleep(450);
  cfItems.forEach(cfRemove);
  cfItems = [];
  cfBox = Math.max(60, Math.round(shortSide() * C.size));
  applyCfVars();
  cfC = 0;
  const need = C.side * 2 + 1;
  const thumbs = await preloadMany(need, 3, cfThumb);
  if (wallStopped) return false;
  if (thumbs.length === 0) { showMessage(window.I18N.t('msg.noImages')); return false; }
  for (let i = 0; i < need; i++) {
    const th = i < thumbs.length ? thumbs[i] : cfClone(thumbs[i % thumbs.length]);
    cfItems.push(cfMakeItem(th, i - C.side));
  }
  cfSetCurrent();
  void stage.offsetWidth;
  stage.classList.remove('fade');
  await sleep(450);
  return true;
}

// 前移一格：遠端先補一張透明的 → c++ → 全部 transition 到新位置 → 移除移出畫面的那張
async function cfStep(th) {
  const far = cfC + C.side + 1;
  const oldest = cfItems.reduce((a, b) => (b.li < a.li ? b : a));
  cfItems.push(cfMakeItem(th || cfClone(oldest), far));
  cfC++;
  for (const it of cfItems) cfApply(it, true);
  cfSetCurrent();
  await sleep(C.moveMs);
  const keep = [];
  for (const it of cfItems) (it.li < cfC - C.side ? cfRemove(it) : keep.push(it));
  cfItems = keep;
}

// 正中那張放大成大圖 → 停留 → 收回（與圖牆／輪盤共用 hero）
async function cfSpotlight() {
  const it = cfCenter();
  if (!it) return;
  const full = await loadFull(it.path);
  if (wallStopped || !full) return;
  wallHeroImg = full;
  const dims = heroOpen(full, it.inner, C.bigScale, C.radius);
  await sleep(C.flyMs);
  if (wallStopped) return;
  heroSettled();
  document.body.classList.add('big');
  if (C.breathe) el('heroImg').classList.add('breathe');
  await sleep(C.bigMs);
  document.body.classList.remove('big');
  if (wallStopped) return;
  heroClose(it.inner, dims);
  await sleep(C.flyMs);
  heroHide();
  wallHeroImg = null;
}

async function cfLoop() {
  let steps = 0;
  const prepare = () => preloadMany(1, 1, cfThumb).then((a) => a[0] || null);
  let pending = prepare();
  while (!wallStopped) {
    if (cfNeedsRebuild) {
      cfNeedsRebuild = false;
      const old = await pending; // 尺寸變了，預先做好的縮圖作廢
      if (old) freeCanvas(old.canvas);
      if (!(await cfBuild())) return;
      pending = prepare();
    }
    await sleep(C.holdMs);
    if (wallStopped) return;
    if (C.bigEvery > 0 && steps > 0 && steps % C.bigEvery === 0) {
      await cfSpotlight();
      if (wallStopped) return;
      await sleep(300);
    }
    const th = await pending;
    if (wallStopped) return;
    if (cfNeedsRebuild) { if (th) freeCanvas(th.canvas); pending = Promise.resolve(null); continue; }
    pending = prepare();
    await cfStep(th); // th 為 null（不循環且圖用完）時會複製最舊那張，持續流動
    steps++;
  }
}

async function cfStart() {
  if (images.length === 0) { showMessage(window.I18N.t('msg.noImages')); return; }
  cfMode = true;
  wallStopped = false;
  C = cfSettings();
  document.body.classList.add('coverflow-mode');
  if (await cfBuild()) cfLoop();
}

// ==================== 共用：一定拿得到下一張（不循環時也從頭再用）====================
// 拼貼格、電影膠卷是持續性的畫面，不像一般模式會「播完」，所以圖用完就從頭再來。
function nextImagePathCycle() {
  let p = nextImagePath();
  if (!p && images.length) {
    idx = 0;
    if (cfg.shuffle) shuffleArr(images);
    p = images[idx++];
  }
  return p;
}

async function nextBoxThumbCycle(boxFn, thumbScale) {
  for (let tries = 0; tries < images.length && !wallStopped; tries++) {
    const p = nextImagePathCycle();
    if (!p) return null;
    const th = await makeBoxThumb(p, boxFn, thumbScale);
    if (th) return th;
  }
  return null;
}

const KB_ORIGINS = ['20% 20%', '80% 20%', '20% 80%', '80% 80%', '50% 50%'];

// ==================== 拼貼格模式（Collage）====================
// 流程：隨機挑一個 2～5 格的不對稱雜誌版型 → 每格一張圖、逐格淡入 →
//       每隔 swapMs 只換「最久沒換」的那一格（新圖層蓋上去做轉場）→
//       換了 layoutEvery 次之後，整個版型淡出、換一個新版型。
// 效能：每格最多同時 2 張 <canvas>（轉場中），縮圖直接 cover 裁成格子大小；
//       轉場只動 transform / opacity / clip-path；慢速縮放是 CSS 動畫。
let collageMode = false;
let G = null;
let ccCells = [];          // { box, inner, layer, canvas, path, nw, nh, w, h, t }
let ccLayout = null;
let ccNeedsRebuild = false;

// 版型：每格 [x, y, w, h]（占畫面比例，橫式螢幕用）；直式螢幕自動把 x/y 對調
const CC_LAYOUTS = {
  2: [
    [[0, 0, .6, 1], [.6, 0, .4, 1]],
    [[0, 0, .4, 1], [.4, 0, .6, 1]],
    [[0, 0, .5, 1], [.5, 0, .5, 1]],
  ],
  3: [
    [[0, 0, .6, 1], [.6, 0, .4, .5], [.6, .5, .4, .5]],
    [[0, 0, .4, .5], [0, .5, .4, .5], [.4, 0, .6, 1]],
    [[0, 0, 1, .58], [0, .58, .5, .42], [.5, .58, .5, .42]],
    [[0, 0, .3, 1], [.3, 0, .4, 1], [.7, 0, .3, 1]],
  ],
  4: [
    [[0, 0, .5, 1], [.5, 0, .5, .5], [.5, .5, .25, .5], [.75, .5, .25, .5]],
    [[0, 0, .3, .5], [0, .5, .3, .5], [.3, 0, .4, 1], [.7, 0, .3, 1]],
    [[0, 0, .62, .55], [.62, 0, .38, .55], [0, .55, .38, .45], [.38, .55, .62, .45]],
    [[0, 0, .25, 1], [.25, 0, .5, .6], [.25, .6, .5, .4], [.75, 0, .25, 1]],
  ],
  5: [
    [[0, 0, .25, .5], [0, .5, .25, .5], [.25, 0, .5, 1], [.75, 0, .25, .5], [.75, .5, .25, .5]],
    [[0, 0, .4, .5], [.4, 0, .3, .5], [.7, 0, .3, .5], [0, .5, .55, .5], [.55, .5, .45, .5]],
    [[0, 0, .6, .65], [.6, 0, .4, .35], [.6, .35, .4, .3], [0, .65, .3, .35], [.3, .65, .7, .35]],
  ],
};

function collageSettings() {
  const mn = Math.max(2, Math.min(5, num(cfg.collageMin, 2)));
  return {
    min: mn,                                                   // 最少格數
    max: Math.max(mn, Math.min(5, num(cfg.collageMax, 5))),    // 最多格數
    swapMs: Math.max(300, num(cfg.collageSwapMs, 3000)),       // 每隔多久換一格
    transMs: num(cfg.collageTransMs, 900),                     // 單格轉場時間
    trans: cfg.collageTrans || 'random',                       // fade / slide / zoom / wipe / random / none
    layoutEvery: Math.max(0, num(cfg.collageLayoutEvery, 8)),  // 換幾次後換版型，0 = 不換
    gap: num(cfg.collageGap, 12),
    radius: num(cfg.collageRadius, 12),
    kb: cfg.collageKb !== false,                               // 每格緩慢縮放
    thumbScale: num(cfg.collageThumbScale, 1),
  };
}

// 版型比例 → 實際像素矩形（外框與格間都留 gap）
function ccRects(layout) {
  const W = window.innerWidth, H = window.innerHeight, g = G.gap;
  const tr = H > W;
  return layout.map(([x, y, w, h]) => {
    if (tr) [x, y, w, h] = [y, x, h, w];
    const L = Math.round(x * (W - g) + g), T = Math.round(y * (H - g) + g);
    const R = Math.round((x + w) * (W - g)), B = Math.round((y + h) * (H - g));
    return { x: L, y: T, w: Math.max(8, R - L), h: Math.max(8, B - T) };
  });
}

function ccPickLayout() {
  const n = G.min + Math.floor(Math.random() * (G.max - G.min + 1));
  const list = CC_LAYOUTS[n];
  let pick = rand(list);
  if (list.length > 1) while (pick === ccLayout) pick = rand(list);
  ccLayout = pick;
  return pick;
}

function ccLayer(th) {
  const layer = document.createElement('div');
  layer.className = 'clayer';
  if (G.kb) {
    th.canvas.classList.add('kb');
    th.canvas.style.transformOrigin = rand(KB_ORIGINS);
    th.canvas.style.animationDelay = -(Math.random() * 20).toFixed(1) + 's';
  }
  layer.appendChild(th.canvas);
  return layer;
}

function ccSetData(cell, th) {
  Object.assign(cell, { canvas: th.canvas, path: th.path, nw: th.nw, nh: th.nh, t: performance.now() });
  current = { path: th.path, index: 0, nw: th.nw, nh: th.nh };
  if (infoVisible) updateInfo();
}

function ccClear() {
  for (const c of ccCells) {
    c.box.querySelectorAll('canvas').forEach(freeCanvas);
    c.box.remove();
  }
  ccCells = [];
}

async function ccBuild() {
  const host = el('collageBox');
  if (ccCells.length) {
    host.classList.add('fade');
    await sleep(600);
    if (wallStopped) return false;
  }
  ccClear();
  host.classList.remove('fade');
  const rects = ccRects(ccPickLayout());
  const made = [];
  for (const r of rects) {
    const th = await nextBoxThumbCycle(() => ({ w: r.w, h: r.h }), G.thumbScale);
    if (wallStopped) return false;
    if (!th) break;
    const box = document.createElement('div');
    box.className = 'ccell';
    Object.assign(box.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    const inner = document.createElement('div');
    inner.className = 'ccell-inner';
    const layer = ccLayer(th);
    inner.appendChild(layer);
    box.appendChild(inner);
    host.appendChild(box);
    const cell = { box, inner, layer, w: r.w, h: r.h };
    ccSetData(cell, th);
    cell.t += Math.random(); // 同時建立的格子，換圖順序隨機
    ccCells.push(cell);
    made.push(cell);
  }
  if (made.length === 0) { showMessage(window.I18N.t('msg.noImages')); return false; }
  made.forEach((c, i) => setTimeout(() => c.box.classList.add('shown'), 140 * i));
  await sleep(140 * made.length + 600);
  return true;
}

// 換一格：新圖層蓋上去做轉場 → 拿掉舊圖層
async function ccSwap(cell, th) {
  const layer = ccLayer(th);
  const old = cell.layer;
  cell.inner.appendChild(layer);
  const ef = G.trans === 'random' ? rand(['fade', 'slide', 'zoom', 'wipe']) : G.trans;
  const opt = { duration: Math.max(1, G.transMs), easing: 'cubic-bezier(.4,0,.2,1)' };
  let a = null;
  if (ef === 'slide') {
    const [dx, dy] = rand([[100, 0], [-100, 0], [0, 100], [0, -100]]);
    a = layer.animate([{ transform: `translate(${dx}%, ${dy}%)` }, { transform: 'translate(0, 0)' }], opt);
    old.animate([{ transform: 'translate(0, 0)' }, { transform: `translate(${-dx}%, ${-dy}%)` }], { ...opt, fill: 'forwards' });
  } else if (ef === 'zoom') {
    a = layer.animate([{ transform: 'scale(1.25)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], opt);
  } else if (ef === 'wipe') {
    const from = rand(['0 100% 0 0', '0 0 0 100%', '100% 0 0 0', '0 0 100% 0']);
    a = layer.animate([{ clipPath: `inset(${from})` }, { clipPath: 'inset(0 0 0 0)' }], opt);
  } else if (ef !== 'none') {
    a = layer.animate([{ opacity: 0 }, { opacity: 1 }], opt);
  }
  cell.layer = layer;
  ccSetData(cell, th);
  if (a) await a.finished.catch(() => {});
  old.querySelectorAll('canvas').forEach(freeCanvas);
  old.remove();
}

async function ccLoop() {
  let swaps = 0;
  while (!wallStopped) {
    if (ccNeedsRebuild || (G.layoutEvery > 0 && swaps >= G.layoutEvery)) {
      if (!ccNeedsRebuild) await sleep(G.swapMs);
      ccNeedsRebuild = false;
      swaps = 0;
      if (wallStopped || !(await ccBuild())) return;
      continue;
    }
    // 最久沒換的那格（建立時已加上隨機小數，所以初始順序是亂的）
    const cell = ccCells.reduce((a, b) => (b.t < a.t ? b : a));
    const [th] = await Promise.all([
      nextBoxThumbCycle(() => ({ w: cell.w, h: cell.h }), G.thumbScale),
      sleep(G.swapMs),
    ]);
    if (wallStopped) return;
    if (ccNeedsRebuild || !cell.box.isConnected) { if (th) freeCanvas(th.canvas); continue; }
    if (th) await ccSwap(cell, th);
    swaps++;
  }
}

async function collageStart() {
  if (images.length === 0) { showMessage(window.I18N.t('msg.noImages')); return; }
  collageMode = true;
  wallStopped = false;
  G = collageSettings();
  const r = document.documentElement.style;
  r.setProperty('--cc-radius', G.radius + 'px');
  r.setProperty('--cc-kb-ms', Math.max(12000, G.swapMs * 6) + 'ms');
  document.body.classList.add('collage-mode');
  if (await ccBuild()) ccLoop();
}

// ==================== 電影膠卷模式（Filmstrip）====================
// 流程：一條帶齒孔的底片橫向等速慢慢捲動（無限）→ 每隔 bigEveryMs，底片慢慢停下，
//       最靠近畫面中央那格放大成大圖（同一套 hero）→ 停留 → 收回 → 底片再慢慢開始走。
// 做法：每格寬度固定 fw，第 k 格放在 x = k·fw；整條底片只有 #filmTrack 一個 transform。
//       平移是一個很長的 Web Animations 動畫（交給合成器，主執行緒忙也不卡）；
//       另有一個每 250ms 的維護計時器：畫面外快要進來的格子先建好、離開的格子移除。
// 每格：一張 canvas，底片底色、齒孔、格線、編號跟照片（含復古色調）一次畫好，之後不再重繪。
let filmMode = false;
let F = null;
let filmFrames = new Map();  // k → { node, canvas, hole, path, nw, nh, loaded }
let filmGeo = null;          // { H, b, ih, iw, div, fw, k }
let filmBlank = null;        // 沒有照片的空白底片格（每格先複製這張）
let filmAnim = null;
let filmSegO = 0;            // 目前這段動畫開始時的位移
let filmQueue = [];
let filmLoading = false;
let filmTimer = null;
let filmBusy = false;        // 放大期間

function filmSettings() {
  return {
    size: num(cfg.filmSize, 45) / 100,                 // 底片高度占畫面高
    aspect: num(cfg.filmAspect, 1.5),                  // 每格照片寬/高
    speed: Math.max(5, num(cfg.filmSpeed, 60)),        // px/秒
    dirSign: cfg.filmDir === 'right' ? -1 : 1,         // 1：往左捲
    tilt: num(cfg.filmTilt, 0),                        // 底片傾斜角度
    bigEveryMs: num(cfg.filmBigEveryMs, 12000),        // 每隔多久放大一格，0 = 不放大
    bigMs: num(cfg.filmBigMs, 3000),
    flyMs: num(cfg.filmFlyMs, 1000),
    bigScale: num(cfg.filmBigScale, 100) / 100,
    tone: cfg.filmTone || 'none',                      // none / sepia / bw
    grain: cfg.filmGrain !== false,                    // 顆粒＋閃爍
    shake: cfg.filmShake !== false,                    // 輕微晃動
    breathe: cfg.filmBreathe !== false,
    thumbScale: num(cfg.filmThumbScale, 1),
  };
}

const FILM_TONE = { sepia: 'sepia(0.65) contrast(1.05)', bw: 'grayscale(1) contrast(1.08)' };

function filmGeometry() {
  const H = Math.max(60, Math.round(window.innerHeight * F.size));
  const b = Math.round(H * 0.13);                     // 上下齒孔帶
  const ih = H - b * 2;
  const iw = Math.round(ih * F.aspect);
  const div = Math.max(2, Math.round(H * 0.045));     // 格與格之間的黑線
  return { H, b, ih, iw, div, fw: iw + div, k: (window.devicePixelRatio || 1) * F.thumbScale };
}

// 空白底片格：底色、照片區（暗）、齒孔
function filmMakeBlank() {
  const { H, b, ih, iw, div, fw, k } = filmGeo;
  const c = document.createElement('canvas');
  c.width = Math.round(fw * k); c.height = Math.round(H * k);
  const ctx = c.getContext('2d', { alpha: false });
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.fillStyle = '#17120d';
  ctx.fillRect(0, 0, fw, H);
  ctx.fillStyle = '#060504';
  ctx.fillRect(div / 2, b, iw, ih);
  const n = Math.max(3, Math.round(fw / (H * 0.105)));
  const pitch = fw / n, hw = pitch * 0.52, hh = b * 0.42, r = Math.min(hw, hh) * 0.22;
  ctx.fillStyle = '#e6e0d2';
  for (let i = 0; i < n; i++) {
    const x = i * pitch + (pitch - hw) / 2;
    for (const y of [(b - hh) / 2, H - b + (b - hh) / 2]) {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, hw, hh, r); else ctx.rect(x, y, hw, hh);
      ctx.fill();
    }
  }
  return c;
}

// 底片邊緣的格號（畫在下緣齒孔外側那一條）
function filmLabel(ctx, kIdx) {
  const { H, b, k } = filmGeo;
  const edge = (b - b * 0.42) / 2;
  const fs = Math.max(7, edge * 0.7);
  const no = mod(kIdx, 36) + 1;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.fillStyle = 'rgba(232,165,70,0.7)';
  ctx.font = `600 ${fs.toFixed(1)}px Consolas, "Courier New", monospace`;
  ctx.textBaseline = 'middle';
  ctx.fillText(`${no}   ▸ ${no}A`, filmGeo.div / 2 + fs * 0.6, H - edge / 2);
}

function filmMakeFrame(kIdx) {
  const { H, b, ih, iw, div, fw } = filmGeo;
  const node = document.createElement('div');
  node.className = 'fframe';
  Object.assign(node.style, { left: kIdx * fw + 'px', width: fw + 'px', height: H + 'px' });
  const cv = document.createElement('canvas');
  cv.width = filmBlank.width; cv.height = filmBlank.height;
  const ctx = cv.getContext('2d', { alpha: false });
  ctx.drawImage(filmBlank, 0, 0);
  filmLabel(ctx, kIdx);
  // 照片區的位置（hero 放大／收回時用它的螢幕矩形）
  const hole = document.createElement('div');
  hole.className = 'fhole';
  Object.assign(hole.style, { left: div / 2 + 'px', top: b + 'px', width: iw + 'px', height: ih + 'px' });
  node.appendChild(cv);
  node.appendChild(hole);
  el('filmTrack').appendChild(node);
  const fr = { node, canvas: cv, hole, path: null, nw: 0, nh: 0, loaded: false };
  filmFrames.set(kIdx, fr);
  filmQueue.push(fr);
  filmPump();
  return fr;
}

// 把照片畫進底片格（cover 裁切＋色調），原圖用完即釋放
async function filmPaint(fr, path) {
  const img = await loadFull(path);
  if (!img) return false;
  const { b, ih, iw, div, k } = filmGeo;
  const nw = img.naturalWidth, nh = img.naturalHeight;
  let sx = 0, sy = 0, sw = nw, sh = nh;
  if (nw / nh > iw / ih) { sw = Math.round(nh * iw / ih); sx = Math.round((nw - sw) / 2); }
  else { sh = Math.round(nw * ih / iw); sy = Math.round((nh - sh) / 2); }
  const pw = Math.max(1, Math.round(iw * k)), ph = Math.max(1, Math.round(ih * k));
  let bmp = null;
  try { bmp = await createImageBitmap(img, sx, sy, sw, sh, { resizeWidth: pw, resizeHeight: ph, resizeQuality: 'high' }); } catch { bmp = null; }
  if (!fr.node.isConnected || !fr.canvas.width) { if (bmp) bmp.close(); img.src = ''; return true; }
  const ctx = fr.canvas.getContext('2d', { alpha: false });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = FILM_TONE[F.tone] || 'none';
  const dx = Math.round(div / 2 * k), dy = Math.round(b * k);
  if (bmp) { ctx.drawImage(bmp, dx, dy, pw, ph); bmp.close(); }
  else ctx.drawImage(img, sx, sy, sw, sh, dx, dy, pw, ph);
  ctx.filter = 'none';
  img.src = '';
  Object.assign(fr, { path, nw, nh, loaded: true });
  return true;
}

// 依序（一次一張）把排隊的格子補上照片，避免一次解碼太多張吃滿 CPU
async function filmPump() {
  if (filmLoading) return;
  filmLoading = true;
  while (filmQueue.length && !wallStopped) {
    const fr = filmQueue.shift();
    if (!fr.node.isConnected) continue;
    for (let tries = 0; tries < images.length && !wallStopped; tries++) {
      const p = nextImagePathCycle();
      if (!p) break;
      if (await filmPaint(fr, p)) break;
    }
  }
  filmLoading = false;
}

// 目前位移（track 座標中，畫面左緣的位置）
function filmOffset() {
  const t = filmAnim ? (filmAnim.currentTime || 0) : 0;
  return filmSegO + F.dirSign * (F.speed / 1000) * t;
}

const filmTx = (o) => `translate3d(${(-o).toFixed(2)}px, 0, 0)`;

// 從目前位置開始一段很長（10 分鐘）的等速動畫；結束時無縫接下一段
function filmRun() {
  const o0 = filmOffset();
  if (filmAnim) filmAnim.cancel();
  filmSegO = o0;
  const dur = 600000;
  const track = el('filmTrack');
  track.style.transform = filmTx(o0);
  const a = track.animate(
    [{ transform: filmTx(o0) }, { transform: filmTx(o0 + F.dirSign * (F.speed / 1000) * dur) }],
    { duration: dur, easing: 'linear', fill: 'forwards' });
  filmAnim = a;
  a.finished.then(() => { if (!wallStopped && filmAnim === a) filmRun(); }).catch(() => {});
}

// 畫面附近需要的格子補齊、遠離的移除；順便更新資訊面板的「目前這張」
function filmMaintain() {
  if (!filmGeo || wallStopped) return;
  const fw = filmGeo.fw;
  const o = filmOffset();
  const span = Math.hypot(window.innerWidth, window.innerHeight); // 傾斜時也蓋得滿
  const cx = o + window.innerWidth / 2;
  const k0 = Math.floor((cx - span / 2) / fw) - 1, k1 = Math.ceil((cx + span / 2) / fw) + 1;
  const ks = [];
  for (let k = k0; k <= k1; k++) ks.push(k);
  if (F.dirSign < 0) ks.reverse(); // 往右捲時新格子從左邊進來，先補左邊
  for (const k of ks) if (!filmFrames.has(k)) filmMakeFrame(k);
  for (const [k, fr] of filmFrames) {
    if (k < k0 - 1 || k > k1 + 1) {
      freeCanvas(fr.canvas);
      fr.node.remove();
      filmFrames.delete(k);
    }
  }
  if (!filmBusy) {
    const fr = filmFrames.get(Math.floor(cx / fw));
    if (fr && fr.loaded && (!current || current.path !== fr.path)) {
      current = { path: fr.path, index: 0, nw: fr.nw, nh: fr.nh };
      if (infoVisible) updateInfo();
    }
  }
}

function filmClear() {
  for (const fr of filmFrames.values()) { freeCanvas(fr.canvas); fr.node.remove(); }
  filmFrames.clear();
  filmQueue = [];
}

function filmBuild() {
  filmClear();
  if (filmBlank) freeCanvas(filmBlank);
  filmGeo = filmGeometry();
  filmBlank = filmMakeBlank();
  const wrap = el('filmWrap');
  wrap.style.height = filmGeo.H + 'px';
  wrap.style.marginTop = -filmGeo.H / 2 + 'px';
  wrap.style.transform = F.tilt ? `rotate(${F.tilt}deg)` : '';
  wrap.classList.toggle('shake', F.shake);
  el('filmTrack').style.height = filmGeo.H + 'px';
  filmMaintain();
}

// 顆粒：一張低解析度雜訊 canvas 放大兩倍，用 steps 動畫跳位置（不重繪）
function filmGrainInit() {
  const fx = el('filmFx');
  fx.classList.toggle('grain', F.grain);
  fx.classList.toggle('flicker', F.grain);
  if (!F.grain) return;
  const c = el('filmGrain');
  const w = Math.ceil(window.innerWidth / 2) + 64, h = Math.ceil(window.innerHeight / 2) + 64;
  c.width = w; c.height = h;
  c.style.width = w + 'px'; c.style.height = h + 'px';
  c.style.transform = 'scale(2)';
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(w, h);
  for (let i = 0; i < id.data.length; i += 4) {
    const v = Math.random() * 255;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
    id.data[i + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
}

// 平滑改變速度（playbackRate 從 a 漸變到 b）
async function filmRamp(from, to, ms) {
  const steps = Math.max(1, Math.round(ms / 40));
  for (let i = 1; i <= steps && !wallStopped; i++) {
    const s = i / steps;
    const r = from + (to - from) * (1 - Math.pow(1 - s, 2));
    if (filmAnim) filmAnim.updatePlaybackRate(Math.max(0.001, r));
    await sleep(ms / steps);
  }
}

async function filmSpotlight() {
  const cxs = window.innerWidth / 2, cys = window.innerHeight / 2;
  // 減速停下
  filmBusy = true;
  await filmRamp(1, 0, 900);
  if (filmAnim) filmAnim.pause();
  if (wallStopped) return;
  // 最靠近畫面中央、完整在畫面內、已畫好照片的那格
  let best = null, bd = Infinity;
  for (const fr of filmFrames.values()) {
    if (!fr.loaded) continue;
    const r = fr.hole.getBoundingClientRect();
    if (r.left < 0 || r.right > window.innerWidth) continue;
    const d = Math.hypot(r.left + r.width / 2 - cxs, r.top + r.height / 2 - cys);
    if (d < bd) { bd = d; best = fr; }
  }
  if (best) {
    current = { path: best.path, index: 0, nw: best.nw, nh: best.nh };
    if (infoVisible) updateInfo();
    const full = await loadFull(best.path);
    if (wallStopped) return;
    if (full) {
      wallHeroImg = full;
      const dims = heroOpen(full, best.hole, F.bigScale, 2);
      await sleep(F.flyMs);
      if (wallStopped) return;
      heroSettled();
      document.body.classList.add('big');
      if (F.breathe) el('heroImg').classList.add('breathe');
      await sleep(F.bigMs);
      document.body.classList.remove('big');
      if (wallStopped) return;
      heroClose(best.hole, dims);
      await sleep(F.flyMs);
      heroHide();
      wallHeroImg = null;
    }
  }
  // 再慢慢開始走
  if (filmAnim) { filmAnim.updatePlaybackRate(0.001); filmAnim.play(); }
  await filmRamp(0, 1, 1200);
  filmBusy = false;
}

async function filmLoop() {
  while (!wallStopped) {
    if (F.bigEveryMs <= 0) return; // 不放大：只剩捲動與維護計時器
    await sleep(F.bigEveryMs);
    if (wallStopped) return;
    await filmSpotlight();
  }
}

function filmStart() {
  if (images.length === 0) { showMessage(window.I18N.t('msg.noImages')); return; }
  filmMode = true;
  wallStopped = false;
  F = filmSettings();
  const r = document.documentElement.style;
  r.setProperty('--fly-ms', F.flyMs + 'ms');
  r.setProperty('--breathe-ms', Math.max(4000, F.bigMs * 2) + 'ms');
  el('heroImg').classList.toggle('tone-sepia', F.tone === 'sepia');
  el('heroImg').classList.toggle('tone-bw', F.tone === 'bw');
  document.body.classList.add('film-mode');
  filmGrainInit();
  filmSegO = 0;
  filmBuild();
  filmRun();
  filmTimer = setInterval(filmMaintain, 250);
  filmLoop();
}

// 視窗大小改變時重建圖牆（欄寬變了，高度要重算）；輪盤則在下一輪開始前重建
let resizeTimer = null;
window.addEventListener('resize', () => {
  if (cfMode) { cfNeedsRebuild = true; return; }
  if (collageMode) { ccNeedsRebuild = true; return; }
  if (filmMode) {
    // 放大期間先不動，等收回後的下一次 resize 或下一輪再重建
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (wallStopped || filmBusy) return;
      filmGrainInit();
      filmBuild();
    }, 400);
    return;
  }
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
  else if (cfg.effect === 'polaroid') polaStart();
  else if (cfg.effect === 'coverflow') cfStart();
  else if (cfg.effect === 'collage') collageStart();
  else if (cfg.effect === 'filmstrip') filmStart();
  else start();
});
