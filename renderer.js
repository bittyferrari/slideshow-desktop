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
  if (typeof s.effect === 'string') el('effect').value = s.effect;
  else if (s.fade === false) el('effect').value = 'none';
  restoreWallFields(s);
  if (typeof s.wallSwapMode === 'string') el('wallSwapMode').value = s.wallSwapMode;
  if (typeof s.wallBreathe === 'boolean') el('wallBreathe').checked = s.wallBreathe;
  toggleWallOpts();
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

// 只有選「Pinterest 圖牆」時才顯示細部設定
function toggleWallOpts() {
  el('wallOpts').classList.toggle('on', el('effect').value === 'wall');
}
el('effect').addEventListener('change', toggleWallOpts);

function restoreWallFields(s) {
  for (const [key, id, def, mul] of WALL_FIELDS) {
    const v = typeof s[key] === 'number' ? s[key] : def;
    el(id).value = String(mul === 1 ? v : v / mul);
  }
}

function collectWallFields() {
  const out = {};
  for (const [key, id, def, mul] of WALL_FIELDS) {
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
    effect: el('effect').value,
    lang: el('lang').value,
    wallSwapMode: el('wallSwapMode').value,
    wallBreathe: el('wallBreathe').checked,
    ...collectWallFields(),
  };
  // 儲存設定，下次開啟時還原
  await window.api.saveSettings(config);
  await window.api.startSlideshow(config);
});

restoreSettings();
