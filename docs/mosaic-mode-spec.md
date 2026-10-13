# 馬賽克組合模式（Mosaic Mode）規格

> 來源：`slideshow-desktop`（Electron 版）的 `slideshow.js`（`mosaicStart` / `msGrow` / `msPrepare` / `msBuild` / `msLoop`）、`slideshow.html`（`#mosaic` 區塊 CSS）、`index.html`（`#mosaicOpts`）、`renderer.js`（`MOSAIC_FIELDS`）。
> 寫法跟 `reel-mode-spec.md` 一樣，可直接拿來移植到 Android。

---

## 1. 一句話說明

挑一張目標圖，把它切成格子、算出每格平均色，從「縮圖池」裡挑顏色最接近的小圖填進每一格 → 小圖一格格出現，同時鏡頭由近拉遠，大圖輪廓慢慢浮現 → 停留 → 原圖在上面淡入 → 停留 → 淡出換下一張。

---

## 2. 流程

```
開始：先做 min(24, 池上限) 張小縮圖（畫面顯示「準備縮圖中… n / total」）→ 其餘在背景補
每一輪：
  [拼 buildMs（同時鏡頭拉遠，拉遠時間 = buildMs + holdMs）]
  [背景：池子換掉約 10%；準備下一輪的目標圖與配對]
  [馬賽克停留 holdMs] → [原圖淡入 revealMs] → [原圖停留 origMs] → [淡出 600ms]
```

圖片用完一律從頭再用。

---

## 3. 設定參數

| key | UI 標籤 | 預設 | 範圍 / 選項 | 說明 |
|---|---|---|---|---|
| `mosaicTile` | 每格大小 | 32 px | 8～120 | |
| `mosaicPool` | 縮圖池張數 | 80 | 10～300 | 實際上限 = min(此值, 圖片總數) |
| `mosaicTint` | 往目標色調整 | 35 % | 0～80 | 每格畫完小圖後蓋一層「該格平均色」，alpha = 此值 |
| `mosaicOrder` | 出現順序 | random | random / sweep / center | |
| `mosaicZoom` | 起始放大倍率 | 3× | 1～6 | 1 = 不拉遠 |
| `mosaicBuildMs` | 拼出時間 | 4000 ms | 0.2～30 秒 | |
| `mosaicHoldMs` | 馬賽克停留 | 3000 ms | 0～60 秒 | |
| `mosaicRevealMs` | 原圖淡入時間 | 2000 ms | 0.1～10 秒 | |
| `mosaicOrigMs` | 原圖停留 | 3000 ms | 0～60 秒 | |

設定頁提示文字：
「用很多張小縮圖依顏色拼出一張大圖，鏡頭由近拉遠讓輪廓慢慢浮現，最後原圖淡入。縮圖池越大顏色越準，但開頭準備越久。」

---

## 4. 縮圖池

- 每張：原圖取中央正方形 → 縮成 `T = min(192, tile × dpr × q)` 的正方形 ImageBitmap（q 見第 7 節）。
- 平均色：把小圖畫到 8×8 canvas，64 個像素取平均 RGB。
- 不重複加入同一路徑。
- 池滿且圖片總數 > 池上限時，每輪隨機丟掉 10%（釋放 bitmap）再補新的。

## 5. 目標圖與配對（核心）

```
目標矩形：縮放模式為 cover 時填滿畫面，否則 contain（置中，留黑邊）
cols = max(4, round(rect.w / tile))，rows = max(3, round(rect.h / tile))
每格平均色：把目標圖直接畫到 cols×rows 的 canvas（高品質縮小），每個像素就是一格
```

配對（每格挑一張池中的小圖；格子以隨機順序處理，讓使用次數分散得公平）：
```
距離（redmean 加權 RGB）：
  rm = (r1 + r2) / 2
  d  = sqrt((2 + rm/256)·dr² + 4·dg² + (2 + (255−rm)/256)·db²)
成本 = d + (此小圖已用次數 / 平均每張該用次數) × 40      平均 = 格數 / 池大小
跳過與左邊、上面那格相同的小圖（池 > 2 張時）
取成本最小者
```

## 6. 繪製

- canvas 尺寸 = 畫面 × dpr × q；黑底。
- 每格：`drawImage(小圖, x, y, tw − gap, th − gap)`（tile ≥ 20 時 gap = 1px，看得出格線）；
  再 `fillRect` 該格平均色（alpha = tint）。
- 出現順序：
  - random：全部隨機
  - sweep：依 `c/cols + 0.6·r/rows + rand·0.25` 排序（由左上斜掃過）
  - center：依「到中心的距離 + rand·0.12」排序
- 在 buildMs 內每一幀（rAF）畫到「應完成數量 = 總數 × 經過時間 / buildMs」。
- 鏡頭：canvas 的 transform-origin 設在目標矩形中央 30%～70% 範圍內隨機一點，
  從 `scale(zoom)` transition 到 `scale(1)`，時間 buildMs + holdMs，曲線 `cubic-bezier(.3,0,.2,1)`。

## 7. 原圖與效能

- 原圖用一個 `<img>` 蓋在上面（object-fit 同目標矩形的 contain/cover），opacity 淡入。
- canvas 解析度倍率 `q = clamp(min(2, zoom), 1, 4096 / (畫面長邊 × dpr))`：拉遠時不至於太糊，但最長邊不超過 4096。
- canvas 只在拼的過程中重畫；拉遠只動 transform。
- 每輪依當下視窗大小重新計算，所以不需要處理 resize。

## 8. 驗收清單

- [ ] 開頭顯示準備進度，之後不再等待
- [ ] 拉遠後看得出是目標圖（調整比例 0 時也大致看得出）
- [ ] 三種出現順序都正常；放大倍率 1 時不拉遠
- [ ] 原圖淡入時跟馬賽克位置完全對齊
- [ ] 點擊／按鍵立即退出
