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

    // 直式照片兩張並排：這張是直的、螢幕是橫的 → 試著拿下一張；也是直的就並排，否則放回去下次再用
    const img2 = incoming.querySelector('.img2');
    let paired = false;
    if (cfg.pairPortrait && window.innerWidth > window.innerHeight && img.naturalHeight > img.naturalWidth * 1.05 && idx < images.length) {
      const p2 = images[idx];
      img2.src = toFileURL(p2);
      try {
        await img2.decode();
        if (img2.naturalHeight > img2.naturalWidth * 1.05) {
          paired = true;
          idx++;
          current.path2 = p2;
        }
      } catch { /* 壞圖：不並排，下一輪會被跳過 */ }
    }
    if (!paired) img2.removeAttribute('src');

    // 效果套在 slide 元素上（而非舞台）：舊圖的 img 動畫在淡出期間才能無縫延續，
    // 不會因規則失效而瞬間跳回原始 transform。
    const ef = pickEffect();
    incoming.className = 'slide effect-' + ef + (paired ? ' pair' : '');

    // 依「這個效果自己的設定」把 CSS 變數寫進 inline style
    applyEffectVars(ef, incoming, outgoing, img);
    if (paired) img2.style.cssText = img.style.cssText; // 第二張用同一組變數，動作一致

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
  if (typeof filmAnim !== 'undefined' && filmAnim) filmAnim.pause();
  if (typeof cvAnim !== 'undefined' && cvAnim) cvAnim.pause();
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

  // 「拿在手上」的大陰影是獨立一層，只淡出它的 opacity；
  // 不直接補間 box-shadow（那會讓每一幀都在主執行緒重畫，是先前 lag 的主因）。
  const lift = document.createElement('div');
  lift.className = 'lift';
  node.appendChild(lift);
  const timing = { duration: P.dropMs, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'forwards' };
  const anim = node.animate([
    { transform: start, opacity: 0 },
    { opacity: 1, offset: 0.3 },
    { transform: end, opacity: 1 },
  ], timing);
  const liftAnim = lift.animate([{ opacity: 1 }, { opacity: 0 }], timing);
  await anim.finished.catch(() => {});
  // 終點寫回 style 再拿掉動畫，之後這張完全靜止
  node.style.transform = end;
  node.style.opacity = '';
  anim.cancel();
  liftAnim.cancel();
  lift.remove();
}

// 整疊淡出 → 清空 → 恢復
async function polaClear() {
  const pile = el('polaPile');
  pile.style.willChange = 'opacity, transform';
  void pile.offsetWidth;
  pile.classList.add('clear');
  await sleep(P.fadeMs);
  pile.querySelectorAll('canvas').forEach(freeCanvas);
  pile.innerHTML = '';
  polaCount = 0;
  pile.style.transition = 'none';
  pile.classList.remove('clear');
  void pile.offsetWidth;
  pile.style.transition = '';
  pile.style.willChange = '';
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
    await polaDrop(th);
    // 落地後才開始準備下一張，避免解碼／縮圖跟落下動畫搶資源
    pending = prepare();
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
  if (it.refl) {
    if (!animate) it.refl.style.transition = 'none';
    it.refl.style.opacity = String(1 - p.veil);
  }
  if (!animate) {
    void it.node.offsetWidth;
    it.node.style.transition = ''; it.veil.style.transition = '';
    if (it.refl) it.refl.style.transition = '';
  }
}

// 圓角直接烤進 canvas（取代 overflow:hidden + border-radius 的遮罩，3D 動畫時不必每幀重算裁切）
function cfBakeRound(src, w) {
  const r = C.radius * (src.width / w);
  if (r <= 0) return src;
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.beginPath();
  g.roundRect(0, 0, c.width, c.height, r);
  g.clip();
  g.drawImage(src, 0, 0);
  freeCanvas(src);
  return c;
}

// 倒影也預先畫成一張小 canvas（取代 -webkit-box-reflect，那個在 3D 變形下每幀都要重畫）
// 半解析度：倒影本來就淡，糊一點反而自然
const CF_REFL = 0.38;
function cfMakeReflection(src) {
  const sw = src.width, sh = Math.max(1, Math.round(src.height * CF_REFL));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw / 2));
  c.height = Math.max(1, Math.round(sh / 2));
  const g = c.getContext('2d');
  g.save();
  g.translate(0, c.height);
  g.scale(1, -1);
  g.drawImage(src, 0, src.height - sh, sw, sh, 0, 0, c.width, c.height);
  g.restore();
  g.globalCompositeOperation = 'destination-in';
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, 'rgba(0,0,0,0.22)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  c.className = 'cfi-refl';
  return c;
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
  const canvas = th.baked ? th.canvas : cfBakeRound(th.canvas, th.w);
  inner.appendChild(canvas);
  inner.appendChild(veil);
  node.appendChild(inner);
  let refl = null;
  if (C.reflect) { refl = cfMakeReflection(canvas); node.appendChild(refl); }
  const it = { node, inner, veil, refl, canvas, path: th.path, nw: th.nw, nh: th.nh, w: th.w, h: th.h, li };
  el('cfStage').appendChild(node);
  cfApply(it, false);
  return it;
}

// 圖不夠時（張數少且不循環）把現有的複製一份來用
function cfClone(src) {
  const c = document.createElement('canvas');
  c.width = src.canvas.width; c.height = src.canvas.height;
  c.getContext('2d').drawImage(src.canvas, 0, 0);
  return { canvas: c, baked: true, path: src.path, nw: src.nw, nh: src.nh, w: src.w, h: src.h };
}

function cfRemove(it) {
  freeCanvas(it.canvas);
  freeCanvas(it.refl);
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

// ==================== 3D 旋轉相簿模式（Ring：旋轉木馬／立方體）====================
// 旋轉木馬：N 張圖繞 Y 軸排成一圈，每次轉一格（ease-in-out）→ 正面停頓 → 再轉；
//           每轉一格就把「正背面」那張換成新圖（轉到背面時看不清楚，換圖不突兀）。
// 立方體：6 面，每次往左／右／上／下翻 90°。用 DOMMatrix 記錄目前方向，
//         翻之前先算出「哪一面會轉到正面」，那一面此刻是側面（被正面擋住看不到），
//         趁這時換成新圖，並把圖在面內轉 0/90/180/270° 讓它轉到正面時是正的。
// 共通：整個環／立方體只改 #ringRot 一個 transform（transition 補間）；
//       每隔幾格把正面那張用 hero 放大。
let ringMode = false;
let RG = null;
let ringFaces = [];        // { node, inner, content, veil, canvas, path, nw, nh, m(本地方向矩陣，立方體用) }
let ringF = 0;             // 旋轉木馬：目前正面的索引（可為任意整數）
let ringO = null;          // 立方體：目前方向（DOMMatrix）
let ringLastDir = null;
let ringGeo = null;        // { w, h, R }
let ringNeedsRebuild = false;
let ringReady = null;      // 快轉模式：已經做好、等著換上去的縮圖

function ringSettings() {
  return {
    shape: cfg.ringShape === 'cube' ? 'cube' : 'ring',
    count: Math.max(5, Math.min(24, num(cfg.ringCount, 10))),  // 旋轉木馬張數
    size: num(cfg.ringSize, 45) / 100,                          // 正面圖片高度占畫面短邊
    aspect: num(cfg.ringAspect, 0.75),                          // 旋轉木馬每張比例（立方體固定正方形）
    gap: num(cfg.ringGap, 30),                                  // 旋轉木馬每張之間的間距
    tilt: num(cfg.ringTilt, 8),                                 // 從上方俯視的角度
    dir: cfg.ringDir || 'left',                                 // left / right / random
    moveMs: Math.max(100, num(cfg.ringMoveMs, 1400)),
    holdMs: num(cfg.ringHoldMs, 2000),
    dim: num(cfg.ringDim, 30) / 100,                            // 背面亮度
    bigEvery: Math.max(0, num(cfg.ringBigEvery, 5)),
    bigMs: num(cfg.ringBigMs, 3000),
    flyMs: num(cfg.ringFlyMs, 1000),
    bigScale: num(cfg.ringBigScale, 100) / 100,
    radius: num(cfg.ringRadius, 10),
    breathe: cfg.ringBreathe !== false,
    thumbScale: num(cfg.ringThumbScale, 1),
    // 轉法：step＝一格一格轉；spin＝快速旋轉 → 幾秒後減速停下 → 放大正面那張
    motion: cfg.ringMotion === 'spin' ? 'spin' : 'step',
    spinMs: Math.max(0, num(cfg.ringSpinMs, 4000)),             // 全速旋轉多久
    spinSpeed: Math.max(0.05, num(cfg.ringSpinSpeed, 1)),       // 全速時每秒幾圈
    spinStopMs: Math.max(300, num(cfg.ringSpinStopMs, 2500)),   // 減速到停下花多久
    spinPauseMs: Math.max(0, num(cfg.ringSpinPauseMs, 600)),    // 停下後多久開始放大
  };
}

function ringThumb() {
  const { w, h } = ringGeo;
  return nextBoxThumbCycle(() => ({ w, h }), RG.thumbScale);
}

function ringMakeFace(transform, w, h) {
  const node = document.createElement('div');
  node.className = 'rface';
  Object.assign(node.style, { width: w + 'px', height: h + 'px', marginLeft: -w / 2 + 'px', marginTop: -h / 2 + 'px', transform });
  const inner = document.createElement('div');
  inner.className = 'rface-inner';
  const content = document.createElement('div');
  content.className = 'rface-content';
  const veil = document.createElement('div');
  veil.className = 'rface-veil';
  inner.appendChild(content);
  inner.appendChild(veil);
  node.appendChild(inner);
  el('ringRot').appendChild(node);
  return { node, inner, content, veil, canvas: null, path: null, nw: 0, nh: 0 };
}

function ringSetImage(f, th) {
  if (f.canvas) { freeCanvas(f.canvas); f.canvas.remove(); }
  f.content.appendChild(th.canvas);
  Object.assign(f, { canvas: th.canvas, path: th.path, nw: th.nw, nh: th.nh });
}

function ringFront() {
  if (RG.shape === 'cube') return ringFaces.find((f) => ringNormalZ(ringO, f) > 0.9) || null;
  return ringFaces[mod(ringF, ringFaces.length)];
}

function ringSetCurrent() {
  const f = ringFront();
  if (!f || !f.path) return;
  current = { path: f.path, index: 0, nw: f.nw, nh: f.nh };
  if (infoVisible) updateInfo();
}

// ---- 旋轉木馬 ----
function ringCarouselTransform() {
  const step = 360 / ringFaces.length;
  return `translateZ(${(-ringGeo.R).toFixed(1)}px) rotateX(${-RG.tilt}deg) rotateY(${(-ringF * step).toFixed(3)}deg)`;
}

// 依每張相對正面的角度決定亮度（正面 0、正背面最暗）
function ringCarouselVeils() {
  const n = ringFaces.length, maxV = 1 - RG.dim;
  ringFaces.forEach((f, i) => {
    const a = ((i - ringF) * 2 * Math.PI) / n;
    f.veil.style.opacity = (maxV * (1 - Math.cos(a)) / 2).toFixed(3);
  });
}

// ---- 立方體 ----
const CUBE_FACES = ['rotateY(0deg)', 'rotateY(90deg)', 'rotateY(180deg)', 'rotateY(-90deg)', 'rotateX(90deg)', 'rotateX(-90deg)'];
const CUBE_STEPS = { left: 'rotateY(-90deg)', right: 'rotateY(90deg)', up: 'rotateX(90deg)', down: 'rotateX(-90deg)' };
const CUBE_OPP = { left: 'right', right: 'left', up: 'down', down: 'up' };
const dirVec = (m, x, y, z) => m.transformPoint(new DOMPoint(x, y, z, 0));

function ringNormalZ(O, f) {
  return dirVec(O.multiply(f.m), 0, 0, 1).z;
}

const m3d = (m) => `matrix3d(${[m.m11, m.m12, m.m13, m.m14, m.m21, m.m22, m.m23, m.m24, m.m31, m.m32, m.m33, m.m34, m.m41, m.m42, m.m43, m.m44].join(',')})`;

function ringCubeTransform() {
  return `translateZ(${(-ringGeo.R).toFixed(1)}px) rotateX(${-RG.tilt}deg) ${m3d(ringO)}`;
}

// 90° 旋轉的組合，元素一定是 -1 / 0 / 1；四捨五入避免浮點誤差累積
function roundMatrix(m) {
  const r = new DOMMatrix();
  for (const k of ['m11', 'm12', 'm13', 'm21', 'm22', 'm23', 'm31', 'm32', 'm33']) r[k] = Math.round(m[k]);
  return r;
}

// 在方向 O 下，面 f 的內容要轉幾度，看起來才是正的（螢幕上「上」朝上）
function cubeUpright(O, f) {
  for (const r of [0, 90, 180, 270]) {
    const u = dirVec(O.multiply(f.m).multiply(new DOMMatrix().rotate(0, 0, r)), 0, -1, 0);
    if (u.y < -0.9) return r;
  }
  return 0;
}

function cubeOrient(f, O) {
  f.content.style.transform = `rotate(${cubeUpright(O, f)}deg)`;
}

function ringPickDir() {
  if (RG.dir === 'left' || RG.dir === 'right') return RG.dir;
  // random：立方體有傾斜時只左右翻（上下翻會讓頂面換圖被看到）
  const opts = RG.shape === 'cube' && RG.tilt === 0 ? ['left', 'right', 'up', 'down'] : ['left', 'right'];
  const pool = opts.filter((d) => d !== CUBE_OPP[ringLastDir]);
  const d = rand(pool.length ? pool : opts);
  ringLastDir = d;
  return d;
}

async function ringBuild() {
  const stage = el('ringStage');
  if (ringFaces.length) { stage.classList.add('fade'); await sleep(500); }
  if (wallStopped) return false;
  ringFaces.forEach((f) => { freeCanvas(f.canvas); f.node.remove(); });
  ringFaces = [];
  if (ringReady) { freeCanvas(ringReady.canvas); ringReady = null; } // 尺寸可能變了
  const rot = el('ringRot');
  rot.style.transition = 'none';
  el('ring').classList.toggle('cube', RG.shape === 'cube');
  const H = Math.max(60, Math.round(shortSide() * RG.size));
  let faceTf;
  if (RG.shape === 'cube') {
    ringGeo = { w: H, h: H, R: H / 2 };
    faceTf = CUBE_FACES.map((b) => b + ` translateZ(${H / 2}px)`);
  } else {
    const w = Math.max(20, Math.round(H * RG.aspect)), n = RG.count;
    const R = (w + RG.gap) / (2 * Math.tan(Math.PI / n));
    ringGeo = { w, h: H, R };
    faceTf = Array.from({ length: n }, (_, i) => `rotateY(${(i * 360) / n}deg) translateZ(${R.toFixed(1)}px)`);
  }
  const r = document.documentElement.style;
  r.setProperty('--ring-persp', Math.round(Math.max(1200, ringGeo.R * 4, H * 3)) + 'px');
  for (let i = 0; i < faceTf.length; i++) {
    const f = ringMakeFace(faceTf[i], ringGeo.w, ringGeo.h);
    if (RG.shape === 'cube') f.m = new DOMMatrix(CUBE_FACES[i]);
    ringFaces.push(f);
  }
  // 圖片：從正面開始往兩側填（張數比圖片多時也沒關係，會從頭再用）
  for (const f of ringFaces) {
    const th = await ringThumb();
    if (wallStopped) return false;
    if (!th) { showMessage(window.I18N.t('msg.noImages')); return false; }
    ringSetImage(f, th);
  }
  ringF = 0;
  ringO = new DOMMatrix();
  if (RG.shape === 'cube') {
    ringFaces.forEach((f) => cubeOrient(f, ringO));
    rot.style.transform = ringCubeTransform();
  } else {
    rot.style.transform = ringCarouselTransform();
    ringFaces.forEach((f) => { f.veil.style.transition = 'none'; });
    ringCarouselVeils();
  }
  void rot.offsetWidth;
  rot.style.transition = '';
  ringFaces.forEach((f) => { f.veil.style.transition = ''; });
  ringSetCurrent();
  stage.classList.remove('fade');
  await sleep(500);
  return true;
}

// 轉一格
async function ringStep() {
  const d = ringPickDir();
  if (RG.shape === 'cube') {
    const O2 = roundMatrix(new DOMMatrix(CUBE_STEPS[d]).multiply(ringO));
    const incoming = ringFaces.find((f) => ringNormalZ(O2, f) > 0.9);
    if (incoming) {
      // 這一面此刻在側面（被正面擋住），趁現在換圖並轉正
      const th = await ringThumb();
      if (wallStopped) return;
      if (th) ringSetImage(incoming, th);
      cubeOrient(incoming, O2);
    }
    ringO = O2;
    el('ringRot').style.transform = ringCubeTransform();
    ringSetCurrent();
    await sleep(RG.moveMs);
    return;
  }
  ringF += d === 'right' ? -1 : 1;
  el('ringRot').style.transform = ringCarouselTransform();
  ringCarouselVeils();
  ringSetCurrent();
  // 轉動期間把（轉完後的）正背面那張換成新圖
  const n = ringFaces.length;
  const back = ringFaces[mod(ringF + Math.round(n / 2), n)];
  const [th] = await Promise.all([ringThumb(), sleep(RG.moveMs)]);
  if (wallStopped) return;
  if (th) ringSetImage(back, th);
}

async function ringSpotlight() {
  const f = ringFront();
  if (!f || !f.path) return;
  const full = await loadFull(f.path);
  if (wallStopped || !full) return;
  wallHeroImg = full;
  const dims = heroOpen(full, f.inner, RG.bigScale, RG.radius);
  await sleep(RG.flyMs);
  if (wallStopped) return;
  heroSettled();
  document.body.classList.add('big');
  if (RG.breathe) el('heroImg').classList.add('breathe');
  await sleep(RG.bigMs);
  document.body.classList.remove('big');
  if (wallStopped) return;
  heroClose(f.inner, dims);
  await sleep(RG.flyMs);
  heroHide();
  wallHeroImg = null;
}

// ---- 快轉模式 ----
// 一個 Web Animations 動畫跑完「加速 → 全速 → 減速停下」，全程在合成器上；
// 停下的位置一定剛好對齊某一張（總角度取 step 的整數倍，多出來的補進全速段）。
// 主執行緒只用 requestAnimationFrame 依同一條角度曲線：更新旋轉木馬的背面變暗、
// 並把轉到背面的那幾張換成新圖（每一輪每張最多換一次）。
const RING_SPIN_ACCEL_MS = 900;

async function ringSpin() {
  const cube = RG.shape === 'cube';
  let d = RG.dir;
  if (d !== 'left' && d !== 'right') d = Math.random() < 0.5 ? 'left' : 'right';
  const sgn = d === 'right' ? 1 : -1;                  // rotateY 角度的增減方向（left → ringF 往上加）
  const n = ringFaces.length;
  const step = cube ? 90 : 360 / n;
  const v = (RG.spinSpeed * 360) / 1000;               // 度 / 毫秒
  const A = RING_SPIN_ACCEL_MS, T = RG.spinStopMs;
  const uA = (v * A) / 2;                              // 等加速（ease-in 二次）走的角度
  const dDec = (v * T) / 3;                            // ease-out 三次從速度 v 減到 0 走的角度
  const k = Math.max(1, Math.ceil((uA + v * RG.spinMs + dDec) / step));
  const D = k * step;
  const cruise = D - uA - dDec;
  const Cms = cruise / v;
  const total = A + Cms + T;

  const pre = `translateZ(${(-ringGeo.R).toFixed(1)}px) rotateX(${-RG.tilt}deg) `;
  const post = cube ? ' ' + m3d(ringO) : '';
  const phi0 = cube ? 0 : -ringF * step;
  const tf = (phi) => `${pre}rotateY(${phi.toFixed(3)}deg)${post}`;
  const p1 = phi0 + sgn * uA, p2 = p1 + sgn * cruise, p3 = phi0 + sgn * D;
  const phiAt = (t) => {
    if (t <= 0) return phi0;
    if (t < A) return phi0 + sgn * uA * (t / A) * (t / A);
    if (t < A + Cms) return p1 + sgn * v * (t - A);
    const u = Math.min(1, (t - A - Cms) / T);
    return p2 + sgn * dDec * (1 - (1 - u) ** 3);
  };

  const rot = el('ringRot');
  rot.style.transition = 'none';
  ringFaces.forEach((f) => { f.veil.style.transition = 'none'; });
  const anim = rot.animate([
    { transform: tf(phi0), offset: 0, easing: 'cubic-bezier(.333,0,.667,.333)' },
    { transform: tf(p1), offset: A / total, easing: 'linear' },
    { transform: tf(p2), offset: (A + Cms) / total, easing: 'cubic-bezier(.333,1,.667,1)' },
    { transform: tf(p3), offset: 1 },
  ], { duration: total, fill: 'forwards' });

  // 每一張此刻「朝向觀眾」的程度：1＝正面、-1＝正背面
  const facing = (f, i, phi) => cube
    ? dirVec(new DOMMatrix(`rotateY(${phi}deg)`).multiply(ringO).multiply(f.m), 0, 0, 1).z
    : Math.cos(((i * step + phi) * Math.PI) / 180);

  const fresh = new Set();
  let busy = false, done = false;
  const maxV = 1 - RG.dim;
  const tick = () => {
    if (done || wallStopped) return;
    const phi = phiAt(anim.currentTime || 0);
    ringFaces.forEach((f, i) => {
      const fz = facing(f, i, phi);
      if (!cube) f.veil.style.opacity = (maxV * (1 - fz) / 2).toFixed(3);
      // 轉到背面、這一輪還沒換過 → 換上新圖
      if (ringReady && fz < -0.5 && !fresh.has(f) && (!cube || Math.abs(f.m.m22) > 0.5)) {
        ringSetImage(f, ringReady);
        if (cube) cubeOrient(f, ringO);
        ringReady = null;
        fresh.add(f);
      }
    });
    if (!ringReady && !busy && fresh.size < n) {
      busy = true;
      ringThumb().then((th) => {
        busy = false;
        if (wallStopped || !ringMode) { if (th) freeCanvas(th.canvas); return; }
        if (ringReady) { if (th) freeCanvas(th.canvas); } else ringReady = th;
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  await anim.finished.catch(() => {});
  done = true;
  if (wallStopped) return;

  // 把終點寫回 style，再拿掉動畫
  if (cube) ringO = roundMatrix(new DOMMatrix(`rotateY(${sgn * D}deg)`).multiply(ringO));
  else ringF -= sgn * k;
  rot.style.transform = cube ? ringCubeTransform() : ringCarouselTransform();
  if (!cube) ringCarouselVeils();
  anim.cancel();
  void rot.offsetWidth;
  rot.style.transition = '';
  ringFaces.forEach((f) => { f.veil.style.transition = ''; });
  ringSetCurrent();
}

async function ringSpinLoop() {
  while (!wallStopped) {
    if (ringNeedsRebuild) {
      ringNeedsRebuild = false;
      if (!(await ringBuild())) return;
    }
    await ringSpin();
    if (wallStopped) return;
    await sleep(RG.spinPauseMs);
    if (wallStopped) return;
    if (ringNeedsRebuild) continue;
    await ringSpotlight();
    if (wallStopped) return;
    await sleep(RG.holdMs);
  }
}

async function ringLoop() {
  if (RG.motion === 'spin') return ringSpinLoop();
  let steps = 0;
  while (!wallStopped) {
    if (ringNeedsRebuild) {
      ringNeedsRebuild = false;
      if (!(await ringBuild())) return;
    }
    await sleep(RG.holdMs);
    if (wallStopped) return;
    if (RG.bigEvery > 0 && steps > 0 && steps % RG.bigEvery === 0) {
      await ringSpotlight();
      if (wallStopped) return;
      await sleep(300);
    }
    await ringStep();
    steps++;
  }
}

async function ringStart() {
  if (images.length === 0) { showMessage(window.I18N.t('msg.noImages')); return; }
  ringMode = true;
  wallStopped = false;
  RG = ringSettings();
  const r = document.documentElement.style;
  r.setProperty('--ring-move-ms', RG.moveMs + 'ms');
  r.setProperty('--ring-radius', RG.radius + 'px');
  r.setProperty('--fly-ms', RG.flyMs + 'ms');
  r.setProperty('--breathe-ms', Math.max(4000, RG.bigMs * 2) + 'ms');
  document.body.classList.add('ring-mode');
  if (await ringBuild()) ringLoop();
}

// ==================== 翻頁書模式（Book）====================
// 相簿風格：左右兩頁各貼一張照片 → 停留 → 右頁以書脊為軸翻過去（CSS 3D），
//           背面就是下一個左頁，底下露出下一個右頁 → 停留 → …
// 翻頁時：葉子正面漸暗、背面由暗轉亮；底下的右頁有翻起的投影、左頁在葉子落下時被投影。
// 效能：同時最多 4 頁（左、右、葉子兩面）；只動葉子的 transform 和幾層陰影的 opacity。
let bookMode = false;
let BK = null;
let bookL = null, bookR = null;   // { el, canvas, path, nw, nh }
let bookGeo = null;
let bookNeedsRebuild = false;

const BOOK_PAPER = {
  cream: ['#f2ede1', '#ddd6c6', '#c9c1b0'],
  white: ['#fafafa', '#e2e2e2', '#cfcfcf'],
  black: ['#1a1a1a', '#2c2c2c', '#3a3a3a'],
};

function bookSettings() {
  return {
    size: num(cfg.bookSize, 80) / 100,             // 頁高占畫面高
    aspect: num(cfg.bookAspect, 0.75),              // 每頁寬/高
    pad: num(cfg.bookPad, 8) / 100,                 // 紙張留白（占頁面短邊）
    paper: BOOK_PAPER[cfg.bookPaper] ? cfg.bookPaper : 'cream',
    flipMs: Math.max(200, num(cfg.bookFlipMs, 1400)),
    holdMs: num(cfg.bookHoldMs, 3000),
    bigEvery: Math.max(0, num(cfg.bookBigEvery, 0)),
    bigMs: num(cfg.bookBigMs, 3000),
    flyMs: num(cfg.bookFlyMs, 1000),
    bigScale: num(cfg.bookBigScale, 100) / 100,
    breathe: cfg.bookBreathe !== false,
    thumbScale: num(cfg.bookThumbScale, 1),
  };
}

function bookGeometry() {
  let ph = window.innerHeight * BK.size, pw = ph * BK.aspect;
  const maxW = window.innerWidth * 0.94;
  if (pw * 2 > maxW) { const k = maxW / (pw * 2); pw *= k; ph *= k; }
  pw = Math.round(pw); ph = Math.round(ph);
  const pad = Math.round(Math.min(pw, ph) * BK.pad);
  return { pw, ph, pad, iw: Math.max(8, pw - pad * 2), ih: Math.max(8, ph - pad * 2) };
}

function bookThumb() {
  const { iw, ih } = bookGeo;
  return nextBoxThumbCycle(() => ({ w: iw, h: ih }), BK.thumbScale);
}

// 一頁：紙張 + 照片 + 書脊陰影 + 翻頁用的暗化層與投影層
function bookPage(th, side) {
  const { pw, ph, pad, iw, ih } = bookGeo;
  const page = document.createElement('div');
  page.className = 'bpage ' + side;
  Object.assign(page.style, { width: pw + 'px', height: ph + 'px' });
  Object.assign(th.canvas.style, { left: pad + 'px', top: pad + 'px', width: iw + 'px', height: ih + 'px' });
  page.appendChild(th.canvas);
  for (const c of ['bspine', 'bcast', 'bshade']) {
    const d = document.createElement('div');
    d.className = c;
    page.appendChild(d);
  }
  return { el: page, canvas: th.canvas, path: th.path, nw: th.nw, nh: th.nh };
}

function bookPlace(p, side) {
  p.el.className = 'bpage ' + side;
  p.el.style.left = (side === 'left' ? 0 : bookGeo.pw) + 'px';
  p.el.style.transform = '';
  p.el.style.zIndex = '1';
}

function bookFree(p) {
  if (!p) return;
  freeCanvas(p.canvas);
  p.el.remove();
}

function bookSetCurrent(p) {
  current = { path: p.path, index: 0, nw: p.nw, nh: p.nh };
  if (infoVisible) updateInfo();
}

async function bookBuild() {
  const spread = el('bookSpread');
  if (bookL) { spread.classList.add('fade'); await sleep(500); }
  if (wallStopped) return false;
  bookFree(bookL); bookFree(bookR);
  bookL = bookR = null;
  spread.innerHTML = '';
  bookGeo = bookGeometry();
  const [paper, e1, e2] = BOOK_PAPER[BK.paper];
  const r = document.documentElement.style;
  r.setProperty('--book-paper', paper);
  r.setProperty('--book-edge1', e1);
  r.setProperty('--book-edge2', e2);
  r.setProperty('--book-persp', Math.round(bookGeo.pw * 4) + 'px');
  Object.assign(spread.style, {
    width: bookGeo.pw * 2 + 'px', height: bookGeo.ph + 'px',
    marginLeft: -bookGeo.pw + 'px', marginTop: -bookGeo.ph / 2 + 'px',
  });
  const a = await bookThumb(), b = a ? await bookThumb() : null;
  if (wallStopped) return false;
  if (!a || !b) { showMessage(window.I18N.t('msg.noImages')); return false; }
  bookL = bookPage(a, 'left'); bookPlace(bookL, 'left'); spread.appendChild(bookL.el);
  bookR = bookPage(b, 'right'); bookPlace(bookR, 'right'); spread.appendChild(bookR.el);
  bookSetCurrent(bookR);
  void spread.offsetWidth;
  spread.classList.remove('fade');
  await sleep(500);
  return true;
}

// 翻一頁：l2＝翻過去後的新左頁（葉子背面）、r2＝底下露出的新右頁
async function bookFlip(l2, r2) {
  const spread = el('bookSpread');
  const { pw, ph } = bookGeo;
  const D = BK.flipMs;

  const nextR = bookPage(r2, 'right');
  bookPlace(nextR, 'right');
  spread.insertBefore(nextR.el, spread.firstChild);   // 最底層

  const leaf = document.createElement('div');
  leaf.className = 'bleaf';
  Object.assign(leaf.style, { left: pw + 'px', width: pw + 'px', height: ph + 'px', zIndex: '3' });
  const front = bookR;                                  // 目前右頁搬進葉子當正面
  front.el.className = 'bpage right';
  front.el.style.left = '0px';
  front.el.style.zIndex = '';
  const back = bookPage(l2, 'left');
  back.el.classList.add('back');
  leaf.appendChild(front.el);
  leaf.appendChild(back.el);
  spread.appendChild(leaf);

  const ease = 'cubic-bezier(.45,.05,.35,1)';
  const sh = (node) => node.querySelector('.bshade');
  const cast = (node) => node.querySelector('.bcast');
  const anims = [
    leaf.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-180deg)' }], { duration: D, easing: ease, fill: 'forwards' }),
    // 葉子正面翻起時漸暗、背面落下時由暗轉亮
    sh(front.el).animate([{ opacity: 0 }, { opacity: 0.45 }], { duration: D / 2, easing: 'ease-in', fill: 'forwards' }),
    sh(back.el).animate([{ opacity: 0.45 }, { opacity: 0.45, offset: 0.5 }, { opacity: 0 }], { duration: D, easing: 'ease-out', fill: 'forwards' }),
    // 底下右頁：剛翻起時被葉子投影；左頁：葉子快落下時被投影
    cast(nextR.el).animate([{ opacity: 0.9 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }], { duration: D, easing: 'ease-out', fill: 'forwards' }),
    cast(bookL.el).animate([{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 0.8, offset: 0.85 }, { opacity: 0 }], { duration: D, easing: 'linear', fill: 'forwards' }),
  ];
  await anims[0].finished.catch(() => {});
  anims.forEach((a) => a.cancel());

  // 葉子背面變成新的左頁；舊左頁與葉子正面釋放
  bookFree(bookL);
  back.el.classList.remove('back');
  bookPlace(back, 'left');
  spread.appendChild(back.el);
  bookFree(front);
  leaf.remove();
  bookL = back;
  bookR = nextR;
  bookSetCurrent(bookR);
}

async function bookSpotlight() {
  const p = Math.random() < 0.5 ? bookL : bookR;
  const full = await loadFull(p.path);
  if (wallStopped || !full) return;
  bookSetCurrent(p);
  wallHeroImg = full;
  const dims = heroOpen(full, p.canvas, BK.bigScale, 0);
  await sleep(BK.flyMs);
  if (wallStopped) return;
  heroSettled();
  document.body.classList.add('big');
  if (BK.breathe) el('heroImg').classList.add('breathe');
  await sleep(BK.bigMs);
  document.body.classList.remove('big');
  if (wallStopped) return;
  heroClose(p.canvas, dims);
  await sleep(BK.flyMs);
  heroHide();
  wallHeroImg = null;
}

async function bookLoop() {
  let flips = 0;
  const prepare = async () => {
    const a = await bookThumb();
    const b = a ? await bookThumb() : null;
    return [a, b];
  };
  let pending = prepare();
  while (!wallStopped) {
    if (bookNeedsRebuild) {
      bookNeedsRebuild = false;
      const old = await pending;
      old.forEach((t) => t && freeCanvas(t.canvas));
      if (!(await bookBuild())) return;
      pending = prepare();
    }
    await sleep(BK.holdMs);
    if (wallStopped) return;
    if (BK.bigEvery > 0 && flips > 0 && flips % BK.bigEvery === 0) {
      await bookSpotlight();
      if (wallStopped) return;
      await sleep(300);
    }
    const [l2, r2] = await pending;
    if (wallStopped) return;
    if (bookNeedsRebuild) { [l2, r2].forEach((t) => t && freeCanvas(t.canvas)); pending = Promise.resolve([null, null]); continue; }
    pending = prepare();
    if (l2 && r2) await bookFlip(l2, r2);
    flips++;
  }
}

async function bookStart() {
  if (images.length === 0) { showMessage(window.I18N.t('msg.noImages')); return; }
  bookMode = true;
  wallStopped = false;
  BK = bookSettings();
  const r = document.documentElement.style;
  r.setProperty('--fly-ms', BK.flyMs + 'ms');
  r.setProperty('--breathe-ms', Math.max(4000, BK.bigMs * 2) + 'ms');
  document.body.classList.add('book-mode');
  if (await bookBuild()) bookLoop();
}

// ==================== 馬賽克組合模式（Mosaic）====================
// 流程：挑一張目標圖 → 依格子算出每格平均色 → 從「縮圖池」挑顏色最接近的小圖填進去 →
//       小圖一格格出現（隨機／掃過／由中心擴散），同時鏡頭由近拉遠，看出大圖輪廓 →
//       停留 → 原圖在上面淡入 → 停留 → 淡出換下一張。
// 縮圖池：每張圖做一個正方形小縮圖（ImageBitmap）並記下平均色；開頭先做一小批就開始，
//         其餘在背景慢慢補到上限；池滿後每輪換掉一部分，保持新鮮。
// 效能：整幅馬賽克畫在一張 canvas 上（只在拼的過程中重畫），拉遠只動 canvas 的 transform。
let mosaicMode = false;
let MS = null;
let msPool = [];           // { bmp, r, g, b, path }
let msPoolBusy = false;
let msQ = 1;               // canvas 解析度倍率（拉遠時才不會太糊）

function mosaicSettings() {
  return {
    tile: Math.max(8, num(cfg.mosaicTile, 32)),          // 每格大小（px）
    pool: Math.max(10, num(cfg.mosaicPool, 80)),          // 縮圖池張數上限
    tint: num(cfg.mosaicTint, 35) / 100,                  // 每格往目標色調整的比例
    order: cfg.mosaicOrder || 'random',                   // random / sweep / center
    buildMs: Math.max(200, num(cfg.mosaicBuildMs, 4000)), // 拼出來的時間
    holdMs: num(cfg.mosaicHoldMs, 3000),                  // 馬賽克停留
    revealMs: num(cfg.mosaicRevealMs, 2000),              // 原圖淡入
    origMs: num(cfg.mosaicOrigMs, 3000),                  // 原圖停留
    zoom: Math.max(1, num(cfg.mosaicZoom, 3)),            // 起始放大倍率（1 = 不拉遠）
  };
}

const msTileRes = () => Math.min(192, Math.round(MS.tile * (window.devicePixelRatio || 1) * msQ));

// 一張圖 → 正方形小縮圖 + 平均色
async function msMakeTile(path) {
  const img = await loadFull(path);
  if (!img) return null;
  const nw = img.naturalWidth, nh = img.naturalHeight, s = Math.min(nw, nh);
  const T = msTileRes();
  let bmp = null;
  try {
    bmp = await createImageBitmap(img, Math.round((nw - s) / 2), Math.round((nh - s) / 2), s, s,
      { resizeWidth: T, resizeHeight: T, resizeQuality: 'medium' });
  } catch { bmp = null; }
  img.src = '';
  if (!bmp) return null;
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, 8, 8);
  const d = ctx.getImageData(0, 0, 8, 8).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  return { bmp, r: r / 64, g: g / 64, b: b / 64, path };
}

const msPoolTarget = () => Math.min(MS.pool, images.length);

// 補縮圖池到 n 張（背景執行，一次一張）
async function msGrow(n) {
  if (msPoolBusy) return;
  msPoolBusy = true;
  let fails = 0;
  while (!wallStopped && msPool.length < n && fails < images.length) {
    const p = nextImagePathCycle();
    if (!p) break;
    if (msPool.some((t) => t.path === p)) { fails++; continue; }
    const t = await msMakeTile(p);
    if (t) msPool.push(t); else fails++;
    if (!msPool.length) continue;
    const m = el('mosaicMsg');
    if (m.textContent) m.textContent = window.I18N.t('mosaic.loading', { n: msPool.length, total: n });
  }
  msPoolBusy = false;
}

// 池滿後每輪換掉約 10%，讓馬賽克用到的小圖持續變化
function msRefresh() {
  if (images.length <= MS.pool || msPool.length < MS.pool) { msGrow(msPoolTarget()); return; }
  const k = Math.max(1, Math.round(MS.pool * 0.1));
  for (let i = 0; i < k && msPool.length; i++) {
    const j = Math.floor(Math.random() * msPool.length);
    msPool[j].bmp.close();
    msPool.splice(j, 1);
  }
  msGrow(msPoolTarget());
}

// 目標圖在畫面上的矩形（依縮放模式：cover 填滿，其餘 contain）
function msRect(nw, nh) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const s = cfg.scaleMode === 'cover' ? Math.max(vw / nw, vh / nh) : Math.min(vw / nw, vh / nh);
  const w = nw * s, h = nh * s;
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
}

// 準備一輪：載入目標圖、算每格平均色、為每格挑小圖
async function msPrepare() {
  let full = null, path = null;
  for (let tries = 0; tries < images.length && !full && !wallStopped; tries++) {
    path = nextImagePathCycle();
    if (!path) break;
    full = await loadFull(path);
  }
  if (!full || wallStopped) return null;
  const nw = full.naturalWidth, nh = full.naturalHeight;
  const rect = msRect(nw, nh);
  const cols = Math.max(4, Math.round(rect.w / MS.tile)), rows = Math.max(3, Math.round(rect.h / MS.tile));
  // 把目標圖縮成 cols×rows：每個像素就是一格的平均色
  const sc = document.createElement('canvas');
  sc.width = cols; sc.height = rows;
  const sctx = sc.getContext('2d', { willReadFrequently: true });
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(full, 0, 0, cols, rows);
  const px = sctx.getImageData(0, 0, cols, rows).data;
  sc.width = sc.height = 0;

  // 挑小圖：顏色距離（redmean 加權）＋ 使用次數懲罰，並避開左邊、上面相同的
  const pool = msPool.slice();
  const n = cols * rows;
  const assign = new Int32Array(n).fill(-1);
  const uses = new Float32Array(pool.length);
  const avg = n / pool.length;
  const order = shuffleArr(Array.from({ length: n }, (_, i) => i));
  for (const i of order) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    const left = i % cols ? assign[i - 1] : -1, up = i >= cols ? assign[i - cols] : -1;
    let best = 0, bestCost = Infinity;
    for (let k = 0; k < pool.length; k++) {
      if (pool.length > 2 && (k === left || k === up)) continue;
      const t = pool[k], rm = (r + t.r) / 2;
      const dr = r - t.r, dg = g - t.g, db = b - t.b;
      const dist = Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
      const cost = dist + (uses[k] / avg) * 40;
      if (cost < bestCost) { bestCost = cost; best = k; }
    }
    assign[i] = best;
    uses[best]++;
  }
  return { full, path, nw, nh, rect, cols, rows, px, pool, assign };
}

// 出現順序
function msOrder(job) {
  const { cols, rows } = job, n = cols * rows;
  const idx = Array.from({ length: n }, (_, i) => i);
  if (MS.order === 'random') return shuffleArr(idx);
  const key = new Float32Array(n);
  const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    key[i] = MS.order === 'sweep'
      ? c / cols + r / rows * 0.6 + Math.random() * 0.25
      : Math.hypot((c - cx) / cols, (r - cy) / rows) + Math.random() * 0.12;
  }
  return idx.sort((a, b) => key[a] - key[b]);
}

// 拼：在 buildMs 內分批畫完，同時鏡頭由 zoom 倍拉遠到 1 倍
async function msBuild(job) {
  const cv = el('mosaicCanvas');
  const k = (window.devicePixelRatio || 1) * msQ;
  cv.width = Math.round(window.innerWidth * k);
  cv.height = Math.round(window.innerHeight * k);
  const ctx = cv.getContext('2d', { alpha: false });
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  ctx.imageSmoothingQuality = 'medium';

  const { rect, cols, rows, px, pool, assign } = job;
  const tw = rect.w / cols, th = rect.h / rows;
  const gap = MS.tile >= 20 ? 1 : 0;           // 格線，看得出是一格一格
  const order = msOrder(job);

  // 鏡頭：從目標圖內隨機一點放大 zoom 倍開始，拉遠到 1 倍
  cv.style.transition = 'none';
  cv.style.transformOrigin = `${(rect.x + rect.w * (0.3 + Math.random() * 0.4)).toFixed(0)}px ${(rect.y + rect.h * (0.3 + Math.random() * 0.4)).toFixed(0)}px`;
  cv.style.transform = `scale(${MS.zoom})`;
  void cv.offsetWidth;
  el('mosaic').classList.remove('fade');
  if (MS.zoom > 1) {
    cv.style.transition = `transform ${MS.buildMs + MS.holdMs}ms cubic-bezier(.3,0,.2,1)`;
    cv.style.transform = 'scale(1)';
  }

  const t0 = performance.now();
  let done = 0;
  while (done < order.length && !wallStopped) {
    await new Promise((r) => requestAnimationFrame(r));
    const want = Math.min(order.length, Math.ceil(order.length * (performance.now() - t0) / MS.buildMs));
    for (; done < want; done++) {
      const i = order[done];
      const c = i % cols, r = Math.floor(i / cols);
      const x = rect.x + c * tw, y = rect.y + r * th;
      ctx.drawImage(pool[assign[i]].bmp, x, y, tw - gap, th - gap);
      if (MS.tint > 0) {
        ctx.fillStyle = `rgba(${px[i * 4]},${px[i * 4 + 1]},${px[i * 4 + 2]},${MS.tint})`;
        ctx.fillRect(x, y, tw - gap, th - gap);
      }
    }
  }
}

async function msLoop() {
  let pending = msPrepare();
  while (!wallStopped) {
    const job = await pending;
    if (wallStopped) return;
    if (!job) { showMessage(window.I18N.t('msg.noImages')); return; }
    current = { path: job.path, index: 0, nw: job.nw, nh: job.nh };
    if (infoVisible) updateInfo();

    await msBuild(job);
    if (wallStopped) return;
    msRefresh();                 // 換掉一部分池子（背景）
    pending = msPrepare();       // 下一輪在背景先準備
    await sleep(MS.holdMs);
    if (wallStopped) return;

    // 原圖淡入
    const im = el('mosaicImg');
    im.src = job.full.src;
    try { await im.decode(); } catch { /* 解不開就直接顯示 */ }
    im.classList.add('on');
    await sleep(MS.revealMs + MS.origMs);
    if (wallStopped) return;

    // 淡出 → 清空
    el('mosaic').classList.add('fade');
    await sleep(600);
    im.classList.remove('on');
    im.removeAttribute('src');
    job.full.src = '';
  }
}

async function mosaicStart() {
  if (images.length === 0) { showMessage(window.I18N.t('msg.noImages')); return; }
  mosaicMode = true;
  wallStopped = false;
  MS = mosaicSettings();
  msQ = Math.min(2, MS.zoom);
  // canvas 最長邊不超過 4096，避免低階機器吃不消
  msQ = Math.min(msQ, 4096 / (Math.max(window.innerWidth, window.innerHeight) * (window.devicePixelRatio || 1)));
  msQ = Math.max(1, msQ);
  const r = document.documentElement.style;
  r.setProperty('--mosaic-reveal-ms', MS.revealMs + 'ms');
  r.setProperty('--mosaic-fit', cfg.scaleMode === 'cover' ? 'cover' : 'contain');
  document.body.classList.add('mosaic-mode');
  el('mosaic').classList.add('fade');
  // 先做一小批小圖就開始，其餘背景補
  const first = Math.min(msPoolTarget(), 24);
  const m = el('mosaicMsg');
  m.textContent = window.I18N.t('mosaic.loading', { n: 0, total: first });
  await msGrow(first);
  m.textContent = '';
  if (wallStopped) return;
  if (msPool.length === 0) { showMessage(window.I18N.t('msg.noImages')); return; }
  msGrow(msPoolTarget());
  msLoop();
}

// ==================== 無限畫布漫遊模式（Canvas）====================
// 流程：照片散布在一大張「世界」上（鬆散格狀＋隨機偏移、大小、傾斜）→
//       鏡頭飛到某一張（先拉遠、平移、再拉近）→ 停下來看（換上原始解析度）→
//       停留期間把畫面外的幾張換成新照片 → 飛往下一張 → …
// 繪製：整個畫面只有一張 <canvas>，每幀用 requestAnimationFrame 重畫。
//       每張照片的白框／圓角／陰影在載入時就「烤」成一張小圖（sprite），每幀只是 drawImage；
//       停下時的清晰原圖也先縮成剛好的螢幕解析度。這樣鏡頭怎麼縮放都不必重新繪製 DOM 圖層
//       （舊做法是縮放一整個巨大的 DOM 世界，瀏覽器得不斷重畫陰影與裁切，所以很卡）。
// 鏡頭：translate(畫面中心) rotate(−r) scale(s) translate(−x, −y)；
//       飛行時位置 ease-in-out、縮放在對數空間內插並在中段拉遠。
let canvasMode = false;
let CV = null;
let cvItems = [];      // { sprite, m, W, H, pad, path, nw, nh, cx, cy, w, h, rot, gx, gy, full, fullA }
let cvCam = { x: 0, y: 0, s: 1, r: 0 };
let cvFocus = null;
let cvAnim = null;     // 與 exitNow 相容（{ pause() }）
let cvNeedsRebuild = false;
let cvCtx = null;
let cvDirty = true;
let cvRaf = 0;
let cvFly_ = null;     // 飛行中：{ t0, dur, camAt(t), from }
let cvFades = [];      // 原圖淡入：{ it, t0, dur }
const CV_CELL = 1000;   // 世界座標中每格大小
const CV_SHADOW_BLUR = 30, CV_SHADOW_Y = 10;

function canvasSettings() {
  return {
    count: Math.max(6, Math.min(80, num(cfg.cnvCount, 30))),
    size: num(cfg.cnvSize, 70) / 100,          // 照片占格子的大小
    rotate: num(cfg.cnvRotate, 4),             // 最大傾斜
    view: num(cfg.cnvView, 80) / 100,          // 停下時照片占畫面
    flyMs: Math.max(300, num(cfg.cnvFlyMs, 3500)),
    holdMs: num(cfg.cnvHoldMs, 4000),
    replace: Math.max(0, num(cfg.cnvReplace, 3)),
    radius: num(cfg.cnvRadius, 6),
    frame: cfg.cnvFrame === true,
    thumbScale: num(cfg.cnvThumbScale, 1),
  };
}

// ---- 畫布 ----
function cvEnsureCanvas() {
  let c = el('cvCanvas');
  if (!c) {
    c = document.createElement('canvas');
    c.id = 'cvCanvas';
    el('cvStage').appendChild(c);
  }
  const dpr = window.devicePixelRatio || 1;
  const W = Math.round(window.innerWidth * dpr), H = Math.round(window.innerHeight * dpr);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  cvCtx = c.getContext('2d', { alpha: true });
  cvCtx.imageSmoothingQuality = 'medium';
  cvDirty = true;
}

function cvSetCam(c) {
  cvCam = { ...c };
  cvDirty = true;
}

// 鏡頭 c 下，這張是否（部分）在畫面內
function cvVisible(it, c, margin = 0.15) {
  const hw = window.innerWidth / 2 / c.s, hh = window.innerHeight / 2 / c.s;
  const r = Math.max(it.w, it.h) * 0.75 + (it.pad || 0) + CV_SHADOW_BLUR;
  return Math.abs(it.cx - c.x) < hw * (1 + margin) + r && Math.abs(it.cy - c.y) < hh * (1 + margin) + r;
}

function cvRoundRect(g, x, y, w, h, r) {
  g.beginPath();
  if (r > 0) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
}

function cvDraw(now) {
  const g = cvCtx;
  if (!g) return;
  const dpr = window.devicePixelRatio || 1;
  const c = cvCam;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, g.canvas.width, g.canvas.height);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.translate(window.innerWidth / 2, window.innerHeight / 2);
  g.rotate((-(c.r || 0) * Math.PI) / 180);
  g.scale(c.s, c.s);
  g.translate(-c.x, -c.y);
  for (const it of cvItems) {
    if (!it.sprite || !cvVisible(it, c, 0.05)) continue;
    g.save();
    g.translate(it.cx, it.cy);
    g.rotate((it.rot * Math.PI) / 180);
    const ox = it.W / 2 + it.m, oy = it.H / 2 + it.m;
    g.drawImage(it.sprite, -ox, -oy, it.W + it.m * 2, it.H + it.m * 2);
    if (it.full && it.fullA > 0) {
      g.globalAlpha = it.fullA;
      if (!CV.frame && CV.radius > 0) { cvRoundRect(g, -it.w / 2, -it.h / 2, it.w, it.h, CV.radius); g.clip(); }
      g.drawImage(it.full, -it.w / 2, -it.h / 2, it.w, it.h);
    }
    g.restore();
  }
}

function cvTick(now) {
  cvRaf = 0;
  if (!canvasMode || wallStopped) return;
  if (cvFly_) {
    const t = Math.min(1, (now - cvFly_.t0) / cvFly_.dur);
    cvCam = cvFly_.camAt(t);
    // 拉遠到一定程度後放掉上一張的原圖（此時已經小到看不出差別）
    if (t > 0.4 && cvFly_.from && cvFly_.from.full) cvDropFull(cvFly_.from);
    if (t >= 1) { const done = cvFly_.done; cvFly_ = null; done(); }
    cvDirty = true;
  }
  if (cvFades.length) {
    cvFades = cvFades.filter((f) => {
      f.it.fullA = Math.min(1, (now - f.t0) / f.dur);
      return f.it.fullA < 1 && f.it.full;
    });
    cvDirty = true;
  }
  if (cvDirty) { cvDirty = false; cvDraw(now); }
  cvRaf = requestAnimationFrame(cvTick);
}

function cvKick() {
  cvDirty = true;
  if (!cvRaf) cvRaf = requestAnimationFrame(cvTick);
}

// ---- 照片 ----
// 一張照片的世界尺寸：放進 (CELL×size×隨機 0.75～1) 的方框，保留原圖比例（限制 1:2～2:1）
function cvItemSize(nw, nh) {
  const box = CV_CELL * CV.size * (0.75 + Math.random() * 0.25);
  const a = Math.max(0.5, Math.min(2, nw / nh));
  return a >= 1 ? { w: box, h: box / a } : { w: box * a, h: box };
}

async function cvLoadThumb(path) {
  // 飛行中看到的縮圖解析度不用高（停下時會換上原圖）
  const L = Math.round(480 * CV.thumbScale * Math.min(2, window.devicePixelRatio || 1));
  return makeBoxThumb(path, (nw, nh) => {
    const a = Math.max(0.5, Math.min(2, nw / nh));
    return a >= 1 ? { w: L, h: Math.round(L / a) } : { w: Math.round(L * a), h: L };
  }, 1);
}

// 把縮圖連同白框／圓角／陰影烤成一張 sprite（以縮圖的解析度為準）
function cvBake(it, thumb) {
  const pad = CV.frame ? Math.round(Math.min(it.w, it.h) * 0.045) : 0;
  const W = it.w + pad * 2, H = it.h + pad * 2;
  const m = CV_SHADOW_BLUR + CV_SHADOW_Y;          // 陰影需要的邊界（世界單位）
  const k = thumb.width / it.w;                    // 世界單位 → sprite 像素
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round((W + m * 2) * k));
  c.height = Math.max(1, Math.round((H + m * 2) * k));
  const g = c.getContext('2d');
  g.scale(k, k);
  const r = CV.frame ? 3 : CV.radius;
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.55)';
  g.shadowBlur = CV_SHADOW_BLUR * k;
  g.shadowOffsetY = CV_SHADOW_Y * k;
  cvRoundRect(g, m, m, W, H, r);
  g.fillStyle = CV.frame ? '#f4f2ec' : '#111';
  g.fill();
  g.restore();
  g.save();
  if (!CV.frame) { cvRoundRect(g, m, m, W, H, r); g.clip(); }
  g.drawImage(thumb, m + pad, m + pad, it.w, it.h);
  g.restore();
  Object.assign(it, { sprite: c, m, W, H, pad });
}

function cvSetImage(it, th) {
  if (it.sprite) freeCanvas(it.sprite);
  cvDropFull(it);
  const sz = cvItemSize(th.nw, th.nh);
  Object.assign(it, { path: th.path, nw: th.nw, nh: th.nh, w: sz.w, h: sz.h });
  it.cx = (it.gx + 0.5) * CV_CELL + (Math.random() - 0.5) * CV_CELL * 0.22;
  it.cy = (it.gy + 0.5) * CV_CELL + (Math.random() - 0.5) * CV_CELL * 0.22;
  it.rot = (Math.random() * 2 - 1) * CV.rotate;
  cvBake(it, th.canvas);
  freeCanvas(th.canvas);
  cvKick();
}

// 停在這張時，鏡頭的位置與縮放（含白框）
function cvCamFor(it) {
  const pad = CV.frame ? Math.min(it.w, it.h) * 0.045 * 2 : 0;
  const s = Math.min(window.innerWidth * CV.view / (it.w + pad), window.innerHeight * CV.view / (it.h + pad));
  return { x: it.cx, y: it.cy, s, r: it.rot }; // 鏡頭跟著照片傾斜，停下時照片是正的
}

async function cvBuild() {
  const stage = el('cvStage');
  if (cvItems.length) { stage.classList.add('fade'); await sleep(700); }
  if (wallStopped) return false;
  cvItems.forEach((it) => { freeCanvas(it.sprite); cvDropFull(it); });
  cvItems = [];
  cvFades = [];
  cvFly_ = null;
  cvEnsureCanvas();
  const n = Math.min(CV.count, Math.max(6, images.length));
  const cols = Math.max(3, Math.round(Math.sqrt(n * 16 / 9)));
  for (let i = 0; i < n; i++) {
    const th = await cvLoadThumb(nextImagePathCycle() || '');
    if (wallStopped) return false;
    if (!th) continue;
    const it = { sprite: null, full: null, fullA: 0, gx: i % cols, gy: Math.floor(i / cols) };
    cvSetImage(it, th);
    cvItems.push(it);
  }
  if (cvItems.length === 0) { showMessage(window.I18N.t('msg.noImages')); return false; }
  cvFocus = rand(cvItems);
  cvSetCam(cvCamFor(cvFocus));
  cvKick();
  stage.classList.remove('fade');
  await sleep(700);
  return true;
}

// 下一個目的地：不要太近也不要太遠（優先 1.2～3 格距離）
function cvPickNext() {
  const others = cvItems.filter((it) => it !== cvFocus);
  if (!others.length) return cvFocus;
  const d = (it) => Math.hypot(it.cx - cvFocus.cx, it.cy - cvFocus.cy) / CV_CELL;
  const good = others.filter((it) => d(it) >= 1.2 && d(it) <= 3);
  return rand(good.length ? good : others);
}

// 飛行：位置 ease-in-out、縮放對數內插並在中段拉遠到能同時看到起訖兩張
function cvFly(to, from) {
  const A = { ...cvCam }, B = cvCamFor(to);
  const dx = Math.abs(B.x - A.x), dy = Math.abs(B.y - A.y);
  const fit = Math.min(window.innerWidth / (dx + CV_CELL), window.innerHeight / (dy + CV_CELL)) * 0.9;
  const sMid = Math.min(A.s, B.s, fit);
  const la = Math.log(A.s), lb = Math.log(B.s), lm = Math.log(sMid);
  const bump = Math.max(0, (la + lb) / 2 - lm);
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const camAt = (t) => {
    const u = ease(t);
    return {
      x: A.x + (B.x - A.x) * u,
      y: A.y + (B.y - A.y) * u,
      s: Math.exp(la + (lb - la) * u - bump * Math.sin(Math.PI * t)),
      r: (A.r || 0) + ((B.r || 0) - (A.r || 0)) * u,
    };
  };
  return new Promise((resolve) => {
    cvFly_ = { t0: performance.now(), dur: CV.flyMs, camAt, from, done: () => { cvCam = B; resolve(); } };
    cvAnim = { pause() { cvFly_ = null; } };
    cvKick();
  }).then(() => { cvAnim = null; });
}

// 停下：換上原始解析度（先縮到剛好的螢幕像素，cover 裁切同縮圖）
async function cvSharpen(it) {
  const full = await loadFull(it.path);
  if (!full || wallStopped || it !== cvFocus) return;
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.max(1, Math.round(it.w * cvCam.s * dpr)), ph = Math.max(1, Math.round(it.h * cvCam.s * dpr));
  const nw = full.naturalWidth, nh = full.naturalHeight;
  let sx = 0, sy = 0, sw = nw, sh = nh;
  if (nw / nh > it.w / it.h) { sw = Math.round(nh * it.w / it.h); sx = Math.round((nw - sw) / 2); }
  else { sh = Math.round(nw * it.h / it.w); sy = Math.round((nh - sh) / 2); }
  let bmp = null;
  try {
    bmp = await createImageBitmap(full, sx, sy, sw, sh,
      { resizeWidth: Math.min(pw, sw), resizeHeight: Math.min(ph, sh), resizeQuality: 'high' });
  } catch { bmp = null; }
  full.src = '';
  if (!bmp) return;
  if (it !== cvFocus || wallStopped) { bmp.close(); return; }
  cvDropFull(it);
  it.full = bmp;
  it.fullA = 0;
  cvFades.push({ it, t0: performance.now(), dur: 400 });
  cvKick();
}

function cvDropFull(it) {
  if (!it || !it.full) return;
  if (it.full.close) it.full.close();
  it.full = null;
  it.fullA = 0;
  cvDirty = true;
}

// 停留期間：把現在和下一段飛行都看不到的幾張換成新照片
async function cvReplaceSome(nextCam) {
  const cands = shuffleArr(cvItems.filter((it) => it !== cvFocus
    && !cvVisible(it, cvCam, 0.3) && !cvVisible(it, nextCam, 0.3)));
  for (const it of cands.slice(0, CV.replace)) {
    const th = await cvLoadThumb(nextImagePathCycle() || '');
    if (wallStopped) return;
    if (th && !cvVisible(it, cvCam, 0.3)) cvSetImage(it, th);
    else if (th) freeCanvas(th.canvas);
  }
}

async function cvLoop() {
  while (!wallStopped) {
    if (cvNeedsRebuild) {
      cvNeedsRebuild = false;
      if (!(await cvBuild())) return;
    }
    current = { path: cvFocus.path, index: 0, nw: cvFocus.nw, nh: cvFocus.nh };
    if (infoVisible) updateInfo();
    const next = cvPickNext();
    // 停留：換原圖、換掉看不到的幾張，至少停 holdMs
    await Promise.all([cvSharpen(cvFocus), cvReplaceSome(cvCamFor(next)), sleep(CV.holdMs)]);
    if (wallStopped) return;
    const from = cvFocus;
    cvFocus = next;
    await cvFly(next, from);
  }
}

async function canvasStart() {
  if (images.length === 0) { showMessage(window.I18N.t('msg.noImages')); return; }
  canvasMode = true;
  wallStopped = false;
  CV = canvasSettings();
  document.body.classList.add('canvas-mode');
  el('cvStage').classList.add('fade');
  if (await cvBuild()) cvLoop();
}

// ==================== 漂浮星空／泡泡模式（Float）====================
// 星空：縮圖在 3D 空間中由遠往近飛過（像星際飛行），越近越大、最後飛出畫面；
// 泡泡：圓形縮圖從畫面下方往上漂、左右輕擺，遠近不同大小與速度（視差）。
// 每隔幾秒，所有粒子暫停，挑一張正在畫面中段的用 hero 放大成大圖 → 收回 → 繼續。
// 效能：每個粒子一個 Web Animations 動畫（只動 transform / opacity，交給合成器），
//       飛完重新出生時換位置、換一張新縮圖；背景星點是一張靜態 canvas。
let floatMode = false;
let FL = null;
let flParts = [];      // { node, inner, canvas, anim, path, nw, nh, w, h, d }
let flBusy = false;

function floatSettings() {
  return {
    style: cfg.floatStyle === 'bubbles' ? 'bubbles' : 'stars',
    count: Math.max(6, Math.min(80, num(cfg.floatCount, 30))),
    size: num(cfg.floatSize, 22) / 100,                    // 縮圖大小（占畫面短邊）
    travelMs: Math.max(2000, num(cfg.floatTravelMs, 14000)), // 一張飛過／漂過的時間
    bigEveryMs: num(cfg.floatBigEveryMs, 10000),            // 每隔多久放大一張，0 = 不放大
    bigMs: num(cfg.floatBigMs, 3000),
    flyMs: num(cfg.floatFlyMs, 1000),
    bigScale: num(cfg.floatBigScale, 100) / 100,
    breathe: cfg.floatBreathe !== false,
    thumbScale: num(cfg.floatThumbScale, 1),
  };
}

function flBox(nw, nh) {
  const S = shortSide() * FL.size;
  if (FL.style === 'bubbles') return { w: Math.round(S), h: Math.round(S) };     // 泡泡：正方形裁成圓
  const a = Math.max(0.5, Math.min(2, nw / nh));
  return a >= 1 ? { w: Math.round(S), h: Math.round(S / a) } : { w: Math.round(S * a), h: Math.round(S) };
}

function flThumb() {
  // 星空飛到最近時會放大約 2 倍，縮圖解析度給 1.5 倍
  return nextBoxThumbCycle(flBox, FL.thumbScale * (FL.style === 'stars' ? 1.5 : 1)).then((th) => {
    if (th) { const b = flBox(th.nw, th.nh); th.w = b.w; th.h = b.h; }
    return th;
  });
}

function flSetImage(p, th) {
  if (p.canvas) { freeCanvas(p.canvas); p.canvas.remove(); }
  p.inner.appendChild(th.canvas);
  Object.assign(p, { canvas: th.canvas, path: th.path, nw: th.nw, nh: th.nh, w: th.w, h: th.h });
  Object.assign(p.node.style, { width: th.w + 'px', height: th.h + 'px', marginLeft: -th.w / 2 + 'px', marginTop: -th.h / 2 + 'px' });
}

// 一段飛行的關鍵影格
function flKeyframes(p) {
  const vw = window.innerWidth, vh = window.innerHeight;
  if (FL.style === 'stars') {
    const P = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fl-persp')) || 900;
    const R = Math.max(vw, vh) * 0.7;
    const ang = Math.random() * Math.PI * 2, r = R * (0.2 + 0.8 * Math.sqrt(Math.random()));
    const x = Math.cos(ang) * r, y = Math.sin(ang) * r * 0.75;
    const zf = -P * 8, zn = P * 0.55;
    const t = (z) => `translate3d(${x.toFixed(0)}px, ${y.toFixed(0)}px, ${z.toFixed(0)}px)`;
    return [
      { transform: t(zf), opacity: 0 },
      { transform: t(zf + (zn - zf) * 0.15), opacity: 1, offset: 0.15 },
      { transform: t(zf + (zn - zf) * 0.88), opacity: 1, offset: 0.88 },
      { transform: t(zn), opacity: 0 },
    ];
  }
  // 泡泡：深度 d 決定大小、透明度；由下往上，左右擺動
  const d = p.d, sc = 0.45 + 0.55 * d;
  const x0 = (Math.random() - 0.5) * vw * 0.95, amp = (20 + Math.random() * 50) * sc, ph = Math.random() * Math.PI * 2;
  const y0 = vh / 2 + p.h, y1 = -vh / 2 - p.h;
  const kf = [];
  for (let i = 0; i <= 8; i++) {
    const u = i / 8;
    const x = x0 + Math.sin(ph + u * Math.PI * 3) * amp;
    kf.push({
      transform: `translate(${x.toFixed(0)}px, ${(y0 + (y1 - y0) * u).toFixed(0)}px) scale(${sc.toFixed(3)})`,
      opacity: u === 0 || u === 1 ? 0 : 0.55 + 0.45 * d,
    });
  }
  return kf;
}

function flLaunch(p, startAt) {
  const dur = FL.style === 'stars'
    ? FL.travelMs * (0.8 + Math.random() * 0.4)
    : FL.travelMs * (1.5 - 0.7 * p.d) * (0.9 + Math.random() * 0.2);   // 遠的泡泡漂得慢
  const anim = p.node.animate(flKeyframes(p), { duration: dur, easing: 'linear', fill: 'both' });
  if (startAt) anim.currentTime = dur * startAt;
  p.anim = anim;
  anim.onfinish = () => {
    if (wallStopped || p.anim !== anim) return;
    if (FL.style === 'bubbles') { p.d = Math.random(); p.node.style.zIndex = String(Math.round(p.d * 100)); }
    flLaunch(p, 0);
    // 重新出生時換一張新圖（此時在遠處／畫面外，換圖看不出來）
    flThumb().then((th) => { if (!th) return; if (wallStopped) { freeCanvas(th.canvas); return; } flSetImage(p, th); });
  };
}

function flStarsBg() {
  const c = el('flStars');
  const w = window.innerWidth, h = window.innerHeight;
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const n = Math.round(w * h / (FL.style === 'stars' ? 2500 : 9000));
  for (let i = 0; i < n; i++) {
    const r = Math.random() * (FL.style === 'stars' ? 1.3 : 2.2) + 0.2;
    ctx.fillStyle = `rgba(255,255,255,${(Math.random() * (FL.style === 'stars' ? 0.7 : 0.25) + 0.05).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(Math.random() * w, Math.random() * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

async function flBuild() {
  const field = el('flField');
  field.classList.add('fade');
  flParts.forEach((p) => { if (p.anim) p.anim.cancel(); freeCanvas(p.canvas); p.node.remove(); });
  flParts = [];
  el('float').classList.toggle('bubbles', FL.style === 'bubbles');
  field.style.transformStyle = FL.style === 'stars' ? 'preserve-3d' : '';  // 星空要依遠近排序
  document.documentElement.style.setProperty('--fl-persp', Math.round(Math.max(800, shortSide() * 1.2)) + 'px');
  flStarsBg();
  for (let i = 0; i < FL.count; i++) {
    const th = await flThumb();
    if (wallStopped) return false;
    if (!th) break;
    const node = document.createElement('div');
    node.className = 'flp';
    const inner = document.createElement('div');
    inner.className = 'flp-inner';
    node.appendChild(inner);
    field.appendChild(node);
    const p = { node, inner, canvas: null, anim: null, d: Math.random() };
    if (FL.style === 'bubbles') node.style.zIndex = String(Math.round(p.d * 100));
    flSetImage(p, th);
    flParts.push(p);
    flLaunch(p, Math.random()); // 隨機進度開始，畫面一開始就是滿的
  }
  if (!flParts.length) { showMessage(window.I18N.t('msg.noImages')); return false; }
  field.classList.remove('fade');
  return true;
}

async function flSpotlight() {
  // 挑一張完全不透明（不在淡入淡出段）、完整在畫面內的；星空挑最大的（越近越大），泡泡隨機
  const vw = window.innerWidth, vh = window.innerHeight;
  const cands = [];
  for (const p of flParts) {
    if (!p.anim) continue;
    const prog = (p.anim.currentTime || 0) / p.anim.effect.getTiming().duration;
    if (prog < 0.18 || prog > 0.85) continue;
    const r = p.inner.getBoundingClientRect();
    if (r.width < shortSide() * 0.05 || r.left < 0 || r.top < 0 || r.right > vw || r.bottom > vh) continue;
    cands.push({ p, w: r.width });
  }
  if (!cands.length) return;
  const p = FL.style === 'stars' ? cands.reduce((a, b) => (b.w > a.w ? b : a)).p : rand(cands).p;
  flBusy = true;
  flParts.forEach((q) => q.anim && q.anim.pause());
  current = { path: p.path, index: 0, nw: p.nw, nh: p.nh };
  if (infoVisible) updateInfo();
  const full = await loadFull(p.path);
  if (full && !wallStopped) {
    wallHeroImg = full;
    const dims = heroOpen(full, p.inner, FL.bigScale, FL.style === 'bubbles' ? Math.min(p.w, p.h) / 2 : 6);
    await sleep(FL.flyMs);
    if (!wallStopped) {
      heroSettled();
      document.body.classList.add('big');
      if (FL.breathe) el('heroImg').classList.add('breathe');
      await sleep(FL.bigMs);
      document.body.classList.remove('big');
      if (!wallStopped) {
        heroClose(p.inner, dims);
        await sleep(FL.flyMs);
        heroHide();
      }
    }
    wallHeroImg = null;
  }
  if (!wallStopped) flParts.forEach((q) => q.anim && q.anim.play());
  flBusy = false;
}

async function flLoop() {
  while (!wallStopped) {
    if (FL.bigEveryMs <= 0) return;
    await sleep(FL.bigEveryMs);
    if (wallStopped) return;
    await flSpotlight();
  }
}

async function floatStart() {
  if (images.length === 0) { showMessage(window.I18N.t('msg.noImages')); return; }
  floatMode = true;
  wallStopped = false;
  FL = floatSettings();
  const r = document.documentElement.style;
  r.setProperty('--fly-ms', FL.flyMs + 'ms');
  r.setProperty('--breathe-ms', Math.max(4000, FL.bigMs * 2) + 'ms');
  document.body.classList.add('float-mode');
  if (await flBuild()) flLoop();
}

// ==================== 時間軸模式（Timeline）====================
// 流程：讀每張照片的拍攝日期（EXIF DateTimeOriginal，沒有就用檔案修改時間）→ 依日期排序 →
//       一張張播放：照片交叉淡化、大字顯示日期；一側的直式時間軸（年份、月份＋張數）
//       同步捲動，讓目前這張的位置停在標記點上。
// 適合家庭相簿。不受「隨機順序」影響；「循環播放」關閉時播到最後一張就結束。
let timelineMode = false;
let TL = null;
let tlList = [];       // { path, t, exif }
let tlPos = [];        // 每張在時間軸上的 y
let tlMonthEls = [];   // { key, el }
let tlShowA = true;

function timelineSettings() {
  return {
    order: cfg.tlOrder === 'desc' ? 'desc' : 'asc',
    holdMs: Math.max(300, num(cfg.tlHoldMs, 4000)),
    fadeMs: num(cfg.tlFadeMs, 1000),
    side: cfg.tlSide === 'right' ? 'right' : 'left',
    kb: cfg.tlKb !== false,
    showTime: cfg.tlShowTime === true,
  };
}

const tlLocale = () => cfg.lang || navigator.language || 'zh-Hant';

async function tlLoadDates() {
  const m = el('tlMsg');
  const out = [];
  const CH = 200;
  for (let i = 0; i < images.length && !wallStopped; i += CH) {
    m.textContent = window.I18N.t('timeline.loading', { n: i, total: images.length });
    const part = images.slice(i, i + CH);
    let ds = null;
    try { ds = await window.api.photoDates(part); } catch { ds = null; }
    part.forEach((p, k) => {
      const d = ds && ds[k];
      out.push({ path: p, t: d ? d.t : 0, exif: !!(d && d.exif) });
    });
  }
  m.textContent = '';
  return out;
}

// 依排好的清單建立時間軸：年份標籤、月份標籤（含張數）、刻度，並算出每張的 y
function tlBuildAxis() {
  const axis = el('tlAxis');
  axis.innerHTML = '';
  tlPos = new Array(tlList.length);
  tlMonthEls = [];
  const vh = window.innerHeight;
  const step = Math.max(6, vh * 0.012), monthGap = vh * 0.055, yearGap = vh * 0.1, maxMonth = vh * 0.5;
  const fy = new Intl.DateTimeFormat(tlLocale(), { year: 'numeric' });
  const fm = new Intl.DateTimeFormat(tlLocale(), { month: 'long' });
  // 先算每個月有幾張
  const counts = new Map();
  for (const it of tlList) {
    const d = new Date(it.t), k = d.getFullYear() * 12 + d.getMonth();
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let y = 0, lastY = null, lastM = null, sp = step;
  const add = (cls, top, html) => {
    const e = document.createElement('div');
    e.className = cls;
    e.style.top = top.toFixed(1) + 'px';
    if (html !== undefined) e.innerHTML = html;
    axis.appendChild(e);
    return e;
  };
  tlList.forEach((it, i) => {
    const d = new Date(it.t), yr = d.getFullYear(), mk = yr * 12 + d.getMonth();
    if (yr !== lastY) {
      if (lastY !== null) y += yearGap * 0.6;
      add('tl-year', y, fy.format(d));
      y += yearGap;
      lastY = yr;
      lastM = null;
    }
    if (mk !== lastM) {
      if (lastM !== null) y += monthGap * 0.4;
      const c = counts.get(mk) || 1;
      add('tl-tick', y);
      const e = add('tl-month', y, `${fm.format(d)}<small>${c}</small>`);
      tlMonthEls.push({ key: mk, el: e });
      sp = Math.min(step, maxMonth / c);      // 一個月照片很多時壓縮間距
      y += monthGap * 0.6;
      lastM = mk;
    }
    tlPos[i] = y;
    y += sp;
  });
}

function tlScrollTo(i, animate) {
  const axis = el('tlAxis');
  const H = el('tlAxisBox').clientHeight;
  if (!animate) axis.style.transition = 'none';
  axis.style.transform = `translateY(${(H / 2 - tlPos[i]).toFixed(1)}px)`;
  if (!animate) { void axis.offsetWidth; axis.style.transition = ''; }
  const d = new Date(tlList[i].t), mk = d.getFullYear() * 12 + d.getMonth();
  for (const m of tlMonthEls) m.el.classList.toggle('on', m.key === mk);
}

function tlDateText(it) {
  const d = new Date(it.t);
  const opt = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' };
  if (TL.showTime) Object.assign(opt, { hour: '2-digit', minute: '2-digit' });
  let main = '';
  try { main = new Intl.DateTimeFormat(tlLocale(), opt).format(d); } catch { main = d.toLocaleString(); }
  const sub = it.exif ? '' : `<small>${window.I18N.t('timeline.fileDate')}</small>`;
  return main + sub;
}

// 顯示第 i 張（解碼完成才切換）；成功回傳 true
async function tlShow(i, first) {
  const it = tlList[i];
  const nextImg = el(tlShowA ? 'tlImgB' : 'tlImgA'), curImg = el(tlShowA ? 'tlImgA' : 'tlImgB');
  nextImg.src = toFileURL(it.path);
  try { await nextImg.decode(); } catch { nextImg.removeAttribute('src'); return false; }
  if (wallStopped) return false;
  nextImg.classList.remove('kb');
  void nextImg.offsetWidth;
  if (TL.kb) nextImg.classList.add('kb');
  nextImg.classList.add('on');
  curImg.classList.remove('on');
  setTimeout(() => { if (!curImg.classList.contains('on')) curImg.removeAttribute('src'); }, TL.fadeMs + 50);
  tlShowA = !tlShowA;
  const dt = el('tlDate');
  dt.style.opacity = '0';
  setTimeout(() => { dt.innerHTML = tlDateText(it); dt.style.opacity = '1'; }, first ? 0 : Math.min(400, TL.fadeMs / 2));
  tlScrollTo(i, !first);
  current = { path: it.path, index: i + 1, nw: nextImg.naturalWidth, nh: nextImg.naturalHeight };
  if (infoVisible) updateInfo();
  return true;
}

async function tlLoop() {
  let i = 0, first = true;
  while (!wallStopped) {
    if (i >= tlList.length) {
      if (!cfg.loop) {
        showMessage(window.I18N.t('msg.finished'));
        setTimeout(() => window.api.exitSlideshow(), 1500);
        return;
      }
      i = 0;
    }
    const ok = await tlShow(i, first);
    i++;
    if (!ok) continue;   // 壞圖跳過
    first = false;
    await sleep(TL.holdMs);
  }
}

async function timelineStart() {
  if (images.length === 0) { showMessage(window.I18N.t('msg.noImages')); return; }
  timelineMode = true;
  wallStopped = false;
  TL = timelineSettings();
  const vh = window.innerHeight;
  const r = document.documentElement.style;
  r.setProperty('--tl-move-ms', Math.max(300, TL.fadeMs) + 'ms');
  r.setProperty('--tl-fade-ms', TL.fadeMs + 'ms');
  r.setProperty('--tl-kb-ms', (TL.holdMs + TL.fadeMs * 2) + 'ms');
  r.setProperty('--tl-year-fs', Math.round(vh * 0.045) + 'px');
  r.setProperty('--tl-month-fs', Math.round(vh * 0.02) + 'px');
  r.setProperty('--tl-date-fs', Math.round(vh * 0.04) + 'px');
  el('tl').classList.toggle('right', TL.side === 'right');
  r.setProperty('--tl-line-x', TL.side === 'right' ? '30%' : '62%');
  document.body.classList.add('timeline-mode');
  tlList = await tlLoadDates();
  if (wallStopped) return;
  tlList.sort((a, b) => (TL.order === 'asc' ? a.t - b.t : b.t - a.t) || a.path.localeCompare(b.path));
  tlBuildAxis();
  tlLoop();
}

// 視窗大小改變時重建圖牆（欄寬變了，高度要重算）；輪盤則在下一輪開始前重建
let resizeTimer = null;
window.addEventListener('resize', () => {
  if (cfMode) { cfNeedsRebuild = true; return; }
  if (timelineMode) {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (!wallStopped && tlList.length) { tlBuildAxis(); } }, 400);
    return;
  }
  if (floatMode) {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (!wallStopped && !flBusy) flStarsBg(); }, 400);
    return;
  }
  if (canvasMode) { cvNeedsRebuild = true; return; }
  if (mosaicMode) return; // 每一輪都依當下視窗大小重新計算
  if (ringMode) { ringNeedsRebuild = true; return; }
  if (bookMode) { bookNeedsRebuild = true; return; }
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
  else if (cfg.effect === 'ring') ringStart();
  else if (cfg.effect === 'book') bookStart();
  else if (cfg.effect === 'mosaic') mosaicStart();
  else if (cfg.effect === 'canvas') canvasStart();
  else if (cfg.effect === 'float') floatStart();
  else if (cfg.effect === 'timeline') timelineStart();
  else start();
});
