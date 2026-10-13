const el = (id) => document.getElementById(id);

let selectedDir = null;
let imageCount = 0;

// 建立語言下拉選單並套用目前語言
function initLanguage(savedLang) {
  const sel = el('lang');
  sel.innerHTML = '';
  for (const l of window.I18N.LANGS) {
    const opt = document.createElement('option');
    opt.value = l.code;
    opt.textContent = l.name;
    sel.appendChild(opt);
  }
  // 優先使用已存的設定，其次瀏覽器語言，最後預設
  const lang = window.I18N.setLang(savedLang || navigator.language || window.I18N.DEFAULT_LANG);
  sel.value = lang;
  window.I18N.apply();
}

// 切換語言：即時套用並儲存
el('lang').addEventListener('change', async () => {
  window.I18N.setLang(el('lang').value);
  window.I18N.apply();
  refreshCountLabel(); // 重新翻譯動態的圖片數量訊息
  const s = (await window.api.loadSettings()) || {};
  s.lang = el('lang').value;
  await window.api.saveSettings(s);
});

// 依目前的 imageCount 重新繪製數量訊息（語言切換時用）
function refreshCountLabel() {
  if (!selectedDir) return;
  const c = el('count');
  if (imageCount > 0) {
    c.style.color = '#6ec26e';
    c.textContent = window.I18N.t('count.found', { n: imageCount });
  } else {
    c.style.color = '#e08a8a';
    c.textContent = window.I18N.t('count.none');
  }
}

// 啟動時還原上次的設定
async function restoreSettings() {
  const s = (await window.api.loadSettings()) || {};
  buildFxPanels();          // 先產生面板，語言套用時才翻得到
  initLanguage(s.lang);
  if (typeof s.dir === 'string' && s.dir) {
    selectedDir = s.dir;
    el('dir').value = s.dir;
  }
  if (typeof s.intervalMs === 'number') {
    el('interval').value = (s.intervalMs / 1000).toString();
  }
  if (typeof s.intensity === 'number') {
    el('intensity').value = s.intensity.toString();
  }
  if (typeof s.recursive === 'boolean') el('recursive').checked = s.recursive;
  if (typeof s.shuffle === 'boolean') el('shuffle').checked = s.shuffle;
  if (typeof s.loop === 'boolean') el('loop').checked = s.loop;
  if (typeof s.scaleMode === 'string') el('scaleMode').value = s.scaleMode;
  // 舊設定相容：fade 布林 → effect
  if (MODES.includes(s.effect)) {
    el('mode').value = s.effect;
    el('effect').value = typeof s.slideEffect === 'string' ? s.slideEffect : 'fade';
  } else if (typeof s.effect === 'string') el('effect').value = s.effect;
  else if (s.fade === false) el('effect').value = 'none';
  if (!el('effect').value) el('effect').value = 'fade';
  restoreWallFields(s);
  if (typeof s.wallSwapMode === 'string') el('wallSwapMode').value = s.wallSwapMode;
  if (typeof s.wallBreathe === 'boolean') el('wallBreathe').checked = s.wallBreathe;
  restoreWallFields(s, REEL_FIELDS);
  if (typeof s.reelAspect === 'number') {
    const opt = [...el('reelAspect').options].find((o) => Math.abs(parseFloat(o.value) - s.reelAspect) < 0.01);
    if (opt) el('reelAspect').value = opt.value;
  }
  if (typeof s.reelDir === 'string') el('reelDir').value = s.reelDir;
  if (typeof s.reelBreathe === 'boolean') el('reelBreathe').checked = s.reelBreathe;
  restoreWallFields(s, POLA_FIELDS);
  restoreAspect('polaAspect', s.polaAspect);
  if (typeof s.polaCaption === 'boolean') el('polaCaption').checked = s.polaCaption;
  restoreWallFields(s, CF_FIELDS);
  restoreAspect('cfAspect', s.cfAspect);
  if (typeof s.cfDir === 'string') el('cfDir').value = s.cfDir;
  if (typeof s.cfReflect === 'boolean') el('cfReflect').checked = s.cfReflect;
  if (typeof s.cfBreathe === 'boolean') el('cfBreathe').checked = s.cfBreathe;
  restoreWallFields(s, COLLAGE_FIELDS);
  if (typeof s.collageTrans === 'string') el('collageTrans').value = s.collageTrans;
  if (typeof s.collageKb === 'boolean') el('collageKb').checked = s.collageKb;
  restoreWallFields(s, FILM_FIELDS);
  restoreAspect('filmAspect', s.filmAspect);
  if (typeof s.filmDir === 'string') el('filmDir').value = s.filmDir;
  if (typeof s.filmTone === 'string') el('filmTone').value = s.filmTone;
  restoreWallFields(s, RING_FIELDS);
  if (typeof s.ringShape === 'string') el('ringShape').value = s.ringShape;
  if (typeof s.ringDir === 'string') el('ringDir').value = s.ringDir;
  restoreAspect('ringAspect', s.ringAspect);
  restoreWallFields(s, BOOK_FIELDS);
  restoreAspect('bookAspect', s.bookAspect);
  if (typeof s.bookPaper === 'string') el('bookPaper').value = s.bookPaper;
  restoreWallFields(s, MOSAIC_FIELDS);
  if (typeof s.mosaicOrder === 'string') el('mosaicOrder').value = s.mosaicOrder;
  restoreWallFields(s, CNV_FIELDS);
  restoreWallFields(s, FLOAT_FIELDS);
  if (typeof s.floatStyle === 'string') el('floatStyle').value = s.floatStyle;
  restoreWallFields(s, TL_FIELDS);
  if (typeof s.tlOrder === 'string') el('tlOrder').value = s.tlOrder;
  if (typeof s.tlSide === 'string') el('tlSide').value = s.tlSide;
  for (const k of ['filmGrain', 'filmShake', 'filmBreathe', 'ringBreathe', 'bookBreathe', 'cnvFrame', 'floatBreathe', 'tlKb', 'tlShowTime', 'pairPortrait']) {
    if (typeof s[k] === 'boolean') el(k).checked = s[k];
  }
  restoreFx(s);
  toggleEffectOpts();
  if (selectedDir) await refreshCount();
}

// ---- Pinterest 圖牆設定 ----
// [設定鍵, 輸入框 id, 預設值, 存檔時的換算(倍率)]  倍率 1000 = 秒轉毫秒
const WALL_FIELDS = [
  ['wallCols', 'wallCols', 6, 1],
  ['wallRows', 'wallRows', 8, 1],
  ['wallPushMs', 'wallPush', 4000, 1000],
  ['wallThumbScale', 'wallThumbScale', 1, 1],
  ['wallStaggerMs', 'wallStagger', 60, 1],
  ['wallGap', 'wallGap', 10, 1],
  ['wallRadius', 'wallRadius', 20, 1],
  ['wallHoldMs', 'wallHold', 1000, 1000],
  ['wallDim', 'wallDim', 40, 1],
  ['wallDimMs', 'wallDimMs', 500, 1000],
  ['wallSpotMs', 'wallSpot', 800, 1000],
  ['wallFlyMs', 'wallFly', 1000, 1000],
  ['wallBigMs', 'wallBig', 3000, 1000],
  ['wallBigScale', 'wallBigScale', 100, 1],
  ['wallSpots', 'wallSpots', 2, 1],
  ['wallReplacePct', 'wallReplacePct', 80, 1],
];

// ---- 橫向輪盤設定（格式同上）----
const REEL_FIELDS = [
  ['reelCount', 'reelCount', 12, 1],
  ['reelHeight', 'reelHeight', 50, 1],
  ['reelGap', 'reelGap', 24, 1],
  ['reelRadius', 'reelRadius', 16, 1],
  ['reelSpeed', 'reelSpeed', 2000, 1],
  ['reelAccelMs', 'reelAccel', 1000, 1000],
  ['reelSpinMs', 'reelSpin', 3000, 1000],
  ['reelStopMs', 'reelStop', 3000, 1000],
  ['reelDim', 'reelDim', 35, 1],
  ['reelDimMs', 'reelDimMs', 500, 1000],
  ['reelSpotMs', 'reelSpot', 800, 1000],
  ['reelFlyMs', 'reelFly', 1000, 1000],
  ['reelBigMs', 'reelBig', 3000, 1000],
  ['reelBigScale', 'reelBigScale', 100, 1],
  ['reelReplacePct', 'reelReplacePct', 50, 1],
  ['reelThumbScale', 'reelThumbScale', 1, 1],
];

// 非「一般輪播」的播放模式（存檔時 effect 直接記模式名稱）
const MODES = ['wall', 'reel', 'polaroid', 'coverflow', 'collage', 'filmstrip', 'ring', 'book', 'mosaic', 'canvas', 'float', 'timeline'];

// ---- 拍立得散落設定（格式同上）----
const POLA_FIELDS = [
  ['polaSize', 'polaSize', 55, 1],
  ['polaRotate', 'polaRotate', 12, 1],
  ['polaSpread', 'polaSpread', 20, 1],
  ['polaDropMs', 'polaDrop', 900, 1000],
  ['polaHoldMs', 'polaHold', 3000, 1000],
  ['polaStack', 'polaStack', 10, 1],
  ['polaFadeMs', 'polaFade', 1200, 1000],
  ['polaThumbScale', 'polaThumbScale', 1, 1],
];

// ---- 3D 封面流設定（格式同上）----
const CF_FIELDS = [
  ['cfSide', 'cfSide', 4, 1],
  ['cfSize', 'cfSize', 55, 1],
  ['cfAngle', 'cfAngle', 55, 1],
  ['cfSpacing', 'cfSpacing', 28, 1],
  ['cfDepth', 'cfDepth', 45, 1],
  ['cfSideDim', 'cfSideDim', 55, 1],
  ['cfMoveMs', 'cfMove', 800, 1000],
  ['cfHoldMs', 'cfHold', 2500, 1000],
  ['cfBigEvery', 'cfBigEvery', 4, 1],
  ['cfBigMs', 'cfBig', 3000, 1000],
  ['cfFlyMs', 'cfFly', 1000, 1000],
  ['cfBigScale', 'cfBigScale', 100, 1],
  ['cfRadius', 'cfRadius', 8, 1],
  ['cfThumbScale', 'cfThumbScale', 1, 1],
];

// ---- 拼貼格設定（格式同上）----
const COLLAGE_FIELDS = [
  ['collageMin', 'collageMin', 2, 1],
  ['collageMax', 'collageMax', 5, 1],
  ['collageSwapMs', 'collageSwap', 3000, 1000],
  ['collageTransMs', 'collageTransMs', 900, 1000],
  ['collageLayoutEvery', 'collageLayoutEvery', 8, 1],
  ['collageGap', 'collageGap', 12, 1],
  ['collageRadius', 'collageRadius', 12, 1],
  ['collageThumbScale', 'collageThumbScale', 1, 1],
];

// ---- 電影膠卷設定（格式同上）----
const FILM_FIELDS = [
  ['filmSize', 'filmSize', 45, 1],
  ['filmSpeed', 'filmSpeed', 60, 1],
  ['filmTilt', 'filmTilt', 0, 1],
  ['filmBigEveryMs', 'filmBigEvery', 12000, 1000],
  ['filmBigMs', 'filmBig', 3000, 1000],
  ['filmFlyMs', 'filmFly', 1000, 1000],
  ['filmBigScale', 'filmBigScale', 100, 1],
  ['filmThumbScale', 'filmThumbScale', 1, 1],
];

// ---- 3D 旋轉相簿設定（格式同上）----
const RING_FIELDS = [
  ['ringCount', 'ringCount', 10, 1],
  ['ringSize', 'ringSize', 45, 1],
  ['ringGap', 'ringGap', 30, 1],
  ['ringTilt', 'ringTilt', 8, 1],
  ['ringDim', 'ringDim', 30, 1],
  ['ringMoveMs', 'ringMove', 1400, 1000],
  ['ringHoldMs', 'ringHold', 2000, 1000],
  ['ringBigEvery', 'ringBigEvery', 5, 1],
  ['ringBigMs', 'ringBig', 3000, 1000],
  ['ringFlyMs', 'ringFly', 1000, 1000],
  ['ringBigScale', 'ringBigScale', 100, 1],
  ['ringRadius', 'ringRadius', 10, 1],
  ['ringThumbScale', 'ringThumbScale', 1, 1],
];

// ---- 翻頁書設定（格式同上）----
const BOOK_FIELDS = [
  ['bookSize', 'bookSize', 80, 1],
  ['bookPad', 'bookPad', 8, 1],
  ['bookFlipMs', 'bookFlip', 1400, 1000],
  ['bookHoldMs', 'bookHold', 3000, 1000],
  ['bookBigEvery', 'bookBigEvery', 0, 1],
  ['bookBigMs', 'bookBig', 3000, 1000],
  ['bookFlyMs', 'bookFly', 1000, 1000],
  ['bookBigScale', 'bookBigScale', 100, 1],
  ['bookThumbScale', 'bookThumbScale', 1, 1],
];

// ---- 馬賽克組合設定（格式同上）----
const MOSAIC_FIELDS = [
  ['mosaicTile', 'mosaicTile', 32, 1],
  ['mosaicPool', 'mosaicPool', 80, 1],
  ['mosaicTint', 'mosaicTint', 35, 1],
  ['mosaicZoom', 'mosaicZoom', 3, 1],
  ['mosaicBuildMs', 'mosaicBuild', 4000, 1000],
  ['mosaicHoldMs', 'mosaicHold', 3000, 1000],
  ['mosaicRevealMs', 'mosaicReveal', 2000, 1000],
  ['mosaicOrigMs', 'mosaicOrig', 3000, 1000],
];

// ---- 無限畫布漫遊設定（格式同上）----
const CNV_FIELDS = [
  ['cnvCount', 'cnvCount', 30, 1],
  ['cnvSize', 'cnvSize', 70, 1],
  ['cnvRotate', 'cnvRotate', 4, 1],
  ['cnvView', 'cnvView', 80, 1],
  ['cnvFlyMs', 'cnvFly', 3500, 1000],
  ['cnvHoldMs', 'cnvHold', 4000, 1000],
  ['cnvReplace', 'cnvReplace', 3, 1],
  ['cnvRadius', 'cnvRadius', 6, 1],
  ['cnvThumbScale', 'cnvThumbScale', 1, 1],
];

// ---- 漂浮星空／泡泡設定（格式同上）----
const FLOAT_FIELDS = [
  ['floatCount', 'floatCount', 30, 1],
  ['floatSize', 'floatSize', 22, 1],
  ['floatTravelMs', 'floatTravel', 14000, 1000],
  ['floatBigEveryMs', 'floatBigEvery', 10000, 1000],
  ['floatBigMs', 'floatBig', 3000, 1000],
  ['floatFlyMs', 'floatFly', 1000, 1000],
  ['floatBigScale', 'floatBigScale', 100, 1],
  ['floatThumbScale', 'floatThumbScale', 1, 1],
];

// ---- 時間軸設定（格式同上）----
const TL_FIELDS = [
  ['tlHoldMs', 'tlHold', 4000, 1000],
  ['tlFadeMs', 'tlFade', 1000, 1000],
];

// 比例下拉選單：找最接近的選項（存的是 1.333 這類小數）
function restoreAspect(id, v) {
  if (typeof v !== 'number') return;
  const opt = [...el(id).options].find((o) => Math.abs(parseFloat(o.value) - v) < 0.01);
  if (opt) el(id).value = opt.value;
}

// ---- 各切換效果的專屬設定 ----
// 面板依 fx.js 的 SPECS 動態產生：選到哪個效果就只顯示那個效果的參數，
// 每個效果的數值各自獨立儲存在 settings.json 的 fx 物件底下。
const fxId = (name, key) => 'fx_' + name + '_' + key;

function fxField(name, p) {
  const id = fxId(name, p.k);
  const d = document.createElement('div');
  d.className = 'field';
  const lab = document.createElement('label');
  lab.setAttribute('for', id);
  lab.setAttribute('data-i18n', p.label);
  d.appendChild(lab);
  if (p.kind === 'sel') {
    d.style.gridColumn = '1 / -1';
    const sel = document.createElement('select');
    sel.id = id;
    for (const [v, key] of p.opts) {
      const o = document.createElement('option');
      o.value = v;
      o.setAttribute('data-i18n', key);
      sel.appendChild(o);
    }
    d.appendChild(sel);
  } else {
    const inl = document.createElement('div');
    inl.className = 'inline';
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.id = id;
    inp.min = String(p.min); inp.max = String(p.max); inp.step = String(p.step);
    inl.appendChild(inp);
    if (p.unit) {
      const sp = document.createElement('span');
      sp.setAttribute('data-i18n', p.unit);
      inl.appendChild(sp);
    }
    d.appendChild(inl);
  }
  return d;
}

function fxPanel(name, spec) {
  const wrap = document.createElement('div');
  wrap.className = 'fxPanel';
  wrap.dataset.fx = name;
  const sub = document.createElement('div');
  sub.className = 'sub';
  const title = document.createElement('div');
  title.className = 'title';
  title.setAttribute('data-i18n', 'effect.' + name);
  sub.appendChild(title);
  if (spec.length === 0) {
    const h = document.createElement('div');
    h.className = 'hint';
    h.style.marginBottom = '12px';
    h.setAttribute('data-i18n', 'fx.noOpts');
    sub.appendChild(h);
  } else {
    const grid = document.createElement('div');
    grid.className = 'grid2';
    for (const p of spec) grid.appendChild(fxField(name, p));
    sub.appendChild(grid);
    const h = document.createElement('div');
    h.className = 'hint';
    h.style.marginBottom = '12px';
    h.setAttribute('data-i18n', 'fx.hint');
    sub.appendChild(h);
  }
  wrap.appendChild(sub);
  return wrap;
}

function buildFxPanels() {
  const host = el('fxOpts');
  host.innerHTML = '';
  for (const name of Object.keys(window.FX.SPECS)) {
    host.appendChild(fxPanel(name, window.FX.SPECS[name]));
  }
  // 「隨機」沒有自己的參數，只說明它會沿用各效果的設定
  host.appendChild(fxPanel('random', []));
  host.querySelector('[data-fx="random"] .hint').setAttribute('data-i18n', 'fx.randomHint');
}

function restoreFx(s) {
  const fx = window.FX.normalize(s);
  for (const name of Object.keys(window.FX.SPECS)) {
    for (const p of window.FX.SPECS[name]) {
      const inp = el(fxId(name, p.k));
      if (!inp) continue;
      const v = fx[name][p.k];
      inp.value = (p.kind === 'num' && p.mul !== 1) ? String(v / p.mul) : String(v);
    }
  }
}

function collectFx() {
  const out = {};
  for (const name of Object.keys(window.FX.SPECS)) {
    const o = {};
    for (const p of window.FX.SPECS[name]) {
      const inp = el(fxId(name, p.k));
      if (!inp) continue;
      if (p.kind === 'sel') { o[p.k] = inp.value; continue; }
      let v = parseFloat(inp.value);
      if (!isFinite(v)) v = p.def(2) / p.mul;
      v = Math.max(p.min, Math.min(p.max, v));
      o[p.k] = p.mul === 1 ? v : Math.round(v * p.mul);
    }
    out[name] = o;
  }
  return out;
}

// 只顯示目前選到的效果的設定面板
function toggleEffectOpts() {
  const mode = el('mode').value;
  const ef = el('effect').value;
  el('wallOpts').classList.toggle('on', mode === 'wall');
  el('reelOpts').classList.toggle('on', mode === 'reel');
  el('polaOpts').classList.toggle('on', mode === 'polaroid');
  el('cfOpts').classList.toggle('on', mode === 'coverflow');
  el('collageOpts').classList.toggle('on', mode === 'collage');
  el('filmOpts').classList.toggle('on', mode === 'filmstrip');
  el('ringOpts').classList.toggle('on', mode === 'ring');
  el('bookOpts').classList.toggle('on', mode === 'book');
  el('mosaicOpts').classList.toggle('on', mode === 'mosaic');
  el('cnvOpts').classList.toggle('on', mode === 'canvas');
  el('floatOpts').classList.toggle('on', mode === 'float');
  el('tlOpts').classList.toggle('on', mode === 'timeline');
  el('normalOpts').classList.toggle('off', mode !== 'normal');
  el('fxOpts').querySelectorAll('.fxPanel').forEach((w) => {
    w.classList.toggle('on', w.dataset.fx === ef);
  });
}
el('effect').addEventListener('change', toggleEffectOpts);
el('mode').addEventListener('change', toggleEffectOpts);

function restoreWallFields(s, fields = WALL_FIELDS) {
  for (const [key, id, def, mul] of fields) {
    const v = typeof s[key] === 'number' ? s[key] : def;
    el(id).value = String(mul === 1 ? v : v / mul);
  }
}

function collectWallFields(fields = WALL_FIELDS) {
  const out = {};
  for (const [key, id, def, mul] of fields) {
    const input = el(id);
    let v = parseFloat(input.value);
    if (!isFinite(v)) v = mul === 1 ? def : def / mul;
    const min = parseFloat(input.min), max = parseFloat(input.max);
    if (isFinite(min)) v = Math.max(min, v);
    if (isFinite(max)) v = Math.min(max, v);
    out[key] = mul === 1 ? v : Math.round(v * mul);
  }
  return out;
}

async function refreshCount() {
  if (!selectedDir) return;
  const recursive = el('recursive').checked;
  const images = await window.api.listImages(selectedDir, recursive);
  imageCount = images.length;
  refreshCountLabel();
  el('start').disabled = imageCount === 0;
}

el('pick').addEventListener('click', async () => {
  const dir = await window.api.selectDirectory();
  if (dir) {
    selectedDir = dir;
    el('dir').value = dir;
    await refreshCount();
  }
});

el('recursive').addEventListener('change', refreshCount);

el('start').addEventListener('click', async () => {
  if (!selectedDir || imageCount === 0) return;
  const interval = Math.max(0.5, parseFloat(el('interval').value) || 4);
  const intensity = Math.min(100, Math.max(0.1, parseFloat(el('intensity').value) || 2));
  const config = {
    dir: selectedDir,
    recursive: el('recursive').checked,
    intervalMs: Math.round(interval * 1000),
    intensity,
    shuffle: el('shuffle').checked,
    loop: el('loop').checked,
    scaleMode: el('scaleMode').value,
    effect: el('mode').value === 'normal' ? el('effect').value : el('mode').value,
    slideEffect: el('effect').value,
    lang: el('lang').value,
    wallSwapMode: el('wallSwapMode').value,
    wallBreathe: el('wallBreathe').checked,
    reelAspect: parseFloat(el('reelAspect').value) || 0,
    reelDir: el('reelDir').value,
    reelBreathe: el('reelBreathe').checked,
    polaAspect: parseFloat(el('polaAspect').value) || 0,
    polaCaption: el('polaCaption').checked,
    cfAspect: parseFloat(el('cfAspect').value) || 0,
    cfDir: el('cfDir').value,
    cfReflect: el('cfReflect').checked,
    cfBreathe: el('cfBreathe').checked,
    collageTrans: el('collageTrans').value,
    collageKb: el('collageKb').checked,
    filmAspect: parseFloat(el('filmAspect').value) || 1.5,
    filmDir: el('filmDir').value,
    filmTone: el('filmTone').value,
    filmGrain: el('filmGrain').checked,
    filmShake: el('filmShake').checked,
    filmBreathe: el('filmBreathe').checked,
    ringShape: el('ringShape').value,
    ringDir: el('ringDir').value,
    ringAspect: parseFloat(el('ringAspect').value) || 0.75,
    ringBreathe: el('ringBreathe').checked,
    bookAspect: parseFloat(el('bookAspect').value) || 0.75,
    bookPaper: el('bookPaper').value,
    bookBreathe: el('bookBreathe').checked,
    mosaicOrder: el('mosaicOrder').value,
    cnvFrame: el('cnvFrame').checked,
    floatStyle: el('floatStyle').value,
    floatBreathe: el('floatBreathe').checked,
    tlOrder: el('tlOrder').value,
    tlSide: el('tlSide').value,
    tlKb: el('tlKb').checked,
    tlShowTime: el('tlShowTime').checked,
    pairPortrait: el('pairPortrait').checked,
    fx: collectFx(),
    ...collectWallFields(),
    ...collectWallFields(REEL_FIELDS),
    ...collectWallFields(POLA_FIELDS),
    ...collectWallFields(CF_FIELDS),
    ...collectWallFields(COLLAGE_FIELDS),
    ...collectWallFields(FILM_FIELDS),
    ...collectWallFields(RING_FIELDS),
    ...collectWallFields(BOOK_FIELDS),
    ...collectWallFields(MOSAIC_FIELDS),
    ...collectWallFields(CNV_FIELDS),
    ...collectWallFields(FLOAT_FIELDS),
    ...collectWallFields(TL_FIELDS),
  };
  // 儲存設定，下次開啟時還原
  await window.api.saveSettings(config);
  await window.api.startSlideshow(config);
});

restoreSettings();
