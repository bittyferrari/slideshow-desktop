# Slideshow 切換效果規格（供 Android 專案移植用）

來源：`slideshow-desktop` 專案（Electron，CSS `@keyframes` 實作），本文件把每個效果的
參數、預設值與動畫公式整理出來，方便在 Android（例如用 `ValueAnimator` /
`Transition` / Compose `animate*AsState`）重現相同視覺效果。

## 共用觀念

- 每次切換有兩張圖：**incoming**（新圖，進場）與 **outgoing**（舊圖，退場），兩者同時播放各自的
  in / out 動畫，達成交叉淡出/切換的效果。
- 大部分效果的「進出場動畫」套在**容器（slide）**上（例如 fade/opacity、位移、裁切），
  另外還有些「慢動作類」動畫（Ken Burns 類）套在**圖片本身**上，時間比容器動畫長，
  會一路播到下一次切換前，营造持續的緩慢縮放/平移。
- 慢動作動畫總長 `kbDurMs = intervalMs(每張圖停留時間) + durMs(進場時間)`，
  緩動曲線固定為 `linear`。
- 除了固定效果外，還有一個 **`random`** 效果：每次切換時從效果池
  `[fade, slide, zoom, wipe, kenburns, zoomout, pan, drift, crosszoom, focus]`
  中隨機挑一個；另有 **`none`**：直接切換不做動畫。
- 每個效果的參數彼此獨立，各自保存自己的數值（不會共用同一組強度）。
- `origin`（縮放/慢動作的中心點）：`random` 時從
  `[20% 20%, 80% 20%, 20% 80%, 80% 80%, 50% 50%]` 隨機挑一個當作 transform-origin；
  `center` 固定為 `50% 50%`。
- `dir`（方向類參數，slide / wipe / pan 用）：`random` 時從對應方向清單隨機挑一個。

共用參數（所有效果都有，除了 `none`）：

| 參數 | 說明 | 單位 | 範圍 | 預設 |
|---|---|---|---|---|
| `durMs` | 進場/退場動畫時間 | 毫秒（UI 上顯示為秒） | 50 ~ 10000 | 700 |
| `ease` | 緩動曲線（多數效果可調） | `linear / ease / ease-in / ease-out / ease-in-out` | — | 依效果而定，見下 |

---

## 1. `fade`（淡入淡出）

- 參數：`durMs`（預設 700）、`ease`（預設 `ease-in-out`）
- 進場（incoming）：`opacity 0 → 1`
- 退場（outgoing）：`opacity 1 → 0`
- 兩者同時播放，形成交叉淡化（crossfade）。

```
in:  opacity: 0 -> 1   over durMs, ease-in-out
out: opacity: 1 -> 0   over durMs, ease-in-out
```

## 2. `slide`（滑動切換）

- 參數：`durMs`（700）、`ease`（預設 `ease`）、`dir`（方向，預設 `random`，可選 left/right/up/down）
- 新圖從畫面外一側滑入到定位，舊圖同方向滑出畫面。
- 依方向決定位移向量（translate %）：

| dir | 新圖起點 (sf) → 終點 | 舊圖起點 → 終點 (st) |
|---|---|---|
| left | `translate(100%, 0)` → `(0,0)` | `(0,0)` → `translate(-100%, 0)` |
| right | `translate(-100%, 0)` → `(0,0)` | `(0,0)` → `translate(100%, 0)` |
| up | `translate(0, 100%)` → `(0,0)` | `(0,0)` → `translate(0, -100%)` |
| down | `translate(0, -100%)` → `(0,0)` | `(0,0)` → `translate(0, 100%)` |

- 全程 `opacity: 1`（不淡化，純位移）。
- `dir=random` 時：每次切換從 `[left,right,up,down]` 隨機挑一個。

## 3. `zoom`（縮放進場）

- 參數：`durMs`（700）、`ease`（預設 `ease`）、`zoomFrom`（縮放起始百分比，預設 `100*(1+0.10*i)`，UI 預設約 120%）
- 進場：`scale(zoomFrom/100) → scale(1)`，同時 `opacity 0 → 1`
- 退場：與 `fade` 相同（`opacity 1 → 0`）

```
in:  transform: scale(zoomFrom/100 -> 1); opacity: 0 -> 1
out: opacity: 1 -> 0   (同 fade)
```

## 4. `wipe`（擦拭揭開）

- 參數：`durMs`（700）、`ease`（預設 `ease-in-out`）、`dir`（方向，預設 `random`）
- 用裁切（clip-path 的 inset，Android 對應可用 `Rect`/`ViewOutlineProvider` 或自訂 Canvas clip 動畫）由一側往另一側揭開新圖。
- inset 格式為 `top right bottom left`，從下表的起始值動畫到 `0 0 0 0`（完全展開）：

| dir | 起始 inset（新圖起點=完全裁掉的那一側） |
|---|---|
| right | `0 100% 0 0`（從左往右展開） |
| left | `0 0 0 100%`（從右往左展開） |
| up | `100% 0 0 0`（從下往上展開） |
| down | `0 0 100% 0`（從上往下展開） |

- 退場（outgoing）：`holdThenHide` — 前 99% 時間維持 `opacity: 1` 完全不透明（蓋在新圖下方直到快結束才消失），
  在最後 1% 瞬間切到 `opacity: 0`（linear，無緩動）。實務上可理解為「退場圖幾乎整段時間都保持顯示，
  在動畫結束瞬間才隱藏」，因為新圖用 clip-path 蓋上去，視覺上是「擦過去」的效果。

## 5. `kenburns`（經典 Ken Burns 緩慢放大）

- 參數：`durMs`（700，僅用於容器淡入淡出）、`zoomFrom`（100）、`zoomTo`（預設 `100*(1+0.09*i)`）、`origin`（預設 `random`）
- 容器（進出場）：與 `fade` 相同的淡入淡出（`ease-in-out`）。
- 圖片本身：另外疊加一個慢速縮放動畫，時間為 `kbDurMs = intervalMs + durMs`，`linear`：
  ```
  img: transform: scale(zoomFrom/100 -> zoomTo/100)   over kbDurMs, linear
       transform-origin: 依 origin 參數（random 五點 或 center）
  ```
- 這個慢動作動畫會一路持續到下一次切換觸發前（跨越圖片顯示的整個停留時間）。

## 6. `zoomout`（反向 Ken Burns，由近拉遠）

- 參數同 `kenburns`，但 `zoomFrom` 預設較大（`100*(1+0.10*i)`）、`zoomTo` 固定 100。
- 動畫公式與 `kenburns` 相同（`img: scale(zoomFrom/100 -> zoomTo/100)`），只是起訖值相反，
  視覺效果是「圖片從放大狀態緩緩縮小回原尺寸」。

## 7. `pan`（平移運鏡）

- 參數：`durMs`（700）、`zoom`（固定縮放倍率，預設 `100*(1+0.11*i)`）、`dist`（平移距離百分比，預設 `2.5*i`，範圍 0~50）、
  `axis`（`random / h / v`）、`origin`（`random`）
- 容器：與 `fade` 相同淡入淡出。
- 圖片：固定縮放（不隨時間改變），但在 `zoom` 倍率下沿一個軸做平移，時間 `kbDurMs`，`linear`：
  ```
  img: transform: scale(zoom/100) translate(pf -> pt)   over kbDurMs, linear
  ```
- `axis=h` 時在 X 軸平移（`translate(±dist%, 0)`），`axis=v` 時在 Y 軸平移（`translate(0, ±dist%)`）；
  `random` 時每次先隨機選軸向，再隨機決定正負方向（左→右 / 右→左，或 上→下 / 下→上）。

## 8. `drift`（漂移：縮放 + 旋轉）

- 參數：`durMs`（700）、`zoomFrom`（`100*(1+0.03*i)`）、`zoomTo`（`100*(1+0.08*i)`）、
  `rotate`（旋轉角度，度，預設 `0.8*i`，範圍 -30~30）、`origin`（`random`）
- 容器：與 `fade` 相同淡入淡出。
- 圖片：同時做縮放與旋轉，時間 `kbDurMs`，`linear`：
  ```
  img: transform: scale(zoomFrom/100) rotate(0deg)
                -> scale(zoomTo/100) rotate(rotate deg)   over kbDurMs, linear
  ```

## 9. `crosszoom`（交錯縮放淡化）

- 參數：`durMs`（700）、`zoomFrom`（新圖進場起始縮放，UI 標籤「czIn」，預設 `100*(1-0.07*i)`，通常 <100% 從小放大）、
  `zoomTo`（舊圖退場結束縮放，UI 標籤「czOut」，預設 `100*(1+0.10*i)`，通常 >100% 放大消失）、
  `slowZoom`（進場後圖片自身的慢速縮放終值，預設 `100*(1+0.09*i)`）
- 進場容器：`scale(zoomFrom/100) → scale(1)`，同時 `opacity 0 → 1`，`ease-out`
- 退場容器：`scale(1) → scale(zoomTo/100)`，同時 `opacity 1 → 0`，`ease-in`
- 進場圖片另外疊加慢動作縮放：`scale(1 → slowZoom/100)`，時間 `kbDurMs`，`linear`（與 kenburns 同機制）。

```
in:  transform: scale(zoomFrom/100 -> 1); opacity: 0 -> 1   (ease-out)
out: transform: scale(1 -> zoomTo/100);  opacity: 1 -> 0    (ease-in)
img(in): transform: scale(1 -> slowZoom/100)  over kbDurMs, linear
```

## 10. `focus`（模糊對焦）

- 參數：`durMs`（700，容器淡入淡出用）、`blur`（起始模糊 px，預設 `7*i`）、
  `focusMs`（對焦動畫時間，毫秒，預設 2100，UI 顯示秒）、`zoomFrom`（起始縮放，預設 `100*(1+0.03*i)`）
- 容器：與 `fade` 相同淡入淡出（`ease-in-out`）。
- 圖片：獨立的「對焦」動畫，時間為 `focusMs`（不是 kbDurMs），`ease-out`：
  ```
  img: filter: blur(blur px -> 0);
       transform: scale(zoomFrom/100 -> 1)
       over focusMs, ease-out
  ```
- 視覺效果：新圖一開始模糊且略放大，隨時間變清晰、縮回正常大小（像相機對焦）。

## 11. `none`（無效果）

- 無任何動畫、無參數，直接切換顯示。

---

## Android 移植建議對應

| CSS 概念 | Android 對應 |
|---|---|
| `opacity` 動畫 | `View.alpha` + `ValueAnimator` / `ObjectAnimator`，或 Compose `animateFloatAsState` |
| `transform: scale()` | `View.scaleX/scaleY`，或 Compose `Modifier.graphicsLayer(scaleX=, scaleY=)` |
| `transform: translate()` | `View.translationX/Y`（百分比需先換算成像素：`% * viewWidth/Height`） |
| `transform: rotate()` | `View.rotation` |
| `clip-path: inset()`（wipe） | 自訂 `Drawable`/`Canvas.clipRect`，或用 `ViewAnimationUtils` / 自訂 `Path` 裁切做揭開動畫 |
| `filter: blur()`（focus） | `RenderEffect.createBlurEffect`（API 31+）或 `RenderScript`/第三方模糊庫（低版本相容需另外處理） |
| `transform-origin` | View 的 `pivotX/pivotY`，或 Compose `graphicsLayer` 的 `transformOrigin` |
| 兩段動畫時間軸（容器 in/out + 圖片慢動作）| 用兩個獨立的 Animator：一個管進出場（跟隨 `durMs`），一個管圖片本身的慢速效果（跟隨 `kbDurMs` 或 `focusMs`），兩者可平行執行 |

## 效果池（`random` 會從此清單抽選）

```
fade, slide, zoom, wipe, kenburns, zoomout, pan, drift, crosszoom, focus
```
（`none` 不在隨機池內，需手動選擇）
