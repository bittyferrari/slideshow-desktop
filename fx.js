// 各切換效果的「專屬設定」定義（設定頁與播放頁共用）
// 以 <script src="fx.js"> 載入，於全域提供 window.FX。
//
// 設計：每個效果有自己的一組參數，存在 settings.json 的 fx 物件底下，
//       例如 { fx: { kenburns: { durMs: 700, zoomFrom: 100, zoomTo: 118, origin: 'random' } } }
//       切換效果時彼此不互相影響，各自記住自己的數值。
//
// 舊版只有一個全域「動態幅度 intensity」，所有效果共用。
// 因此每個參數的預設值都寫成 intensity 的函式：intensity = 2 時
// 算出來的數值與舊版完全相同，舊設定升級後手感不變。

(function () {
  const r = (n) => Math.round(n * 10) / 10;

  // 參數種類：
  //   num  數字輸入（unit 決定單位標籤；mul=1000 表示畫面用「秒」、存檔用毫秒）
  //   sel  下拉選單（opts 為 [值, i18n key]）
  const EASE_OPTS = [
    ['linear', 'ease.linear'],
    ['ease', 'ease.ease'],
    ['ease-in', 'ease.in'],
    ['ease-out', 'ease.out'],
    ['ease-in-out', 'ease.inout'],
  ];
  const DIR_OPTS = [
    ['random', 'dir.random'],
    ['left', 'dir.left'],
    ['right', 'dir.right'],
    ['up', 'dir.up'],
    ['down', 'dir.down'],
  ];
  const ORIGIN_OPTS = [
    ['random', 'origin.random'],
    ['center', 'origin.center'],
  ];
  const AXIS_OPTS = [
    ['random', 'axis.random'],
    ['h', 'axis.h'],
    ['v', 'axis.v'],
  ];

  // 共用參數：進出場時間、緩動曲線
  const P_DUR = { k: 'durMs', label: 'fx.dur', kind: 'num', unit: 'unit.seconds', mul: 1000, min: 0.05, max: 10, step: 0.05, def: () => 700 };
  const P_EASE = (d) => ({ k: 'ease', label: 'fx.ease', kind: 'sel', opts: EASE_OPTS, def: () => d });
  const P_DIR = { k: 'dir', label: 'fx.dir', kind: 'sel', opts: DIR_OPTS, def: () => 'random' };
  const P_ORIGIN = { k: 'origin', label: 'fx.origin', kind: 'sel', opts: ORIGIN_OPTS, def: () => 'random' };
  const P_AXIS = { k: 'axis', label: 'fx.panAxis', kind: 'sel', opts: AXIS_OPTS, def: () => 'random' };
  const pct = (k, label, def) => ({ k, label, kind: 'num', unit: 'unit.percent', mul: 1, min: 5, max: 400, step: 1, def });

  // 每個效果有哪些參數（順序＝畫面上的排列順序）
  const SPECS = {
    fade: [P_DUR, P_EASE('ease-in-out')],
    slide: [P_DUR, P_EASE('ease'), P_DIR],
    zoom: [P_DUR, P_EASE('ease'), pct('zoomFrom', 'fx.zoomFrom', (i) => Math.round(100 * (1 + 0.10 * i)))],
    wipe: [P_DUR, P_EASE('ease-in-out'), P_DIR],
    kenburns: [
      P_DUR,
      pct('zoomFrom', 'fx.zoomFrom', () => 100),
      pct('zoomTo', 'fx.zoomTo', (i) => Math.round(100 * (1 + 0.09 * i))),
      P_ORIGIN,
    ],
    zoomout: [
      P_DUR,
      pct('zoomFrom', 'fx.zoomFrom', (i) => Math.round(100 * (1 + 0.10 * i))),
      pct('zoomTo', 'fx.zoomTo', () => 100),
      P_ORIGIN,
    ],
    pan: [
      P_DUR,
      pct('zoom', 'fx.panZoom', (i) => Math.round(100 * (1 + 0.11 * i))),
      { k: 'dist', label: 'fx.panDist', kind: 'num', unit: 'unit.percent', mul: 1, min: 0, max: 50, step: 0.5, def: (i) => r(2.5 * i) },
      P_AXIS,
      P_ORIGIN,
    ],
    drift: [
      P_DUR,
      pct('zoomFrom', 'fx.zoomFrom', (i) => Math.round(100 * (1 + 0.03 * i))),
      pct('zoomTo', 'fx.zoomTo', (i) => Math.round(100 * (1 + 0.08 * i))),
      { k: 'rotate', label: 'fx.rotate', kind: 'num', unit: 'unit.deg', mul: 1, min: -30, max: 30, step: 0.1, def: (i) => r(0.8 * i) },
      P_ORIGIN,
    ],
    crosszoom: [
      P_DUR,
      pct('zoomFrom', 'fx.czIn', (i) => Math.round(100 * (1 - 0.07 * i))),
      pct('zoomTo', 'fx.czOut', (i) => Math.round(100 * (1 + 0.10 * i))),
      pct('slowZoom', 'fx.slowZoom', (i) => Math.round(100 * (1 + 0.09 * i))),
    ],
    focus: [
      P_DUR,
      { k: 'blur', label: 'fx.blur', kind: 'num', unit: 'unit.px', mul: 1, min: 0, max: 100, step: 0.5, def: (i) => r(7 * i) },
      { k: 'focusMs', label: 'fx.focusDur', kind: 'num', unit: 'unit.seconds', mul: 1000, min: 0.1, max: 30, step: 0.1, def: () => 2100 },
      pct('zoomFrom', 'fx.zoomFrom', (i) => Math.round(100 * (1 + 0.03 * i))),
    ],
    none: [],
  };

  // 會出現在「隨機」抽選池裡的效果
  const EFFECTS = ['fade', 'slide', 'zoom', 'wipe', 'kenburns', 'zoomout', 'pan', 'drift', 'crosszoom', 'focus'];

  // 某個效果的預設設定（依舊版的 intensity 換算，預設 2）
  function defaultsFor(effect, intensity) {
    const i = typeof intensity === 'number' && isFinite(intensity) ? intensity : 2;
    const out = {};
    for (const p of SPECS[effect] || []) out[p.k] = p.def(i);
    return out;
  }

  // 把設定檔補齊成完整的 fx 物件（缺的欄位用預設值補；舊設定用 intensity 換算）
  function normalize(cfg) {
    const src = (cfg && cfg.fx) || {};
    const intensity = cfg && typeof cfg.intensity === 'number' ? cfg.intensity : 2;
    const out = {};
    for (const name of Object.keys(SPECS)) {
      const d = defaultsFor(name, intensity);
      const s = src[name] || {};
      for (const key of Object.keys(d)) {
        const v = s[key];
        d[key] = (typeof d[key] === 'number')
          ? (typeof v === 'number' && isFinite(v) ? v : d[key])
          : (typeof v === 'string' && v ? v : d[key]);
      }
      out[name] = d;
    }
    return out;
  }

  window.FX = { SPECS, EFFECTS, EASE_OPTS, DIR_OPTS, ORIGIN_OPTS, AXIS_OPTS, defaultsFor, normalize };
})();
