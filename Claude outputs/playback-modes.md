# Slideshow 播放模式完整規格（Android 移植用）

> 來源：`slideshow-desktop`（Electron 版）。本文件把桌面版**全部 13 種播放模式**的行為、參數、預設值、數學公式與效能做法整理在同一份，
> 可直接放進 Android 專案當實作依據（建議 Kotlin + Jetpack Compose / 自訂 View）。
> 各模式內文中的「§N」「第 N 節」指的是**該模式自己**的第 N 小節（例如圖牆裡的 §5 = 本文件 2.5）。
> 各模式章節內提到的 `slideshow.js`、`index.html` 等檔名，都是指桌面版原始碼位置，方便對照。

---

## 目錄

| # | 設定值 `effect` | 名稱 | 一句話 |
|---|---|---|---|
| 1 | `normal` | 一般輪播 | 單張全螢幕，12 種切換效果（含隨機／無），可選直式兩張並排 |
| 2 | `wall` | Pinterest 圖牆 | 瀑布流圖牆 → 變暗 → 一張亮起放大 → 收回 → 換部分圖 |
| 3 | `reel` | 輪盤 | 一排圖加速平移 → 減速精準停在某張正中 → 放大 → 收回 |
| 4 | `polaroid` | 拍立得散落 | 白框照片一張張丟到桌上疊起來，滿了整疊淡出 |
| 5 | `coverflow` | 3D 封面流 | 中間正面、兩側 3D 斜擺，整排一格格前移 |
| 6 | `collage` | 拼貼格 | 2～5 格雜誌版型，每次只換一格，定期換版型 |
| 7 | `filmstrip` | 電影膠卷 | 帶齒孔底片無限捲動，定期停下放大中間那格 |
| 8 | `ring` | 3D 旋轉相簿 | 旋轉木馬或立方體，轉一格停一下 |
| 9 | `book` | 翻頁書 | 左右兩頁各一張，右頁沿書脊 3D 翻過去 |
| 10 | `mosaic` | 馬賽克組合 | 小縮圖依顏色拼出大圖，鏡頭拉遠，原圖淡入 |
| 11 | `canvas` | 無限畫布漫遊 | 照片散布在大畫布上，鏡頭拉遠／平移／拉近飛到一張 |
| 12 | `float` | 漂浮星空／泡泡 | 縮圖由遠飛近（星空）或由下往上漂（泡泡） |
| 13 | `timeline` | 時間軸 | 依 EXIF 拍攝日期排序播放，旁邊時間軸顯示年月 |

> 設定存檔格式：`effect` 存播放模式名稱；若為一般輪播，`effect` 存的是切換效果名稱（`fade`、`slide`…），
> 非一般模式時另外用 `slideEffect` 記住一般模式選的切換效果。Android 版可直接拆成 `mode` + `slideEffect` 兩個欄位。

---

## 0. 所有模式共用

### 0.1 共用設定

| key | UI 標籤 | 預設 | 說明 |
|---|---|---|---|
| `dir` | 圖片目錄 | — | 支援格式：jpg、jpeg、png、gif、webp、bmp |
| `recursive` | 包含子目錄 | false | |
| `shuffle` | 隨機順序 | true | 開始時洗牌；循環到頭時重新洗牌（時間軸模式不受影響） |
| `loop` | 循環播放 | true | 關閉時：一般／拍立得播完顯示「播放完畢」1.5 秒後退出；時間軸播完結束；其餘「持續性畫面」模式（拼貼、膠卷、翻頁書、馬賽克…）一律從頭再用 |
| `scaleMode` | 縮放模式 | contain | `contain`（符合畫面）/ `cover`（填滿裁切）/ `fill`（拉伸）/ `none`（原始大小置中）/ `scale-down`（只縮不放）。Android 對應 `ImageView.ScaleType` 或 Compose `ContentScale` |
| `lang` | 介面語言 | 系統語言 | |

### 0.2 取圖順序

- 依序取 `images[idx++]`；走到底時 `loop` 為真 → `idx = 0`（若 `shuffle` 再洗牌一次），否則停止供圖。
- 壞圖／解碼失敗一律跳過，不中斷流程。
- 洗牌用 Fisher–Yates。

### 0.3 退出與資訊面板

- **退出**：播放中任何點擊或按鍵（Android：觸碰、遙控器任意鍵、返回鍵）立即退出；所有動畫暫停、協程取消、bitmap 釋放。
  每個 `await` / `delay` 之後都要檢查「是否已停止」（Android：`CoroutineScope` + `isActive` / `Job.cancel()`）。
- **資訊面板**：移動滑鼠時顯示目前圖片的 `上層資料夾\檔名`、`第幾張 / 總張數`、原圖尺寸、檔案大小、修改時間，2.5 秒無動作後隱藏。
  Android 可改成輕觸顯示（但要跟「觸碰退出」區分，例如輕觸顯示、長按或返回鍵退出）。

### 0.4 共用元件：Hero 放大動畫

圖牆、輪盤、封面流、膠卷、旋轉相簿、翻頁書、漂浮都用同一套「從縮圖位置放大成全螢幕大圖」的動畫，Android 寫成一個共用元件即可：

```
nw, nh = 原圖像素寬高
s  = min(screenW * bigScale / nw, screenH * bigScale / nh)    // contain，占畫面 bigScale
tw = nw * s ; th = nh * s
tx = (screenW - tw) / 2 ; ty = (screenH - th) / 2              // 終點置中

r  = 來源縮圖在螢幕上的矩形
k  = max(r.w / tw, r.h / th)                                   // cover 覆蓋來源
fx = r.left + (r.w - tw * k) / 2
fy = r.top  + (r.h - th * k) / 2

起點：translate(fx, fy) scale(k)  + inset clip 裁成來源矩形、圓角 = radius / k
終點：translate(tx, ty) scale(1)  （pivot = 左上角 0,0）
時間 flyMs，曲線 cubic-bezier(.22,.61,.36,1)；背後 rgba(0,0,0,0.96) 黑底同時淡入
```

- 展開完成後拿掉 clip（呼吸動畫才不會被框住）；收回前接回 clip，重新取一次來源矩形再反向播放。
- 大圖停留期間把底下的模式畫面隱藏（只合成一張圖）。
- 呼吸動畫（`*Breathe`）：`scale 1 → 1 + 0.02 × intensity`（預設 1.04），週期 `max(4000, bigMs × 2)` ms，ease-in-out、alternate、無限。
- 原圖只在要放大時載入，同時間只有一張；收回後立即釋放。載入失敗就跳過放大。
- Android 對應：一個全螢幕 `ImageView` / Compose `Image` 用 `graphicsLayer { translationX/Y, scaleX/Y, clip, shape }` 實作。

### 0.5 共用元件：縮圖管線（效能核心）

- 畫面上的磚塊／卡片**永遠只放縮圖**：先 cover 裁切成目標比例，再縮到 `顯示尺寸 × density × thumbScale` 像素，原圖解碼完立刻釋放。
- 解碼在背景執行緒（`Dispatchers.IO`），併發數 3。
- 下一批要用的縮圖在「停留」期間先做好，動畫進行中不解碼、不配置 bitmap、不重排版。
- 移除的縮圖主動 `recycle()`／交回快取。
- 只動 transform（translation / scale / rotation）與 alpha，不改寬高與位置屬性；變暗用一層全螢幕黑幕的 alpha，不對每張圖跑濾鏡。
- 螢幕旋轉 / 尺寸改變：設 `needsRebuild` 旗標，在下一輪（下一步）開始前淡出重建，不打斷進行中的動畫。

---

## 1. 一般輪播（`normal`）

### 1.1 一句話說明

全螢幕單張播放，每隔 `intervalMs` 換下一張，換圖時套用所選的切換效果（新舊兩張同時跑進場／退場動畫）。

### 1.2 設定參數

| key | UI 標籤 | 預設 | 範圍 | 說明 |
|---|---|---|---|---|
| `intervalMs` | 切換間隔 | 4000 ms | ≥ 0.5 秒（UI 以秒輸入，步進 0.5） | 每張停留時間 |
| `slideEffect` | 切換效果 | fade | fade / slide / zoom / wipe / kenburns / zoomout / pan / drift / crosszoom / focus / random / none | 見 §1.5 |
| `pairPortrait` | 直式照片兩張並排 | false | 開/關 | 見 §1.6 |
| `fx.<效果>.<參數>` | 各效果專屬設定 | 見 §1.5 | | 每個效果的參數各自獨立保存 |

### 1.3 播放流程

```
start：圖片清單為空 → 顯示「沒有圖片」
tick()：
  await next()                         // 解碼完成才切換
  若未停止 → delay(intervalMs) → tick()
```

- **自排程**：這張切完才排下一張（不用固定週期的 timer；系統卡頓後固定週期會「補發」積欠的回呼，造成連切兩張閃爍）。
  Android：協程 `while (isActive) { next(); delay(intervalMs) }`。
- **防重入**：上一次切換尚未完成時忽略新的觸發。

### 1.4 `next()` 雙緩衝切換

1. 兩個 slide 圖層 A / B 輪流使用：incoming = 目前沒顯示的那層，outgoing = 目前顯示的那層。
2. 找下一張能成功解碼的圖（壞圖跳過，最多試 `images.length` 次）；**解碼完成才開始切換**，避免黑屏或閃爍。
3. （§1.6）判斷是否並排。
4. 挑效果（`random` 時每次從效果池隨機挑一個）並把該效果的參數套到兩層。
5. outgoing 跑退場動畫、incoming 跑進場動畫（同一幀開始），然後交換 A / B 角色。
6. Ken Burns 類的「慢動作」掛在**圖片本身**而非圖層上，長度 `intervalMs + durMs`，所以舊圖淡出時慢動作不中斷、不跳回。

### 1.5 切換效果


來源：`slideshow-desktop` 專案（Electron，CSS `@keyframes` 實作），本文件把每個效果的
參數、預設值與動畫公式整理出來，方便在 Android（例如用 `ValueAnimator` /
`Transition` / Compose `animate*AsState`）重現相同視覺效果。

#### 共用觀念

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

#### 1.5.1 `fade`（淡入淡出）

- 參數：`durMs`（預設 700）、`ease`（預設 `ease-in-out`）
- 進場（incoming）：`opacity 0 → 1`
- 退場（outgoing）：`opacity 1 → 0`
- 兩者同時播放，形成交叉淡化（crossfade）。

```
in:  opacity: 0 -> 1   over durMs, ease-in-out
out: opacity: 1 -> 0   over durMs, ease-in-out
```

#### 1.5.2 `slide`（滑動切換）

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

#### 1.5.3 `zoom`（縮放進場）

- 參數：`durMs`（700）、`ease`（預設 `ease`）、`zoomFrom`（縮放起始百分比，預設 `100*(1+0.10*i)`，UI 預設約 120%）
- 進場：`scale(zoomFrom/100) → scale(1)`，同時 `opacity 0 → 1`
- 退場：與 `fade` 相同（`opacity 1 → 0`）

```
in:  transform: scale(zoomFrom/100 -> 1); opacity: 0 -> 1
out: opacity: 1 -> 0   (同 fade)
```

#### 1.5.4 `wipe`（擦拭揭開）

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

#### 1.5.5 `kenburns`（經典 Ken Burns 緩慢放大）

- 參數：`durMs`（700，僅用於容器淡入淡出）、`zoomFrom`（100）、`zoomTo`（預設 `100*(1+0.09*i)`）、`origin`（預設 `random`）
- 容器（進出場）：與 `fade` 相同的淡入淡出（`ease-in-out`）。
- 圖片本身：另外疊加一個慢速縮放動畫，時間為 `kbDurMs = intervalMs + durMs`，`linear`：
  ```
  img: transform: scale(zoomFrom/100 -> zoomTo/100)   over kbDurMs, linear
       transform-origin: 依 origin 參數（random 五點 或 center）
  ```
- 這個慢動作動畫會一路持續到下一次切換觸發前（跨越圖片顯示的整個停留時間）。

#### 1.5.6 `zoomout`（反向 Ken Burns，由近拉遠）

- 參數同 `kenburns`，但 `zoomFrom` 預設較大（`100*(1+0.10*i)`）、`zoomTo` 固定 100。
- 動畫公式與 `kenburns` 相同（`img: scale(zoomFrom/100 -> zoomTo/100)`），只是起訖值相反，
  視覺效果是「圖片從放大狀態緩緩縮小回原尺寸」。

#### 1.5.7 `pan`（平移運鏡）

- 參數：`durMs`（700）、`zoom`（固定縮放倍率，預設 `100*(1+0.11*i)`）、`dist`（平移距離百分比，預設 `2.5*i`，範圍 0~50）、
  `axis`（`random / h / v`）、`origin`（`random`）
- 容器：與 `fade` 相同淡入淡出。
- 圖片：固定縮放（不隨時間改變），但在 `zoom` 倍率下沿一個軸做平移，時間 `kbDurMs`，`linear`：
  ```
  img: transform: scale(zoom/100) translate(pf -> pt)   over kbDurMs, linear
  ```
- `axis=h` 時在 X 軸平移（`translate(±dist%, 0)`），`axis=v` 時在 Y 軸平移（`translate(0, ±dist%)`）；
  `random` 時每次先隨機選軸向，再隨機決定正負方向（左→右 / 右→左，或 上→下 / 下→上）。

#### 1.5.8 `drift`（漂移：縮放 + 旋轉）

- 參數：`durMs`（700）、`zoomFrom`（`100*(1+0.03*i)`）、`zoomTo`（`100*(1+0.08*i)`）、
  `rotate`（旋轉角度，度，預設 `0.8*i`，範圍 -30~30）、`origin`（`random`）
- 容器：與 `fade` 相同淡入淡出。
- 圖片：同時做縮放與旋轉，時間 `kbDurMs`，`linear`：
  ```
  img: transform: scale(zoomFrom/100) rotate(0deg)
                -> scale(zoomTo/100) rotate(rotate deg)   over kbDurMs, linear
  ```

#### 1.5.9 `crosszoom`（交錯縮放淡化）

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

#### 1.5.10 `focus`（模糊對焦）

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

#### 1.5.11 `none`（無效果）

- 無任何動畫、無參數，直接切換顯示。

---

#### Android 移植建議對應

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

#### 效果池（`random` 會從此清單抽選）

```
fade, slide, zoom, wipe, kenburns, zoomout, pan, drift, crosszoom, focus
```
（`none` 不在隨機池內，需手動選擇）


### 1.6 雙圖並排（`pairPortrait`）

> 來源：`slideshow-desktop`（Electron 版）的 `slideshow.js`（`next()` 內的並排判斷）、`slideshow.html`（`.slide.pair` CSS）、`index.html`（`#pairPortrait`）、`renderer.js`。
> 依 TODO 的建議，做成「一般輪播」模式的選項，而不是獨立模式。

#### 1.6.1 一句話說明

螢幕是橫的時候，連續兩張直式照片會並排顯示在同一個畫面，避免左右大片黑邊。

#### 1.6.2 設定

| key | UI 標籤 | 預設 | 說明 |
|---|---|---|---|
| `pairPortrait` | 直式照片兩張並排 | false | 只在「一般輪播」模式出現 |

設定頁提示文字：「螢幕是橫的時候，連續兩張直式照片會並排顯示，避免左右大片黑邊。」

#### 1.6.3 判斷規則

```
直式：高 > 寬 × 1.05
這張解碼完成後，若「選項開啟 且 螢幕寬 > 高 且 這張是直式 且 清單還有下一張（不跨過循環邊界）」：
  解碼下一張
  也是直式 → 並排，下一張算已播（索引 +1）
  不是直式（或解碼失敗）→ 不並排，下一張留給下一輪照常播放
```

#### 1.6.4 顯示

- 每個 slide 有第二個 `<img>`（平常隱藏）。並排時 slide 加 `pair`：兩張各寬 `50% − gap/2`，中間 gap 16px，各自 object-fit 依縮放模式。
- 切換效果照常套用；第二張複製第一張的 inline 樣式（效果變數、縮放原點），兩張動作一致。
- 停留時間跟單張相同（同一個切換間隔）。

#### 1.6.5 驗收清單

- [ ] 兩張直式連在一起時並排，橫式照片仍單張顯示
- [ ] 直式後面接橫式時，橫式不會被跳過
- [ ] 各種切換效果下兩張動作一致
- [ ] 直式螢幕不並排


---

## 2. Pinterest 圖牆（`wall`）

> 來源專案：slideshow-desktop（Electron）
> 相關檔案：`slideshow.js`（L286–L756 圖牆邏輯）、`slideshow.html`（L116–L200 圖牆 CSS）、
> `index.html`（設定 UI）、`renderer.js`（`WALL_FIELDS` 預設值對照表）
> 本文件用途：提供給 Android 專案照著實作同樣的視覺與節奏。

---

### 2.1 一句話描述

滿版的 masonry（磚牆／瀑布流）圖片牆 → 整個畫面變暗 → 其中一張慢慢「亮起來」→
從它原本的位置放大飛成全螢幕大圖 → 停留（帶呼吸動畫）→ 原路收回 →
（一輪可重複聚焦 N 張）→ 回復亮度 → 依比例換掉一部分舊圖 → 無限循環。

---

### 2.2 版面（Layout）

#### 2.2.1 結構層級

```
#wall            全螢幕容器，padding = gap，背景純黑，overflow: hidden
└─ #wallInner    絕對定位容器，inset = gap
   └─ .tile      每塊磚（絕對定位，left/top 固定 0，用 transform 決定位置）
      └─ .tile-inner   圓角 + overflow:hidden，負責進場／離場動畫
         ├─ <canvas>   縮圖（object-fit: cover，填滿磚塊）
         └─ .tile-veil 該磚專用黑幕（只有被聚焦那張會用）
#dimVeil         全域黑幕（z-index 4）
#hero            大圖層（z-index 6）
└─ #heroBox      負責位移／縮放（只動 transform）
   └─ #heroImg   負責呼吸動畫（object-fit: contain）
```

#### 2.2.2 欄寬計算

```
cols     = wallCols > 0 ? wallCols : auto
auto     = clamp(3, 10, round(screenWidth / 300))      // 每欄約 300px
innerW   = wallWidth  - gap * 2
wallH    = wallHeight - gap * 2
colW     = floor((innerW - gap * (cols - 1)) / cols)
```

#### 2.2.3 磚塊高度與定位（自製 masonry，不是等高格線）

- 每塊磚高度 `h = round(colW * (原圖高 / 原圖寬))` → **保持原圖比例，不裁切變形**。
- 放置規則：永遠放進「目前累計高度最短的那一欄」的最底部（shortest-column first）。
- 位置用 `translate3d(x, y, 0)`：
  ```
  x = col * (colW + gap)
  y = 該欄目前累計高度
  該欄累計高度 += h + gap
  ```
- **關鍵：位置變化只改 transform，絕不改 left/top/width/height**（避免 reflow）。

#### 2.2.4 填滿策略

- 目標：每欄堆到 `wallH * 1.25`（比可視區高 25%），畫面下緣外預留備援磚塊，
  這樣「往上推」時下方才有東西補位、不會露出黑底。
- 張數上限 `cap = max(cols, round(cols * wallRows))`。
- 換圖後若欄底露白，用 `topUpColumns()` 補到 `wallH * 1.15`，上限 `cols * wallRows * 1.5`。

#### 2.2.5 視窗尺寸改變

`resize` 事件 debounce 400ms 後整面重建（欄寬變了，所有高度都要重算）。
→ Android 對應：螢幕旋轉／多視窗尺寸變更時重建。

---

### 2.3 圖片載入管線（效能核心）

這一段是低階機器（ARM 平板、電視盒）能不能順跑的關鍵，Android 請照做。

1. **牆上的磚塊永遠不放原始大圖**，只放縮到剛好夠用的點陣圖。
   ```
   thumbW = round(colW * devicePixelRatio * wallThumbScale)
   thumbH = round(thumbW * 原圖高 / 原圖寬)
   ```
   Web 端用 `createImageBitmap(img, {resizeWidth, resizeHeight, resizeQuality:'high'})`
   畫進 `<canvas>`，畫完立刻 `img.src = ''` 釋放原圖。
   → Android 對應：`BitmapFactory.Options.inSampleSize` / Glide `.override(thumbW, thumbH)`，
     搭配 `RGB_565` 可再省一半記憶體（牆上是縮圖，畫質差異看不出來）。

2. **縮圖併發數固定為 3**（`preloadMany(n, concurrency = 3)`），避免解碼把 CPU 佔滿造成掉幀。

3. **磚塊移除時主動釋放記憶體**：`canvas.width = canvas.height = 0`（延遲 `pushMs + 200ms` 後執行）。
   → Android 對應：`bitmap.recycle()` 或交回 Glide/LruCache。

4. **原始解析度只在「要放大成大圖」時載入，且同時間只有一張**。
   大圖收回後立刻 `heroImg.removeAttribute('src')` 釋放。

5. 壞圖／載入失敗直接跳過，不中斷流程。

---

### 2.4 播放狀態機（一輪的完整節奏）

`wallLoop()` 無限迴圈，一輪（one cycle）依序做 5 件事：

| 步驟 | 動作 | 時間 |
|---|---|---|
| 1 | 圖牆靜止停留 | `wallHoldMs` |
| 2 | 全域黑幕淡入，畫面變暗 | `wallDimMs` |
| 3 | 聚焦 N 張（見 §5），每張之間間隔 `wallDimMs / 2` | N × 單張聚焦時間 |
| 4 | 全域黑幕淡出，回復亮度 | `wallDimMs` |
| 5 | 依 `wallReplacePct` 比例換掉舊圖（見 §6） | 視換圖方式 |

> 一輪結束後清掉所有磚塊的 `used` 標記（下一輪可重新被選中）。

**變暗的做法（重要）**：整個畫面變暗只靠 `#dimVeil` **單一一層全螢幕黑幕的 opacity**，
`opacity = 1 - (wallDim / 100)`。
**不要**對每塊磚各自跑 `filter: brightness()` —— 幾十塊磚各自做濾鏡會直接拖垮低階 GPU。
→ Android 對應：在 RecyclerView/容器上方疊一個全螢幕黑色 View，animate 它的 alpha。

---

### 2.5 聚焦單張（spotlightOne）

#### 2.5.1 挑選規則
- 候選 = 已顯示（`shown`）且 `y < wallH`（在可視範圍內）且本輪未被選過（無 `used`）的磚塊。
- 若候選為空，退而選所有可視磚塊。
- 從候選中**隨機**挑一張，標記 `used`。

#### 2.5.2 動作序列

1. **浮起＋自帶黑幕**：被選中的磚塊 `z-index: 5`（浮到全域黑幕之上），
   同時瞬間（無動畫）把它自己的 `.tile-veil` opacity 設成 `1 - dim`，
   讓它看起來跟其他磚塊一樣暗 —— 視覺上完全無縫。
2. **慢慢變亮**：`.tile-veil` opacity → 0，時間 `wallSpotMs`，easing `ease-in-out`。
   同時磚塊本體 `transform: scale(1.04)`，並加上外框光暈：
   ```
   box-shadow: 0 0 0 2px rgba(255,255,255,0.35), 0 18px 50px rgba(0,0,0,0.75);
   ```
   **同一時間在背景載入原始解析度大圖**（跟 `spotMs` 的等待並行，Promise.all）。
3. **飛出成大圖**（`heroOpen`，時間 `wallFlyMs`，easing `cubic-bezier(.22,.61,.36,1)`）：
   ```
   nw, nh = 原圖像素寬高
   s  = min(screenW * bigScale / nw, screenH * bigScale / nh)   // 等比縮到占畫面 bigScale
   tw = nw * s ;  th = nh * s                                    // 終點尺寸
   tx = (screenW - tw) / 2 ;  ty = (screenH - th) / 2            // 終點置中

   // 起點：把「終點尺寸」等比縮回磚塊的位置與大小
   r  = 磚塊在螢幕上的矩形 (left, top, width, height)
   k  = max(r.width / tw, r.height / th)
   fx = r.left + (r.width  - tw * k) / 2
   fy = r.top  + (r.height - th * k) / 2

   起點 transform: translate3d(fx, fy, 0) scale(k)
   終點 transform: translate3d(tx, ty, 0) scale(1)
   ```
   `#heroBox` 的 `transform-origin: 0 0`，寬高固定為 `tw × th`，**全程只動 transform**。
   同時 `#hero` 背景 `rgba(0,0,0,0.96)` 的 opacity 0 → 1（時間 `wallFlyMs`）。
   > 因為用 `max()` 求 k，起點會等比覆蓋磚塊範圍（cover），所以不會變形，
   > 觀感上就是「這張磚塊本身長大成大圖」。
   > Android 對應：Shared Element Transition，或手動對一個 ImageView 做
   > `translationX/Y + scaleX/Y`（`pivotX=0, pivotY=0`）。

4. **大圖停留** `wallBigMs`：
   - 進場動畫結束後把整面牆 `visibility: hidden`（`body.big #wall`），
     這段期間 GPU 只需處理一張圖 —— **這是省效能的重點之一**。
   - 若 `wallBreathe` 開啟，`#heroImg` 跑呼吸動畫：
     ```
     scale: 1 → 1 + 0.02 * intensity     (intensity 預設 2 → 1.04)
     duration: max(4000ms, wallBigMs * 2)
     easing: ease-in-out, infinite alternate
     ```
5. **收回**（`heroClose`，時間 `wallFlyMs`）：牆先恢復 visible，
   大圖用同一組公式算回磚塊位置（重新取一次磚塊矩形，因為牆可能已經動過），
   `#hero` opacity → 0。收完清掉 `src` 釋放記憶體。
6. 磚塊移除 `spot`，veil 歸零。

**單張聚焦總時長** ≈ `spotMs + flyMs + bigMs + flyMs`

---

### 2.6 換圖（一輪結束後）

隨機挑 `round(磚塊數 × replacePct / 100)` 張。
**縮圖一律先在背景全部做好，才開始播動畫**（避免動畫中途卡在解碼）。

#### 方式 A：`fade`（原地淡出淡入）
- 磚塊位置與高度不變，只換內容物。
- 依序（每張間隔 `staggerMs`）移除 `shown` → 淡出並 `scale(0.96) translateY(10px)`。
- 等 `staggerMs × n + max(400, dimMs × 0.8)` 後替換 canvas，再依序加回 `shown` 淡入。
- 動畫時間 `--tile-ms = max(300, round(dimMs * 0.8))`，easing `ease`。

#### 方式 B：`push`（預設，移除 → 下面往上推 → 欄底補新圖）
對每一張被選中的磚塊，逐一（間隔 `max(90ms, staggerMs × 2)`）做：
1. 該磚加上 `gone`：`opacity → 0, scale(0.86)`，時間 `pushMs × 0.6`。
2. **同一欄底下的所有磚塊往上重排**（`relayoutColumn`），
   每塊磚 transform 過渡時間 `pushMs`，easing `cubic-bezier(.22,.61,.36,1)`。
3. 在該欄最底部補上一張新圖，從畫面下緣外進場淡入。
4. `pushMs + 200ms` 後真正移除 DOM 並釋放縮圖記憶體。

全部推完後等 `pushMs`，再跑 `topUpColumns()` 補滿（新圖比例跟舊圖不同，欄底可能露白）。

> Android 對應：這就是 StaggeredGridLayoutManager + `notifyItemRemoved/Inserted`
> 搭配自訂 ItemAnimator 的效果；但因為要精準控制時間與 easing，
> 建議跟 Web 版一樣自己用絕對定位（自訂 ViewGroup）＋ ObjectAnimator 控制 translationY。

---

### 2.7 磚塊進場動畫

- 初始狀態：`.tile-inner { opacity: 0; transform: scale(0.96) translateY(10px); }`
- 顯示：加上 `shown` → `opacity: 1; transform: none;`，時間 `--tile-ms`，easing `ease`。
- 建牆時**逐張錯開**：第 i 張延遲 `staggerMs × i` 才顯示。
- 建牆完成後再等 `staggerMs × n + 400ms` 才開始主迴圈。

---

### 2.8 參數總表

| 設定鍵 | UI 名稱 | 預設 | 範圍 | 單位 | 說明 |
|---|---|---:|---|---|---|
| `wallCols` | 欄數（0＝自動） | 6 | 0–10 | 欄 | 0 = 依寬度自動（每欄約 300px，夾在 3–10） |
| `wallRows` | 每欄張數 | 8 | 1–20 | 張 | 用來算張數上限 `cols × rows` |
| `wallSwapMode` | 換圖方式 | `push` | push / fade | — | 見 §6 |
| `wallPushMs` | 往上推的時間 | 4000 | 100–5000 | ms | UI 以秒輸入（0.1–5） |
| `wallThumbScale` | 縮圖畫質倍率 | 1 | 0.4–3 | × | 越小越省效能，低階裝置建議 ≤1 |
| `wallStaggerMs` | 逐張顯示間隔 | 60 | 0–500 | ms | |
| `wallGap` | 圖片間距 | 10 | 0–60 | px | |
| `wallRadius` | 圓角 | 20 | 0–40 | px | |
| `wallHoldMs` | 圖牆停留 | 1000 | 500–120000 | ms | UI 以秒輸入 |
| `wallDim` | 變暗亮度 | 40 | 0–100 | % | 黑幕 opacity = `1 - dim/100` |
| `wallDimMs` | 變暗過程 | 500 | 100–10000 | ms | |
| `wallSpotMs` | 提高亮度時間 | 800 | 100–20000 | ms | |
| `wallFlyMs` | 放大／收回時間 | 1000 | 100–10000 | ms | 單趟 |
| `wallBigMs` | 大圖停留 | 3000 | 500–120000 | ms | |
| `wallBigScale` | 大圖占畫面 | 100 | 40–100 | % | |
| `wallSpots` | 每輪聚焦張數 | 2 | 1–20 | 張 | |
| `wallBreathe` | 大圖呼吸動畫 | true | bool | — | |
| `intensity` | 呼吸幅度 | 2 | — | × | `scale → 1 + 0.02 × intensity` |
| `wallReplacePct` | 每輪換圖比例 | 80 | 0–100 | % | 越高一輪過後畫面變化越大 |

其他共用設定：`shuffle`（洗牌）、`loop`（走完一輪是否重播）、`recursive`（含子資料夾）。
取圖是**依序**取 `images[idx++]`；走完一輪若 `loop` 為真則 `idx = 0` 並（若 `shuffle`）重新洗牌。

---

### 2.9 Android 實作時的效能鐵則（原專案註解直接翻過來）

1. 磚塊放縮圖，不放原始大圖 → 記憶體與繪製量降到幾十分之一。
2. 變暗用「一層全域黑幕」的 alpha，不是每塊磚各自跑亮度濾鏡。
3. 大圖只動 translate + scale，不動 left/top/width/height（不要觸發 layout/measure）。
4. 不要長駐 `will-change` / 不要讓幾十個磚塊各自變成獨立圖層 —— 會吃光顯示記憶體。
   → Android 對應：不要對每塊磚長期開 `LAYER_TYPE_HARDWARE`，只在動畫期間開、結束就關。
5. 大圖完全展開後把整面牆隱藏（`visibility: hidden` / `View.INVISIBLE`），
   這段期間只合成一張圖。
6. 縮圖解碼併發數限制為 3。
7. 磚塊移除後主動釋放 bitmap。

---

### 2.10 附帶行為

- **資訊面板**：滑鼠移動時顯示目前聚焦圖片的檔名／路徑／尺寸；聚焦開始時就更新 `current`。
  → Android 可改為觸控時顯示，或直接省略。
- **離開**：點擊或任意按鍵退出播放，`wallStopped = true`，
  所有 `await` 之後都會檢查這個旗標並提前 return（避免非同步流程繼續跑）。
  → Android 對應：用 CoroutineScope + `isActive` 檢查，或 Job.cancel()。


---

## 3. 輪盤（`reel`）

> 來源：`slideshow-desktop`（Electron 版）的 `slideshow.js`、`slideshow.html`、`index.html`、`renderer.js`。
> 這份文件把桌面版輪盤模式的行為、參數、數學和效能做法完整寫下來，給 Android 專案（Kotlin，建議用 Jetpack Compose）重新實作。
> **目標：畫面和手感跟桌面版一致，全程 60fps 不卡頓。**

---

### 3.1 一句話說明

一排圖片沿水平或垂直方向排成一條無限循環的帶子 → **加速 → 等速平移 → 減速停下**，而且一定剛好停在「這輪預先選好的那張」的正中間 → 其他圖變暗，選中的那張浮起來 → **從原位置放大成大圖（飛出去）** → 停留（可以加呼吸動畫）→ **縮回原位** → 換掉一部分圖片 → 下一輪。不斷循環，直到使用者觸碰或按任意鍵才退出。

---

### 3.2 一輪的流程（時間軸）

```
[加速 accelMs] → [等速 ≈spinMs（會自動微調）] → [減速 stopMs] →
[變暗＋選中那張浮起 max(dimMs, spotMs)，同時在背景載入原圖] →
[飛出放大 flyMs] → [大圖停留 bigMs（呼吸）] → [縮回 flyMs] →
[取消變暗 dimMs] → [換圖 replacePct%] → 下一輪
```

1. **平移（1～3 步是一段連續的運動）**
   - 加速：等加速度，0 → v，持續 `accelMs`
   - 等速：速度 v，持續時間是 `spinMs` 再「多加一點點」（0～一個週期的距離），讓最後剛好停準
   - 減速：ease-out cubic，起始速度＝v，持續 `stopMs`，結束時速度為 0
   - 全程速度連續，沒有頓挫
2. **選中特效**：全畫面蓋一層黑幕（`opacity = 1 - dim`，過程 `dimMs`）；選中的磚塊在黑幕上方，`scale(1.06)` 加白色細框和陰影（過程 `spotMs`）
3. **放大**：載入原圖（原始解析度），大圖從那塊磚塊的螢幕矩形（含圓角、cover 裁切）平滑變形成畫面置中、contain、佔畫面 `bigScale` 的大圖。背後的黑底（96% 黑）同時淡入。時間 `flyMs`，曲線 `cubic-bezier(.22,.61,.36,1)`
4. **停留**：`bigMs`。若 `breathe` 開啟，大圖做呼吸動畫（scale 1 → 1.04 來回，ease-in-out，週期 `max(4000, bigMs*2)` ms，alternate）。停留期間輪盤本身隱藏
5. **縮回**：反向變形回磚塊位置與形狀，黑底淡出，時間 `flyMs`；結束後釋放原圖
6. **取消變暗**：移除 spot 效果和黑幕，等 `dimMs`
7. **換圖**：見第 6 節

原圖載入失敗時跳過 3～5 步，直接做 6。

---

### 3.3 設定參數（全部要可以在設定頁調整並儲存）

| key | UI 標籤 | 預設 | 範圍 / 選項 | 說明 |
|---|---|---|---|---|
| `reelCount` | 張數 | 12 | 3～60 | 一組（一個循環週期）幾張 |
| `reelHeight` | 圖片大小（占畫面短邊） | 50 % | 15～95 | 交叉軸尺寸＝`min(螢幕寬,高) × %`，最小 40px |
| `reelAspect` | 圖片比例（寬/高） | 0.75 | 0.75（3:4 直式）、1（1:1）、1.333（4:3）、1.778（16:9）、0（原圖比例） | 0 時每張用原圖比例，但限制在 0.4～2.5 |
| `reelDir` | 平移方向 | left | left / right / up / down | up/down＝垂直輪盤 |
| `reelGap` | 圖片間距 | 24 px | 0～100 | |
| `reelRadius` | 圓角 | 16 px | 0～60 | |
| `reelSpeed` | 平移速度 | 2000 px/秒 | 100～10000（程式最小 10） | 等速段速度 v |
| `reelAccelMs` | 加速時間 | 1000 ms | 0～10 秒 | 0＝直接以 v 開始 |
| `reelSpinMs` | 等速平移時間 | 3000 ms | 0～60 秒 | 實際會多加 0～1 個週期 |
| `reelStopMs` | 減速停止時間 | 3000 ms | 0.3～20 秒（最小 300ms） | |
| `reelDim` | 其他圖變暗亮度 | 35 % | 0～100 | 黑幕 alpha＝`1 - dim/100` |
| `reelDimMs` | 變暗過程 | 500 ms | 0.1～10 秒 | |
| `reelSpotMs` | 選中後停頓 | 800 ms | 0.1～20 秒 | 浮起動畫時間 |
| `reelFlyMs` | 放大／收回時間 | 1000 ms | 0.1～10 秒 | |
| `reelBigMs` | 大圖停留 | 3000 ms | 0.5～120 秒 | |
| `reelBigScale` | 大圖占畫面 | 100 % | 40～100 | |
| `reelReplacePct` | 每輪換圖比例 | 50 % | 0～100 | |
| `reelThumbScale` | 縮圖畫質倍率 | 1× | 0.4～3 | 縮圖像素＝顯示尺寸 × density × 此值 |
| `reelBreathe` | 大圖呼吸動畫 | true | 開/關 | |

> 桌面版 UI 上「秒」的欄位會 ×1000 存成毫秒。Android 版單位用 dp 取代 px 即可（速度 px/秒 → dp/秒）。

設定頁提示文字（可直接用）：
「一輪＝加速 → 等速平移（循環）→ 減速停在正中間那張 → 放大 → 收回 → 換圖。方向選向上／向下就是垂直輪盤。等速時間會自動微調一點點，讓圖剛好停在正中間。」

---

### 3.4 版面與名詞

- **主軸**：平移方向（水平時是 x，垂直時是 y）。**交叉軸**：另一個方向。
- `axis = (dir == up || dir == down) ? Y : X`
- `dirSign = (dir == right || dir == down) ? -1 : +1`（向左／上時位移遞增）
- `cross = max(40, round(min(screenW, screenH) × reelHeight/100))`
- 每張磚塊尺寸：
  ```
  a = aspect > 0 ? aspect : clamp(nw / nh, 0.4, 2.5)
  水平： w = max(8, round(cross × a)), h = cross,  len = w
  垂直： w = cross, h = max(8, round(cross / a)),  len = h
  ```
- 一組 N 張依序排：`b.x = 前面所有 (len + gap) 的總和`
- **週期** `L = Σ(len + gap)`
- **複本份數** `K = ceil(screenMain / L) + 1`，一組接一組排 K 份，蓋滿畫面還多一份
- 整條帶子在交叉軸置中
- 捲動位移 `O`（float，只增不減或只減不增）。畫面顯示的偏移量＝`-mod(O, L)`
  → 視覺上無縫循環
- `mod(a, n) = ((a % n) + n) % n`

**Android 實作建議**：不需要真的建立 K×N 個 View。用單一 Canvas（Compose `Canvas` 或自訂 View）在每幀依 `mod(O, L)` 算出哪些磚塊在畫面內，直接 `drawImage` 縮圖（`ImageBitmap`）即可；或 `LazyRow` 以外的自繪方式都行，重點是每幀只做位移，不重新排版、不重新解碼。

---

### 3.5 停準的數學（核心，請照抄）

#### 3.5.1 運動方程式

參數：`v = speed / 1000`（px/ms）、`A = accelMs`、`Cm`＝等速時間（ms）、`T = stopMs`

```
uA   = A > 0 ? v*A/2 : 0          // 加速段距離
uC   = v * Cm                      // 等速段距離
dDec = v * T / 3                   // ease-out cubic、起速 v 的減速距離
total = A + Cm + T
dist  = uA + uC + dDec

u(t) =                             // 開始後 t ms 走了多遠
  t <= A        : v*t*t / (2A)
  t <= A+Cm     : uA + v*(t - A)
  否則           : s = min(1, (t-A-Cm)/T); uA + uC + dDec*(1 - (1-s)^3)

du(t) =                            // 當下速度
  t < A         : v*t/A
  t <= A+Cm     : v
  否則           : s = min(1,(t-A-Cm)/T); v*(1-s)^2
```

每幀：`O = O0 + dirSign × u(elapsed)`。

#### 3.5.2 每輪開始時算出等速距離，保證停在選中那張的正中間

```kotlin
O = mod(O, L)
val b = pick()                                   // 先選好這輪要停哪張
val want = b.x + b.len/2 - screenMain/2          // 讓 b 的中心對齊螢幕中心所需的位移（mod L）
val cruise0 = v * max(0, spinMs)
val C = cruise0 + mod(dirSign*(want - O) - uA - cruise0 - dDec, L)
// 等速時間 Cm = C / v
```

結束時 `O_end = O + dirSign*(uA + C + dDec)`，且 `mod(O_end, L) == mod(want, L)` → 選中那張剛好在正中央。

#### 3.5.3 找出畫面正中間的是哪一份複本（放大時要從它的位置飛出）

```
m = round((screenMain/2 - b.len/2 - b.x + mod(O, L)) / L)
m = clamp(m, 0, K-1)
該複本在螢幕上的主軸位置 = m*L + b.x - mod(O, L)
```

#### 3.5.4 選圖規則 `pick()`

- 從「這批還沒被選過（`used == false`）且不是上一輪那張」裡隨機挑
- 全部都用過 → 把 `used` 全部清掉，再從「不是上一輪那張」裡挑
- 還是沒有（只有 1 張）→ 從全部挑
- 選中後 `used = true`、`last = b`

---

### 3.6 換圖（每輪結束）

- `n = min(N, round(N × replacePct/100))`，n ≤ 0 就跳過
- 隨機挑 n 塊要被換掉的磚塊
- **先在背景做好 n 張新縮圖**（併發 3），做好才開始換，失敗的圖自動跳過
- 圖片來源順序：依序取圖片清單下一張；走完一輪時，若設定「循環」就從頭開始（若設定「隨機」則重新洗牌），否則停止供圖
- **固定比例（aspect > 0）**：主軸長度不變 → 每塊依序（間隔 60ms 錯開）原地「縮小到 0.9 + 淡出」（450ms）→ 換內容 → 依序淡入還原（450ms）。位置完全不動
- **原圖比例（aspect == 0）**：長度會變 → 整條帶子淡出（450ms）→ 換資料、重新排版（重算 x、L、K）→ 淡入（450ms）
- 換掉的舊縮圖要 `recycle()` / 釋放

---

### 3.7 開始 / 建立 / 重建

**開始（reelStart）**
1. 圖片清單為空 → 顯示「沒有圖片」訊息
2. 讀設定 → 建立輪盤 → 進入主迴圈

**建立（buildReel）**
1. 帶子先設為透明（淡出狀態）
2. 釋放所有舊縮圖
3. 算 `cross`
4. 併發 3 做 `min(count, 圖片總數)` 張縮圖
5. 一張都做不出來 → 顯示「沒有圖片」
6. 排版，`O = random() × L`（隨機起始位置）
7. 淡入（450ms）

**畫面旋轉 / 尺寸改變**：不要立即重建，設一個 `needsRebuild` 旗標，在**下一輪開始前**重建（避免打斷正在進行的動畫）。

**退出**：觸碰畫面或按任何鍵（含遙控器）→ 立刻停止所有動畫與協程、釋放 bitmap、離開。每個 `await/delay` 之後都要檢查「是否已停止」。

---

### 3.8 縮圖製作（效能關鍵）

- 讀原圖 → **cover 裁切**成磚塊比例 → 縮到 `磚塊尺寸 × density × thumbScale` 像素 → 立即釋放原圖
  ```
  若 nw/nh > w/h：sw = round(nh*w/h), sx = (nw-sw)/2, sy = 0, sh = nh
  否則：         sh = round(nw*h/w), sy = (nh-sh)/2, sx = 0, sw = nw
  ```
- Android：用 `BitmapFactory.Options.inSampleSize` 先粗縮再精縮（或 Coil/Glide 指定尺寸＋`Scale.FILL`），`Bitmap.Config.RGB_565` 或 `HARDWARE` 皆可，避免把數十張原圖留在記憶體
- 解碼在 `Dispatchers.IO`，併發 3
- 大圖（放大用）才載入原始解析度，一次只有一張，但要限制最大尺寸不超過螢幕尺寸（避免 OOM）

---

### 3.9 動畫與效能要求

桌面版做法：整段「加速＋等速＋減速」事先算好，做成一個 Web Animations 動畫交給合成器執行，主執行緒卡住也不會掉幀；跨越一個週期 L 時插入瞬間跳回的關鍵影格。

Android 對應做法（擇一）：
- **Compose**：用 `withFrameNanos` 迴圈（或 `Animatable` 搭配自訂 `Easing`）算 `elapsed → u(t)`，只更新一個 `State<Float>`（O），Canvas 在 draw 階段讀它 → 不觸發重組只觸發重畫
- **自訂 View**：`Choreographer.FrameCallback` 算 O 後 `invalidate()`
- 關鍵：**每幀只改位移**；不在動畫進行中解碼、配置 bitmap 或重排版；縮圖都事先做好
- 放大／縮回用 `graphicsLayer { translationX/Y, scaleX/Y }` + clip（圓角矩形 inset）實作，大圖本身不透明，只有背後黑底淡入淡出
- 放大終點：contain、置中，`s = min(screenW*bigScale/nw, screenH*bigScale/nh)`；大圖圓角 8dp
- 放大起點：磚塊的螢幕矩形（含 spot 的 1.06 縮放）。先以 `k = max(rect.w/tw, rect.h/th)` 把大圖縮放到覆蓋磚塊，再用 inset clip 裁掉超出的部分、圓角＝`radius / k`（即 cover 效果），這樣起點和磚塊畫面完全重疊，看起來就是「那張圖被放大」
- 放大完成後拿掉 clip（呼吸動畫才不會被框住）；縮回前先把 clip 接回來

---

### 3.10 視覺細節

- 背景純黑
- 磚塊：圓角 `radius`，裁切內容，空的時候底色 `#111`
- 變暗黑幕：`#000`，alpha `1 - dim`，淡入淡出 `dimMs`
- 選中磚塊：在黑幕之上，`scale(1.06)`，邊框 `2dp rgba(255,255,255,0.4)`，陰影約 `0 18dp 50dp rgba(0,0,0,0.75)`，過程 `spotMs` ease-in-out
- 大圖背景黑底：`rgba(0,0,0,0.96)`，淡入淡出 `flyMs`
- 大圖停留期間隱藏輪盤
- （選配）桌面版有「圖片資訊」面板：顯示目前圖片的檔名、路徑、尺寸等，Android 可改為輕觸一下顯示、再次輕觸或返回鍵退出

---

### 3.11 驗收清單

- [ ] 四個方向都能跑，垂直方向是真正的上下輪盤
- [ ] 每輪都**精準停在某張圖的正中央**（肉眼看不出偏差），且停下前速度連續、無頓挫
- [ ] 同一張不會連續兩輪被選中；一批內每張都輪到後才重複
- [ ] 無縫循環，看不到帶子頭尾接縫或跳動
- [ ] 放大起點和磚塊完全重疊（圓角、裁切一致），縮回也完全回到原位
- [ ] 換圖時固定比例位置不動；原圖比例整條淡出重排
- [ ] 旋轉螢幕後下一輪自動重建
- [ ] 長時間執行（數小時）記憶體不增長
- [ ] 中低階手機上平移維持 60fps
- [ ] 所有參數可在設定頁調整並保存，預設值同第 3 節


---

## 4. 拍立得散落（`polaroid`）

> 來源：`slideshow-desktop`（Electron 版）的 `slideshow.js`（`polaStart` / `polaLoop` / `polaDrop` / `polaClear`）、`slideshow.html`（`#pola` 區塊 CSS）、`index.html`（`#polaOpts`）、`renderer.js`（`POLA_FIELDS`）。
> 寫法跟 `reel-mode-spec.md` 一樣，可直接拿來移植到 Android。

---

### 4.1 一句話說明

白框照片一張張「丟」到桌面上，帶隨機傾斜、落在畫面中心附近隨機位置，一張蓋一張疊起來 → 最上面那張停留 `holdMs` → 下一張蓋上 → 疊到 `stack` 張後整疊淡出、清空、重新開始。不斷循環，直到使用者點擊或按任意鍵才退出。

---

### 4.2 流程（時間軸）

```
[準備第 1 張縮圖] →
  ┌→ (桌上已有 stack 張？→ 整疊淡出 fadeMs → 清空)
  │  [開始準備下一張縮圖（背景）]
  │  [落下 dropMs] → [停留 holdMs]
  └──────────────────────────────┘
```

- 下一張縮圖永遠在「上一張落下＋停留」期間先做好，不會卡頓。
- 不循環（`loop = false`）且圖片用完：顯示「播放完畢」，1.5 秒後退出（跟一般模式一樣）。
- 壞圖自動跳過。

---

### 4.3 設定參數

| key | UI 標籤 | 預設 | 範圍 / 選項 | 說明 |
|---|---|---|---|---|
| `polaSize` | 照片大小（占畫面短邊） | 55 % | 20～90 | 照片（不含白框）放進 `S×S` 方框，`S = min(寬,高) × %` |
| `polaAspect` | 照片比例（寬/高） | 0 | 0.75、1、1.333、1.778、0（原圖比例） | 0 時用原圖比例，限制在 0.5～2；照片以 cover 裁切 |
| `polaRotate` | 最大傾斜角度 | 12° | 0～45 | 每張隨機 `±rotate` |
| `polaSpread` | 落點散布範圍 | 20 % | 0～45 | 落點在以畫面中心為圓心、半徑 `spread × 寬/高` 的橢圓內均勻隨機；0＝全部疊在正中間 |
| `polaDropMs` | 落下時間 | 900 ms | 0.2～5 秒（最小 100ms） | |
| `polaHoldMs` | 每張停留 | 3000 ms | 0.5～120 秒 | |
| `polaStack` | 堆疊上限（張） | 10 | 1～40 | 到上限後下一張落下前先清空 |
| `polaFadeMs` | 整疊淡出時間 | 1200 ms | 0.2～10 秒 | |
| `polaThumbScale` | 縮圖畫質倍率 | 1× | 0.4～3 | 縮圖像素＝顯示尺寸 × devicePixelRatio × 此值 |
| `polaCaption` | 白框下緣寫上檔名 | false | 開/關 | 檔名（去掉副檔名），手寫風字型 |

設定頁提示文字：
「白框照片一張張丟到桌面上疊起來，最上面那張停留後下一張蓋上；堆到上限整疊淡出重來。散布範圍 0 = 全部疊在正中間。」

---

### 4.4 版面

- 照片尺寸 `w × h`：放進 `S × S` 方框（比例 ≥ 1 時 `w = S`，否則 `h = S`）。
- 白框：`pad = round(max(w,h) × 0.05)`（左、右、上），下緣 `bottom = round(max(w,h) × 0.17)`。
  整張外框 `W = w + 2·pad`、`H = h + pad + bottom`。白框色 `#f7f5ef`，圓角 3px。
- 檔名文字：放在下緣白框垂直置中，字級 `max(12, bottom × 0.32)`，顏色 `#3a3a46`，太長用省略號。
- 落點中心 `(cx, cy)`：
  ```
  ang = rand·2π, r = sqrt(rand)
  cx = vw/2 + cos(ang)·r·spread·vw
  cy = vh/2 + sin(ang)·r·spread·vh
  cx 夾在 [0.45W, vw − 0.45W]；cy 夾在 [0.45H, vh − 0.45H]   ← 保證大部分在畫面內
  rot = (rand·2 − 1)·rotate
  終點 transform = translate(cx − W/2, cy − H/2) rotate(rot)
  ```
- 桌面背景：`radial-gradient(ellipse at 50% 45%, #3a3128, #241e18 55%, #120f0c)`（深色木桌感）。

---

### 4.5 落下動畫

- 起點：從隨機方向偏移 `min(寬,高) × 0.18` 的位置、`scale(1.45)`、角度再多 `±18°`、透明。
- 關鍵影格：
  - 0%：起點 transform、opacity 0、陰影 `0 30px 70px rgba(0,0,0,.45)`（離桌面高）
  - 30%：opacity 1
  - 100%：終點 transform、陰影 `0 2px 4px rgba(0,0,0,.35), 0 10px 26px rgba(0,0,0,.45)`（貼在桌上）
- 曲線 `cubic-bezier(.2,.75,.25,1)`，時間 `dropMs`。
- 動畫結束後把終點寫回 style 並取消動畫 → 桌上的照片完全靜止，不佔任何動畫資源。

---

### 4.6 清空

整疊容器 `opacity 1 → 0` 且 `scale(0.94) translateY(4vh)`，時間 `fadeMs` → 釋放所有縮圖、移除節點 → 不帶動畫地恢復容器。

---

### 4.7 效能

- 每張照片只有一個 `<canvas>` 縮圖（cover 裁切成照片比例），原圖解碼完立刻釋放。
- 同時只有一張在跑動畫；只動 transform / opacity（陰影只在落下那一張上變化）。
- 桌上最多 `stack` 張，記憶體上限可預期。
- 視窗大小改變：已在桌上的不動，之後的照片用新尺寸。

---

### 4.8 驗收清單

- [ ] 照片一張張落下，帶傾斜、位置隨機，新照片永遠在最上層
- [ ] 散布 0 時全部疊在正中間；傾斜 0 時全部正擺
- [ ] 到上限後整疊淡出再重新開始
- [ ] 檔名開關有效
- [ ] 移動滑鼠顯示最上面那張的路徑與原圖尺寸
- [ ] 點擊／按鍵立即退出


---

## 5. 3D 封面流（`coverflow`）

> 來源：`slideshow-desktop`（Electron 版）的 `slideshow.js`（`cfStart` / `cfLoop` / `cfStep` / `cfPose` / `cfSpotlight`）、`slideshow.html`（`#cf` 區塊 CSS）、`index.html`（`#cfOpts`）、`renderer.js`（`CF_FIELDS`）。
> 寫法跟 `reel-mode-spec.md` 一樣，可直接拿來移植到 Android。

---

### 5.1 一句話說明

中間一張正面朝向觀眾，兩側各 `side` 張斜擺成 3D 透視（往後退、朝中間轉）→ 停留 `holdMs` → 整排往前移一格，下一張轉到正中 → … 每隔 `bigEvery` 格，正中那張用跟圖牆／輪盤同一套 hero 動畫放大成大圖、停留、收回。無限流動，直到使用者點擊或按任意鍵才退出。

---

### 5.2 流程（時間軸）

```
[建立 2·side+1 張] →
  ┌→ [停留 holdMs]
  │  (steps > 0 且 steps % bigEvery == 0？→ 放大 flyMs → 大圖停留 bigMs → 收回 flyMs → 300ms)
  │  [前移一格 moveMs] → steps++
  └─────────────────────┘
```

- 下一張縮圖在停留期間先做好。
- 不循環且圖片用完：複製最舊那張的縮圖補到遠端，持續流動（不結束）。
- 一開始圖片不足 `2·side+1` 張：用現有的複製補滿。

---

### 5.3 設定參數

| key | UI 標籤 | 預設 | 範圍 / 選項 | 說明 |
|---|---|---|---|---|
| `cfSide` | 每側張數 | 4 | 1～8 | |
| `cfSize` | 圖片大小（占畫面短邊） | 55 % | 20～90 | 基準尺寸 `B = max(60, min(寬,高) × %)` |
| `cfAspect` | 圖片比例（寬/高） | 1 | 0.75、1、1.333、1.778、0（原圖比例） | 圖放進 `B×B` 方框；0 時用原圖比例（限制 0.5～2） |
| `cfDir` | 流動方向 | left | left / right | left：新圖從右邊進來、往左流；right 為鏡像 |
| `cfAngle` | 側邊傾斜角度 | 55° | 0～85 | |
| `cfSpacing` | 側邊間距（占圖寬） | 28 % | 5～100 | |
| `cfDepth` | 側邊後退深度（占圖寬） | 45 % | 0～200 | |
| `cfSideDim` | 側邊亮度 | 55 % | 0～100 | |
| `cfMoveMs` | 前移時間 | 800 ms | 0.1～5 秒 | |
| `cfHoldMs` | 每張停留 | 2500 ms | 0.3～120 秒 | |
| `cfBigEvery` | 每幾張放大一次 | 4 | 0～50 | 0＝不放大 |
| `cfBigMs` | 大圖停留 | 3000 ms | 0.5～120 秒 | |
| `cfFlyMs` | 放大／收回時間 | 1000 ms | 0.1～10 秒 | |
| `cfBigScale` | 大圖占畫面 | 100 % | 40～100 | |
| `cfRadius` | 圓角 | 8 px | 0～60 | |
| `cfThumbScale` | 縮圖畫質倍率 | 1× | 0.4～3 | |
| `cfReflect` | 倒影 | true | 開/關 | 開啟時整排往上提 `B × 0.1` |
| `cfBreathe` | 大圖呼吸動畫 | true | 開/關 | |

設定頁提示文字：
「中間一張正面，兩側斜擺成 3D 透視；每隔「停留」時間整排前移一格。每幾張會把中間那張放大成大圖。」

---

### 5.4 位置模型（核心）

- 每張記一個**邏輯位置** `li`（整數），`c` 是目前正中的邏輯位置。畫面位置 `d = li − c`。
- 前移一格＝`c++`，然後把每張的 transform 重新寫成新 `d` 的姿勢，交給 transition 補間（`moveMs`，`cubic-bezier(.25,.8,.3,1)`）。
- 平常保留 `li ∈ [c − side, c + side]` 共 `2·side+1` 張。
- 前移前：在 `li = c + side + 1`（畫面外、透明）先放一張新的，不帶動畫。
- 前移後：`li < c − side` 的那張（已淡出）移除並釋放縮圖。

#### 姿勢 `pose(d)`

```
k = |d|,  s = sign(d) · dirSign        // dirSign：left = +1，right = −1
ty = reflect ? −B·0.1 : 0

k == 0：translate3d(0, ty, 0) rotateY(0)，黑幕 0，可見，z = 1000
k  > 0：x = s · (B·0.78 + (k−1)·B·spacing)
        z = −B·depth
        translate3d(x, ty, z) rotateY(s·angle)
        黑幕 alpha = min(0.92, (1 − sideDim) + (k−1)·0.08)
        opacity = k > side ? 0 : 1
        z-index = 1000 − k
```

- 每張以畫面中心為中心（`left/top: 50%`，margin 負一半寬高）。
- 透視：卡片的**直接父層**設 `perspective = max(800, 3B) px`，`perspective-origin: 50% 50%`。
  （注意：設在祖父層不會生效，這是實作時踩過的坑。）
- `rotateY(+θ)` 讓右側卡片的外緣朝觀眾、內緣往後 → 卡片面向中間，跟經典 Cover Flow 一樣。

---

### 5.5 放大

完全沿用圖牆／輪盤的 hero：從正中那張的螢幕矩形（含圓角）變形成置中 contain 大圖 → `heroSettled` 拿掉裁切 → 大圖停留期間隱藏整個封面流（只畫一張圖）→ 收回到原位。原圖載入失敗則跳過。

---

### 5.6 視覺細節

- 倒影：`-webkit-box-reflect: below 2px linear-gradient(transparent 62%, rgba(255,255,255,.22))`，套在卡片本身，所以會跟著 3D 旋轉。
- 側邊變暗：每張自己一層黑幕的 opacity（跟 transform 同時 transition），不用 filter。
- 背景純黑。

---

### 5.7 效能

- 同時最多 `2·side+2` 張 `<canvas>` 縮圖；只動 transform / opacity。
- 縮圖 cover 裁成 `fitBox(B, aspect)` 的尺寸，原圖解碼完立刻釋放。
- 視窗大小改變：設旗標，下一格前整排淡出、用新尺寸重建。

---

### 5.8 驗收清單

- [ ] 中間正面、兩側斜擺有明顯 3D 透視，越外側越暗
- [ ] 每次前移一格，遠端新圖淡入、另一端淡出，無跳動
- [ ] 方向 right 時整個鏡像
- [ ] 每 N 格正中那張放大、收回；0 時不放大
- [ ] 倒影開關有效
- [ ] 移動滑鼠顯示正中那張的路徑與原圖尺寸
- [ ] 點擊／按鍵立即退出


---

## 6. 拼貼格（`collage`）

> 來源：`slideshow-desktop`（Electron 版）的 `slideshow.js`（`collageStart` / `ccBuild` / `ccSwap` / `ccLoop`、`CC_LAYOUTS`）、`slideshow.html`（`#collage` 區塊 CSS）、`index.html`（`#collageOpts`）、`renderer.js`（`COLLAGE_FIELDS`）。
> 寫法跟 `reel-mode-spec.md` 一樣，可直接拿來移植到 Android。

---

### 6.1 一句話說明

隨機挑一個 2～5 格的不對稱雜誌版型，每格一張圖 → 每隔 `swapMs` 只換「最久沒換」的那一格（單格轉場）→ 換了 `layoutEvery` 次後，整個版型淡出、換一個新版型。不斷循環，直到點擊或按任意鍵退出。

---

### 6.2 流程

```
[挑版型 → 每格做縮圖 → 逐格淡入（間隔 140ms，每格 600ms）]
  ┌→ [挑最久沒換的格子；等 swapMs，同時在背景做它的新縮圖]
  │  [單格轉場 transMs] → swaps++
  │  (swaps ≥ layoutEvery 且 layoutEvery > 0 → 再等 swapMs → 整個淡出 600ms → 新版型)
  └──────────────┘
```

- 圖片用完一律從頭再用（不受「循環播放」影響，這是持續性畫面）。
- 新版型一定跟上一個不同（同格數有多個版型時）。

---

### 6.3 設定參數

| key | UI 標籤 | 預設 | 範圍 / 選項 | 說明 |
|---|---|---|---|---|
| `collageMin` | 最少格數 | 2 | 2～5 | |
| `collageMax` | 最多格數 | 5 | 2～5 | 小於最少格數時以最少格數為準 |
| `collageSwapMs` | 每隔多久換一格 | 3000 ms | 0.3～120 秒 | |
| `collageTransMs` | 單格轉場時間 | 900 ms | 0～5 秒 | |
| `collageTrans` | 單格轉場效果 | random | random / fade / slide / zoom / wipe / none | random 每次從 fade、slide、zoom、wipe 隨機挑 |
| `collageLayoutEvery` | 換幾次後換版型 | 8 | 0～100 | 0＝永遠不換版型 |
| `collageGap` | 格子間距 | 12 px | 0～60 | 外框也留同樣間距 |
| `collageRadius` | 圓角 | 12 px | 0～60 | |
| `collageThumbScale` | 縮圖畫質倍率 | 1× | 0.4～3 | |
| `collageKb` | 每格緩慢縮放 | true | 開/關 | scale 1 → 1.08 來回，週期 `max(12s, swapMs × 6)`，原點隨機、起始相位隨機 |

設定頁提示文字：
「隨機挑 2～5 格的不對稱版型，每隔一段時間只換「最久沒換」的那一格；換了指定次數後整個版型淡出、換一個新的。」

---

### 6.4 版型

每格 `[x, y, w, h]`，以畫面比例表示（橫式螢幕用）。**直式螢幕（高 > 寬）時把每格的 x↔y、w↔h 對調**，同一份表就能用。

```
2 格：[0,0,.6,1][.6,0,.4,1] ｜ [0,0,.4,1][.4,0,.6,1] ｜ [0,0,.5,1][.5,0,.5,1]
3 格：左大右二 [0,0,.6,1][.6,0,.4,.5][.6,.5,.4,.5]
      左二右大 [0,0,.4,.5][0,.5,.4,.5][.4,0,.6,1]
      上寬下二 [0,0,1,.58][0,.58,.5,.42][.5,.58,.5,.42]
      三直欄   [0,0,.3,1][.3,0,.4,1][.7,0,.3,1]
4 格：[0,0,.5,1][.5,0,.5,.5][.5,.5,.25,.5][.75,.5,.25,.5]
      [0,0,.3,.5][0,.5,.3,.5][.3,0,.4,1][.7,0,.3,1]
      [0,0,.62,.55][.62,0,.38,.55][0,.55,.38,.45][.38,.55,.62,.45]
      [0,0,.25,1][.25,0,.5,.6][.25,.6,.5,.4][.75,0,.25,1]
5 格：[0,0,.25,.5][0,.5,.25,.5][.25,0,.5,1][.75,0,.25,.5][.75,.5,.25,.5]
      [0,0,.4,.5][.4,0,.3,.5][.7,0,.3,.5][0,.5,.55,.5][.55,.5,.45,.5]
      [0,0,.6,.65][.6,0,.4,.35][.6,.35,.4,.3][0,.65,.3,.35][.3,.65,.7,.35]
```

比例 → 像素（W、H 為畫面尺寸，g 為間距）：
```
left = round(x·(W−g) + g)        right  = round((x+w)·(W−g))
top  = round(y·(H−g) + g)        bottom = round((y+h)·(H−g))
```
這樣外框和格與格之間都剛好是 g。

---

### 6.5 單格轉場

每格結構：定位框 → 裁切層（圓角）→ 圖層 → 圖（慢速縮放動畫掛在圖上，轉場動畫掛在圖層上，兩者不衝突）。
新圖層加在舊圖層上面，時間 `transMs`，曲線 `cubic-bezier(.4,0,.2,1)`：

| 效果 | 新圖層 | 舊圖層 |
|---|---|---|
| fade | opacity 0 → 1 | 不動 |
| slide | 從上/下/左/右（隨機）100% 滑入 | 同時往反方向滑出 |
| zoom | scale 1.25 + opacity 0 → scale 1 + opacity 1 | 不動 |
| wipe | clip-path inset 從某一邊（隨機）揭開 | 不動 |
| none | 直接出現 | |

轉場結束後移除舊圖層並釋放縮圖。

---

### 6.6 選格規則

每格記錄上次換圖時間 `t`；每次挑 `t` 最小的那格。建立版型時給每格的 `t` 加一點隨機小數，讓初始換圖順序是亂的。

---

### 6.7 效能

- 縮圖直接 cover 裁成格子的像素大小（× 螢幕縮放 × 畫質倍率），原圖解碼完立刻釋放。
- 每格平時 1 張、轉場中 2 張 canvas；最多 5 格。
- 只動 transform / opacity / clip-path。
- 視窗大小改變：設旗標，下一輪直接換新版型。

---

### 6.8 驗收清單

- [ ] 2～5 格版型隨機出現，直式螢幕自動轉成直式版型
- [ ] 每次只換一格，且輪流換到每一格
- [ ] 五種轉場都正常，random 會混著出現
- [ ] 換滿指定次數後換版型；設 0 時永遠不換
- [ ] 移動滑鼠顯示最近換上那張的路徑與原圖尺寸
- [ ] 點擊／按鍵立即退出


---

## 7. 電影膠卷（`filmstrip`）

> 來源：`slideshow-desktop`（Electron 版）的 `slideshow.js`（`filmStart` / `filmBuild` / `filmRun` / `filmMaintain` / `filmSpotlight`）、`slideshow.html`（`#film`、`#filmFx` 區塊 CSS）、`index.html`（`#filmOpts`）、`renderer.js`（`FILM_FIELDS`）。
> 寫法跟 `reel-mode-spec.md` 一樣，可直接拿來移植到 Android。

---

### 7.1 一句話說明

一條帶齒孔的底片橫向等速慢慢捲動（無限）→ 每隔 `bigEveryMs`，底片慢慢減速停下，最靠近畫面中央的那格放大成大圖 → 停留 → 收回 → 底片慢慢加速繼續走。可加底片顆粒、閃爍、輕微晃動、復古色調、傾斜。

---

### 7.2 流程

```
捲動（一直進行）
  ┌→ [等 bigEveryMs]
  │  [減速 900ms（playbackRate 1 → 0，ease-out）→ 暫停]
  │  [挑格子 → 載入原圖 → 放大 flyMs → 停留 bigMs（呼吸）→ 收回 flyMs]
  │  [恢復 → 加速 1200ms（0 → 1）]
  └──────────────┘
bigEveryMs = 0：只捲動，不放大。
```

- 圖片用完一律從頭再用（持續性畫面）。

---

### 7.3 設定參數

| key | UI 標籤 | 預設 | 範圍 / 選項 | 說明 |
|---|---|---|---|---|
| `filmSize` | 底片高度（占畫面高） | 45 % | 15～90 | 底片總高 `H = max(60, 畫面高 × %)` |
| `filmAspect` | 每格比例（寬/高） | 1.5 | 1.5（3:2 底片）、1.333、1.778、1、0.75 | 照片 cover 裁切 |
| `filmSpeed` | 捲動速度 | 60 px/秒 | 5～2000 | |
| `filmDir` | 捲動方向 | left | left / right | |
| `filmTilt` | 底片傾斜角度 | 0° | −20～20 | 整條底片旋轉 |
| `filmTone` | 色調 | none | none / sepia / bw | 畫進縮圖時套用；大圖也套同色調 |
| `filmBigEveryMs` | 每隔幾秒放大一格 | 12000 ms | 0～300 秒 | 0＝不放大 |
| `filmBigMs` | 大圖停留 | 3000 ms | 0.5～120 秒 | |
| `filmFlyMs` | 放大／收回時間 | 1000 ms | 0.1～10 秒 | |
| `filmBigScale` | 大圖占畫面 | 100 % | 40～100 | |
| `filmThumbScale` | 縮圖畫質倍率 | 1× | 0.4～3 | |
| `filmGrain` | 底片顆粒與閃爍 | true | 開/關 | |
| `filmShake` | 輕微晃動 | true | 開/關 | |
| `filmBreathe` | 大圖呼吸動畫 | true | 開/關 | |

設定頁提示文字：
「帶齒孔的底片橫向慢慢捲動；每隔一段時間底片會慢慢停下，把中間那格放大成全螢幕，收回後再繼續走。」

---

### 7.4 底片格的幾何（每格寬度固定）

```
H   = 底片總高
b   = round(H × 0.13)          上下齒孔帶
ih  = H − 2b                   照片高
iw  = round(ih × aspect)       照片寬
div = max(2, round(H × 0.045)) 格與格之間的黑線
fw  = iw + div                 每格寬度（第 k 格放在 x = k·fw）
照片區：x = div/2, y = b
```

齒孔：每格 `n = max(3, round(fw / (H × 0.105)))` 個，間距 `pitch = fw / n`，
孔寬 `pitch × 0.52`、孔高 `b × 0.42`、圓角 `min(寬,高) × 0.22`，在上下齒孔帶內垂直置中，水平置中於各自的 pitch 內。
因為每格寬度固定，相鄰格子的齒孔間距是連續的。

顏色：底片 `#17120d`、照片區空白時 `#060504`、齒孔 `#e6e0d2`、背景 `#0b0a09`。
格號：畫在下緣齒孔外側那條，`"{n}   ▸ {n}A"`（n = k mod 36 + 1），等寬字、`rgba(232,165,70,.7)`。

**每格只有一張 canvas**：先複製預先畫好的「空白底片格」→ 畫格號 → 照片載入後（cover 裁切 + 色調濾鏡）畫進照片區。之後不再重繪。

---

### 7.5 捲動

- 位移 `o`：畫面左緣在底片座標中的位置。底片容器 transform = `translateX(−o)`。
- 一段動畫 10 分鐘、等速、從目前 `o` 走到 `o + dirSign·v·600000ms`；結束時從終點接下一段。
  （交給合成器跑，主執行緒忙也不卡。）
- 目前位移 `o = 段起點 + dirSign · v · anim.currentTime`。
- 減速／加速用 `updatePlaybackRate` 漸變（每 40ms 一步，ease-out），位移連續。

#### 維護（每 250ms）

```
span = hypot(畫面寬, 畫面高)          ← 傾斜時也蓋得滿
cx   = o + 畫面寬/2
k0 = floor((cx − span/2) / fw) − 1
k1 = ceil((cx + span/2) / fw) + 1
缺的格子補上（往左捲時從小 k 補起；往右捲時從大 k 補起）
k < k0−1 或 k > k1+1 的格子移除並釋放
```

照片載入排成一個佇列，一次只解碼一張，避免 CPU 尖峰。

---

### 7.6 放大

- 挑格子：已畫好照片、照片區完整在畫面內、中心離畫面中心最近的那格。
- 用跟圖牆／輪盤同一套 hero：從那格照片區的螢幕矩形變形成大圖（圓角 2px）。大圖停留期間隱藏底片。
- 色調 sepia / bw 時大圖套同樣濾鏡（`sepia(.65) contrast(1.05)` / `grayscale(1) contrast(1.08)`）。

---

### 7.7 懷舊效果（全部是合成層動畫，不重繪）

- **顆粒**：一張「半解析度 + 64px」的灰階雜訊 canvas，放大 2 倍（pixelated），opacity 0.09，用 `steps(1)` 每 0.1 秒跳到不同位移。蓋在最上層（大圖也有顆粒）。
- **閃爍**：暗角層 opacity 在 1 / 0.86 / 0.95 間跳動（0.27 秒一輪，steps）。
- **暗角**：`radial-gradient(transparent 55%, rgba(0,0,0,.55))`，固定。
- **晃動**：底片外層用 `translate` 在 ±1px 內跳動（0.5 秒一輪，steps），不影響捲動用的 transform。

---

### 7.8 驗收清單

- [ ] 底片等速捲動、齒孔連續、無縫無跳動，長時間播放不會出現空白格
- [ ] 往右捲時方向相反；傾斜時畫面兩端仍蓋滿
- [ ] 每隔設定時間慢慢停下、放大中間那格、收回後慢慢再走；設 0 時不放大
- [ ] 三種色調都正確，大圖色調一致
- [ ] 顆粒、晃動開關有效
- [ ] 移動滑鼠顯示畫面中央那格的路徑與原圖尺寸
- [ ] 點擊／按鍵立即退出


---

## 8. 3D 旋轉相簿（`ring`）

> 來源：`slideshow-desktop`（Electron 版）的 `slideshow.js`（`ringStart` / `ringBuild` / `ringStep` / `ringLoop`、`CUBE_FACES`、`cubeUpright`）、`slideshow.html`（`#ring` 區塊 CSS）、`index.html`（`#ringOpts`）、`renderer.js`（`RING_FIELDS`）。
> 寫法跟 `reel-mode-spec.md` 一樣，可直接拿來移植到 Android。

---

### 8.1 一句話說明

圖片貼在**旋轉木馬**（N 張繞一圈）或**立方體**（6 面）上，每次轉一格（ease-in-out），轉到正面時停頓 `holdMs`，每轉幾格把正面那張放大成大圖。旋轉木馬轉到背面的圖自動換新；立方體翻之前先把「即將轉到正面」的那一面換成新圖並轉正。

---

### 8.2 流程

```
[建立（全部面都放圖）→ 淡入]
  ┌→ [停頓 holdMs]
  │  (steps > 0 且 steps % bigEvery == 0 → 放大 flyMs → 大圖 bigMs → 收回 flyMs → 300ms)
  │  [轉一格 moveMs] → steps++
  └──────────────┘
```

---

### 8.3 設定參數

| key | UI 標籤 | 預設 | 範圍 / 選項 | 說明 |
|---|---|---|---|---|
| `ringShape` | 形狀 | ring | ring（旋轉木馬）/ cube（立方體） | |
| `ringDir` | 旋轉方向 | left | left / right / random | random：旋轉木馬隨機左右；立方體隨機上下左右（不立刻反向），俯視角度 ≠ 0 時只左右 |
| `ringCount` | 旋轉木馬張數 | 10 | 5～24 | 立方體忽略 |
| `ringSize` | 圖片大小（占畫面短邊） | 45 % | 15～80 | 圖片高 `H = max(60, min(寬,高) × %)`；立方體邊長＝H |
| `ringAspect` | 旋轉木馬圖片比例 | 0.75 | 0.75、1、1.333、1.778 | 立方體固定 1:1 |
| `ringGap` | 旋轉木馬圖片間距 | 30 px | 0～200 | |
| `ringTilt` | 俯視角度 | 8° | −30～30 | 整個物體 rotateX(−tilt) |
| `ringDim` | 背面亮度 | 30 % | 0～100 | 旋轉木馬用 |
| `ringMoveMs` | 旋轉時間 | 1400 ms | 0.1～10 秒 | 曲線 `cubic-bezier(.45,0,.25,1)` |
| `ringHoldMs` | 正面停頓 | 2000 ms | 0～120 秒 | |
| `ringBigEvery` | 每轉幾次放大一次 | 5 | 0～50 | 0＝不放大 |
| `ringBigMs` | 大圖停留 | 3000 ms | 0.5～120 秒 | |
| `ringFlyMs` | 放大／收回時間 | 1000 ms | 0.1～10 秒 | |
| `ringBigScale` | 大圖占畫面 | 100 % | 40～100 | |
| `ringRadius` | 圓角 | 10 px | 0～60 | |
| `ringThumbScale` | 縮圖畫質倍率 | 1× | 0.4～3 | |
| `ringBreathe` | 大圖呼吸動畫 | true | 開/關 | |

設定頁提示文字：
「圖片貼在旋轉木馬或立方體上，每次轉一格，轉到正面時停頓。旋轉木馬轉到背面的圖會自動換新；立方體選「隨機」時會上下左右翻（俯視角度不為 0 時只左右翻）。」

---

### 8.4 結構

```
#ringStage   perspective = max(1200, 4R, 3H) px（必須是 #ringRot 的直接父層）
 └ #ringRot  transform-style: preserve-3d；整個物體只改它的 transform（transition moveMs）
    └ .rface × N   各自 transform 定位在 3D 空間；內含 圖 + 黑幕
```

### 8.5 旋轉木馬

```
w = round(H × aspect)
R = (w + gap) / (2·tan(π/N))
第 i 張：rotateY(i·360/N) translateZ(R)
#ringRot：translateZ(−R) rotateX(−tilt) rotateY(−F·360/N)     F＝目前正面索引（任意整數）
```
- 向左轉：`F++`；向右轉：`F--`。角度直接累加（不取餘數），transition 才不會繞遠路。
- 黑幕（跟 transform 同時 transition）：第 i 張 `veil = (1 − dim) × (1 − cos((i − F)·2π/N)) / 2`。
- 轉動的同時把「轉完後的正背面」`(F + round(N/2)) mod N` 換成新圖（此時在背面又被遮暗，換圖不突兀）。

### 8.6 立方體（核心）

```
面的本地方向：front rotateY(0)、right rotateY(90)、back rotateY(180)、left rotateY(−90)、
             top rotateX(90)、bottom rotateX(−90)，各自再 translateZ(H/2)；backface-visibility: hidden
#ringRot：translateZ(−H/2) rotateX(−tilt) matrix3d(O)          O＝目前方向矩陣
一步：left → rotateY(−90)、right → rotateY(90)、up → rotateX(90)、down → rotateX(−90)
O' = Step × O（左乘＝在世界座標中轉），然後把 9 個元素四捨五入成 −1/0/1
```

翻之前：
1. 找出在 O' 下會轉到正面的那一面：`(O' × 面矩陣) × (0,0,1)` 的 z > 0.9。
2. 這一面此刻在側面，被正面完全擋住（相機在正前方時側面是「側著看」的）→ 趁現在換新圖。
3. 讓它轉到正面時是正的：在 r ∈ {0,90,180,270} 中找一個，使 `(O' × 面矩陣 × rotateZ(r)) × (0,−1,0)` 的 y < −0.9，把圖在面內轉 r 度。
4. 設定新的 transform，matrix3d 之間的補間會用四元數 slerp，走最短的 90° 弧線。

俯視角度 ≠ 0 時能看到頂面，上下翻會讓頂面換圖被看見，所以只左右翻。

---

### 8.7 放大

沿用圖牆／輪盤的 hero：從正面那一面的螢幕矩形變形成大圖；大圖停留期間隱藏整個 3D 物體。

### 8.8 效能

- 同時最多 24（旋轉木馬）或 6（立方體）張 canvas 縮圖，cover 裁成面的大小。
- 每一步只改一個元素的 transform（加上旋轉木馬各面黑幕的 opacity）。
- 視窗大小改變：設旗標，下一步前淡出重建。

### 8.9 驗收清單

- [ ] 旋轉木馬：每次轉一格、正面停頓、越後面越暗，背面圖會換新
- [ ] 立方體：隨機上下左右翻，轉到正面的圖永遠是正的
- [ ] 俯視角度 ≠ 0 的立方體只左右翻
- [ ] 每 N 次放大正面那張；0 時不放大
- [ ] 點擊／按鍵立即退出


---

## 9. 翻頁書（`book`）

> 來源：`slideshow-desktop`（Electron 版）的 `slideshow.js`（`bookStart` / `bookBuild` / `bookFlip` / `bookLoop`）、`slideshow.html`（`#book` 區塊 CSS）、`index.html`（`#bookOpts`）、`renderer.js`（`BOOK_FIELDS`）。
> 寫法跟 `reel-mode-spec.md` 一樣，可直接拿來移植到 Android。

---

### 9.1 一句話說明

相簿風格的書攤開在桌上，左右兩頁各貼一張照片 → 停留 → 右頁以書脊為軸翻過去（CSS 3D），背面就是下一個左頁，底下露出下一個右頁 → 停留 → …（可選每翻幾次放大一張）。

---

### 9.2 流程

```
[建立左右兩頁 → 淡入]
  ┌→ [停留 holdMs；同時在背景做好下一組兩張縮圖]
  │  (flips > 0 且 flips % bigEvery == 0 → 隨機左或右頁放大 → 收回 → 300ms)
  │  [翻頁 flipMs] → flips++
  └──────────────┘
```

圖片用完一律從頭再用。

---

### 9.3 設定參數

| key | UI 標籤 | 預設 | 範圍 / 選項 | 說明 |
|---|---|---|---|---|
| `bookSize` | 頁面高度（占畫面高） | 80 % | 30～98 | |
| `bookAspect` | 每頁比例（寬/高） | 0.75 | 0.75、1、1.333 | 兩頁總寬超過畫面 94% 時整本等比縮小 |
| `bookPad` | 紙張留白 | 8 % | 0～25 | 占頁面短邊；0＝照片滿版 |
| `bookPaper` | 紙張顏色 | cream | cream / white / black | 見第 5 節 |
| `bookFlipMs` | 翻頁時間 | 1400 ms | 0.2～10 秒 | |
| `bookHoldMs` | 每頁停留 | 3000 ms | 0.5～120 秒 | |
| `bookBigEvery` | 每翻幾次放大一次 | 0 | 0～50 | 0＝不放大 |
| `bookBigMs` | 大圖停留 | 3000 ms | 0.5～120 秒 | |
| `bookFlyMs` | 放大／收回時間 | 1000 ms | 0.1～10 秒 | |
| `bookBigScale` | 大圖占畫面 | 100 % | 40～100 | |
| `bookThumbScale` | 縮圖畫質倍率 | 1× | 0.4～3 | |
| `bookBreathe` | 大圖呼吸動畫 | true | 開/關 | |

設定頁提示文字：
「左右兩頁各貼一張照片，停留後右頁沿書脊翻過去，背面就是下一個左頁。留白 0＝照片滿版。」

---

### 9.4 幾何

```
ph = 畫面高 × size；pw = ph × aspect
若 2·pw > 畫面寬 × 0.94 → pw、ph 同比例縮小
pad = round(min(pw, ph) × padPct)
照片區：iw = pw − 2·pad、ih = ph − 2·pad（cover 裁切）
書（#bookSpread）：寬 2·pw、高 ph，置中；左頁 x = 0、右頁 x = pw
perspective = 4·pw（設在 #bookSpread，也就是葉子的直接父層）
```

### 9.5 外觀

- 紙張顏色 / 頁緣兩層顏色：cream `#f2ede1 / #ddd6c6 / #c9c1b0`、white `#fafafa / #e2e2e2 / #cfcfcf`、black `#1a1a1a / #2c2c2c / #3a3a3a`。
- 頁緣厚度：左頁 `box-shadow: -2px 2px 0 e1, -4px 4px 0 e2`，右頁鏡像。外側圓角 6px。
- 書脊陰影：每頁靠書脊那側 `rgba(0,0,0,.28) → .08（6%）→ 透明（14%）` 的漸層。
- 照片：`0 1px 3px rgba(0,0,0,.35)` 陰影（像貼上去的）。
- 整本書底下一層 `0 30px 60px rgba(0,0,0,.6)` 投影；桌面是深色木色的放射漸層。

### 9.6 翻頁（核心）

```
1. 新右頁 R2 放在右邊、最底層
2. 建立「葉子」：位置 = 右頁位置，transform-origin = 左緣中點（書脊），preserve-3d
   正面 = 目前右頁（搬進葉子），背面 = 新左頁 L2（rotateY(180deg)）；兩面 backface-visibility: hidden
3. 葉子 rotateY(0 → −180deg)，flipMs，cubic-bezier(.45,.05,.35,1)
   同時：
   - 正面暗化層 opacity 0 → .45（前半段，ease-in）
   - 背面暗化層 .45 → .45（前半段）→ 0（後半段，ease-out）
   - 底下 R2 的投影層（從書脊往外的黑漸層）.9 → 0（前半段）
   - 左頁的投影層 0 →（50%）0 →（85%）.8 → 0     ← 葉子快落下時壓暗左頁
4. 結束：舊左頁與葉子正面釋放；L2 移出葉子成為新的左頁；R2 成為右頁
```

### 9.7 放大

隨機挑左頁或右頁，用 hero 從那張照片（canvas）的螢幕矩形放大；大圖停留期間隱藏整本書。

### 9.8 效能

- 同時最多 4 張 canvas（左、右、葉子兩面），每張只有照片區大小。
- 翻頁只動葉子的 transform 和 4 層陰影的 opacity。
- 下一組縮圖在停留期間先做好。
- 視窗大小改變：設旗標，下一次翻頁前淡出重建。

### 9.9 驗收清單

- [ ] 翻頁有立體感，翻過去的背面圖片方向正確（不是鏡像）
- [ ] 翻頁時正面漸暗、背面漸亮，底下與左頁有投影
- [ ] 三種紙色、留白 0（滿版）都正常
- [ ] 每 N 次放大一張；預設 0 不放大
- [ ] 點擊／按鍵立即退出


---

## 10. 馬賽克組合（`mosaic`）

> 來源：`slideshow-desktop`（Electron 版）的 `slideshow.js`（`mosaicStart` / `msGrow` / `msPrepare` / `msBuild` / `msLoop`）、`slideshow.html`（`#mosaic` 區塊 CSS）、`index.html`（`#mosaicOpts`）、`renderer.js`（`MOSAIC_FIELDS`）。
> 寫法跟 `reel-mode-spec.md` 一樣，可直接拿來移植到 Android。

---

### 10.1 一句話說明

挑一張目標圖，把它切成格子、算出每格平均色，從「縮圖池」裡挑顏色最接近的小圖填進每一格 → 小圖一格格出現，同時鏡頭由近拉遠，大圖輪廓慢慢浮現 → 停留 → 原圖在上面淡入 → 停留 → 淡出換下一張。

---

### 10.2 流程

```
開始：先做 min(24, 池上限) 張小縮圖（畫面顯示「準備縮圖中… n / total」）→ 其餘在背景補
每一輪：
  [拼 buildMs（同時鏡頭拉遠，拉遠時間 = buildMs + holdMs）]
  [背景：池子換掉約 10%；準備下一輪的目標圖與配對]
  [馬賽克停留 holdMs] → [原圖淡入 revealMs] → [原圖停留 origMs] → [淡出 600ms]
```

圖片用完一律從頭再用。

---

### 10.3 設定參數

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

### 10.4 縮圖池

- 每張：原圖取中央正方形 → 縮成 `T = min(192, tile × dpr × q)` 的正方形 ImageBitmap（q 見第 7 節）。
- 平均色：把小圖畫到 8×8 canvas，64 個像素取平均 RGB。
- 不重複加入同一路徑。
- 池滿且圖片總數 > 池上限時，每輪隨機丟掉 10%（釋放 bitmap）再補新的。

### 10.5 目標圖與配對（核心）

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

### 10.6 繪製

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

### 10.7 原圖與效能

- 原圖用一個 `<img>` 蓋在上面（object-fit 同目標矩形的 contain/cover），opacity 淡入。
- canvas 解析度倍率 `q = clamp(min(2, zoom), 1, 4096 / (畫面長邊 × dpr))`：拉遠時不至於太糊，但最長邊不超過 4096。
- canvas 只在拼的過程中重畫；拉遠只動 transform。
- 每輪依當下視窗大小重新計算，所以不需要處理 resize。

### 10.8 驗收清單

- [ ] 開頭顯示準備進度，之後不再等待
- [ ] 拉遠後看得出是目標圖（調整比例 0 時也大致看得出）
- [ ] 三種出現順序都正常；放大倍率 1 時不拉遠
- [ ] 原圖淡入時跟馬賽克位置完全對齊
- [ ] 點擊／按鍵立即退出


---

## 11. 無限畫布漫遊（`canvas`）

> 來源：`slideshow-desktop`（Electron 版）的 `slideshow.js`（`canvasStart` / `cvBuild` / `cvFly` / `cvLoop`）、`slideshow.html`（`#cnv` 區塊 CSS）、`index.html`（`#cnvOpts`）、`renderer.js`（`CNV_FIELDS`）。
> 寫法跟 `reel-mode-spec.md` 一樣，可直接拿來移植到 Android。

---

### 11.1 一句話說明

照片散布在一大張「世界」上（鬆散格狀、隨機偏移、大小、傾斜），鏡頭先拉遠、平移、再拉近，飛到其中一張停下來看（換上原始解析度、鏡頭跟著傾斜讓照片變正）→ 停留期間把畫面外的幾張換成新照片 → 飛往下一張。

---

### 11.2 流程

```
[建立世界 → 鏡頭對準隨機一張 → 淡入]
  ┌→ [停留：載入原圖蓋上去 ＋ 換掉看不到的幾張 ＋ 至少 holdMs]
  │  [挑下一張] → [飛行 flyMs；飛到 40% 時拿掉上一張的原圖]
  └──────────────┘
```

---

### 11.3 設定參數

| key | UI 標籤 | 預設 | 範圍 / 選項 | 說明 |
|---|---|---|---|---|
| `cnvCount` | 照片張數 | 30 | 6～80 | 不超過圖片總數（至少 6） |
| `cnvSize` | 照片大小（占格子） | 70 % | 30～95 | |
| `cnvRotate` | 最大傾斜角度 | 4° | 0～20 | |
| `cnvView` | 停下時占畫面 | 80 % | 30～100 | |
| `cnvFlyMs` | 飛行時間 | 3500 ms | 0.3～20 秒 | |
| `cnvHoldMs` | 每張停留 | 4000 ms | 0～120 秒 | |
| `cnvReplace` | 每次停下換掉幾張 | 3 | 0～20 | |
| `cnvRadius` | 圓角 | 6 px | 0～40 | |
| `cnvThumbScale` | 縮圖畫質倍率 | 1× | 0.4～3 | |
| `cnvFrame` | 白框 | false | 開/關 | |

設定頁提示文字：
「照片散布在一大張畫布上，鏡頭拉遠、平移、再拉近飛到其中一張停下來看，再飛往下一張。停下時會換上原始解析度，畫面外的照片會慢慢換新。」

---

### 11.4 世界

```
CELL = 1000（世界座標，與螢幕無關）
cols = max(3, round(sqrt(n × 16/9)))，rows = ceil(n / cols)，第 i 張在格 (i mod cols, floor(i / cols))
照片尺寸：放進 CELL × size × rand(0.75～1) 的方框，保留原圖比例（限制 1:2～2:1）
中心：格中心 ± CELL × 0.11（隨機）；傾斜：±rotate（隨機）
白框：每邊 min(w,h) × 0.045，紙色 #f4f2ec
縮圖：長邊 480 × thumbScale × min(2, dpr) px（飛行中看的；停下時換原圖）
```

### 11.5 鏡頭（核心）

```
世界容器 transform = translate(畫面寬/2, 畫面高/2) rotate(−r) scale(s) translate(−x, −y)
停在照片 P：x, y = P 中心；r = P 的傾斜；s = min(畫面寬 × view / P寬, 畫面高 × view / P高)（含白框）
```
每個關鍵影格都用同樣這 4 個函式 → 瀏覽器逐個函式內插（位置在世界座標中線性、縮放與旋轉各自獨立）。

#### 飛行 A → B

```
fit  = min(畫面寬 / (|Bx−Ax| + CELL), 畫面高 / (|By−Ay| + CELL)) × 0.9   ← 能同時看到起訖兩張的縮放
sMid = min(As, Bs, fit)
bump = max(0, (ln As + ln Bs)/2 − ln sMid)
取 25 個點 t = 0, 1/24, …, 1：
  u = easeInOutCubic(t)
  x, y, r = A + (B − A)·u
  s = exp(ln As + (ln Bs − ln As)·u − bump·sin(π t))
關鍵影格之間 linear，總長 flyMs
```
縮放在對數空間內插，看起來是等速的「拉遠 → 拉近」；中段拉遠到能同時看到起點與終點。

#### 挑下一張

優先選距離目前照片 1.2～3 格的；沒有就任選其他一張。

### 11.6 停下時

- 原圖：載入原始解析度，用 `<img>`（object-fit: cover）蓋在縮圖上淡入 400ms；飛走時（飛到 40%，已經拉遠）移除。
- 換新：找出「現在畫面」與「下一段終點畫面」都看不到的照片（含 30% 邊界），隨機換掉 `replace` 張；
  新照片的尺寸、偏移、傾斜重新隨機。

### 11.7 效能

- 同時只有 `count` 張縮圖 canvas 加最多一張原圖。
- 飛行是一個 Web Animations 動畫（交給合成器）；整個世界只有一個 transform。
- 視窗大小改變：設旗標，下一次停下時淡出重建。

### 11.8 驗收清單

- [ ] 飛行是平順的「拉遠 → 平移 → 拉近」，沒有頓挫
- [ ] 停下時照片是正的、清晰（原始解析度）、占畫面約 view%
- [ ] 一段時間後照片會換新，且換的時候看不到
- [ ] 白框開關、傾斜 0 都正常
- [ ] 點擊／按鍵立即退出


---

## 12. 漂浮星空／泡泡（`float`）

> 來源：`slideshow-desktop`（Electron 版）的 `slideshow.js`（`floatStart` / `flBuild` / `flLaunch` / `flKeyframes` / `flSpotlight`）、`slideshow.html`（`#float` 區塊 CSS）、`index.html`（`#floatOpts`）、`renderer.js`（`FLOAT_FIELDS`）。
> 寫法跟 `reel-mode-spec.md` 一樣，可直接拿來移植到 Android。

---

### 12.1 一句話說明

很多張縮圖在空間中飄過：**星空**是由遠往近飛過鏡頭，**泡泡**是圓形縮圖由下往上漂、左右輕擺。每隔幾秒全部暫停，挑一張放大成大圖，收回後繼續。

---

### 12.2 流程

```
[建立 count 個粒子，每個從隨機進度開始（畫面一開始就是滿的）]
每個粒子：飛完一段 → 重新出生（新位置、新縮圖）→ 再飛
主迴圈：每隔 bigEveryMs → 全部暫停 → 挑一張 → 放大 flyMs → 停留 bigMs → 收回 flyMs → 全部繼續
bigEveryMs = 0：不放大
```

---

### 12.3 設定參數

| key | UI 標籤 | 預設 | 範圍 / 選項 | 說明 |
|---|---|---|---|---|
| `floatStyle` | 樣式 | stars | stars / bubbles | |
| `floatCount` | 同時張數 | 30 | 6～80 | |
| `floatSize` | 縮圖大小（占畫面短邊） | 22 % | 5～60 | 星空：放進 S×S 方框保留比例（1:2～2:1）；泡泡：S×S 正方形裁成圓 |
| `floatTravelMs` | 飛過時間 | 14000 ms | 2～60 秒 | |
| `floatBigEveryMs` | 每隔幾秒放大一張 | 10000 ms | 0～300 秒 | |
| `floatBigMs` | 大圖停留 | 3000 ms | 0.5～120 秒 | |
| `floatFlyMs` | 放大／收回時間 | 1000 ms | 0.1～10 秒 | |
| `floatBigScale` | 大圖占畫面 | 100 % | 40～100 | |
| `floatThumbScale` | 縮圖畫質倍率 | 1× | 0.4～3 | 星空另外 ×1.5（飛近時會放大） |
| `floatBreathe` | 大圖呼吸動畫 | true | 開/關 | |

設定頁提示文字：
「縮圖在空間中飄過，像星空或泡泡；每隔一段時間會暫停，把其中一張放大成大圖。」

---

### 12.4 星空

```
P（perspective）= max(800, 畫面短邊 × 1.2)，設在粒子容器，容器 transform-style: preserve-3d（依遠近排序）
出生位置：ang = rand·2π；r = 0.7·max(寬,高) × (0.2 + 0.8·sqrt(rand))
          x = cos(ang)·r，y = sin(ang)·r·0.75（相對畫面中心）
z：從 −8P 線性移到 +0.55P（越近越快、越大，最後飛出畫面）
opacity：0 →（15%）1 →（88%）1 → 0
時間：travelMs × rand(0.8～1.2)，linear
```
背景：靜態 canvas，每 2500 px² 一顆星，半徑 0.2～1.5px，alpha 0.05～0.75；底色深藍放射漸層。

### 12.5 泡泡

```
每個泡泡有深度 d ∈ [0,1]（重新出生時重抽）：
  縮放 sc = 0.45 + 0.55·d；z-index = d·100；不透明度 = 0.55 + 0.45·d
  時間 = travelMs × (1.5 − 0.7·d) × rand(0.9～1.1)     ← 遠的漂得慢（視差）
路徑：9 個關鍵影格，y 從畫面下緣外 → 上緣外；
      x = x0 + sin(ph + u·3π) × amp，x0 在畫面寬 95% 內隨機，amp = (20～70)·sc，ph 隨機
頭尾影格 opacity 0
```
外觀：圓形、白色細邊（2px, .35）、左上反光（放射漸層）、邊緣微亮；底色藍綠直向漸層。

### 12.6 放大

- 候選：不在淡入淡出段（進度 18%～85%）、寬度 ≥ 短邊 5%、完整在畫面內。
- 星空挑最大的那張（最近）；泡泡隨機。
- 全部粒子動畫 pause → hero（泡泡圓角 = 半徑，看起來是圓變成大圖）→ 收回 → 全部 play。

### 12.7 效能

- 每個粒子一個 Web Animations 動畫，只動 transform / opacity，交給合成器。
- 重新出生時才換縮圖（此時在遠處或畫面外）。
- 視窗大小改變：只重畫背景星點，粒子下一次出生就會用新範圍。

### 12.8 驗收清單

- [ ] 星空：縮圖由中心附近的遠處飛向四周、越來越大，遠近遮擋正確
- [ ] 泡泡：圓形、有反光、由下往上漂、遠小近大、遠的慢
- [ ] 每隔設定時間會暫停並放大一張；0 時不放大
- [ ] 長時間播放縮圖會換新
- [ ] 點擊／按鍵立即退出


---

## 13. 時間軸（`timeline`）

> 來源：`slideshow-desktop`（Electron 版）的 `main.js`（`parseExifDate` / `photoDate` / IPC `photo-dates`）、`preload.js`（`photoDates`）、`slideshow.js`（`timelineStart` / `tlLoadDates` / `tlBuildAxis` / `tlShow` / `tlLoop`）、`slideshow.html`（`#tl` 區塊 CSS）、`index.html`（`#tlOpts`）、`renderer.js`（`TL_FIELDS`）。
> 寫法跟 `reel-mode-spec.md` 一樣，可直接拿來移植到 Android。

---

### 13.1 一句話說明

讀每張照片的拍攝日期，依日期排序一張張播放：照片交叉淡化、下方大字顯示日期；旁邊一條直式時間軸（年份、月份＋張數）同步捲動，讓目前這張停在標記點上。適合家庭相簿。

---

### 13.2 流程

```
[讀拍攝日期（每批 200 張，畫面顯示「讀取拍攝日期… n / total」）]
[依日期排序（同時間再依路徑）→ 建立時間軸]
  ┌→ [顯示第 i 張：解碼 → 交叉淡化 fadeMs；時間軸捲動；日期文字淡出換字淡入]
  │  [停留 holdMs]
  └──────────────┘
播到最後：循環播放開 → 回到第一張；關 → 顯示「播放完畢」後退出
```

不受「隨機順序」影響。壞圖跳過。

---

### 13.3 設定參數

| key | UI 標籤 | 預設 | 範圍 / 選項 | 說明 |
|---|---|---|---|---|
| `tlOrder` | 排序 | asc | asc（由舊到新）/ desc（由新到舊） | |
| `tlSide` | 時間軸位置 | left | left / right | |
| `tlHoldMs` | 每張停留 | 4000 ms | 0.5～120 秒 | |
| `tlFadeMs` | 淡入淡出時間 | 1000 ms | 0～5 秒 | 時間軸捲動時間 = max(300, fadeMs) |
| `tlKb` | 緩慢放大 | true | 開/關 | 每張 scale 1 → 1.05，時間 holdMs + 2·fadeMs |
| `tlShowTime` | 顯示時間（時:分） | false | 開/關 | |

設定頁提示文字：
「依照片的拍攝日期（EXIF）排序播放，旁邊的時間軸顯示年份、月份與張數。沒有 EXIF 的照片用檔案修改日期。不受「隨機順序」影響。」

---

### 13.4 拍攝日期（主行程，不用套件）

```
讀檔案開頭 128KB
JPEG（FF D8）→ 依序走 marker；遇到 APP1（FF E1）且內容以 "Exif\0\0" 開頭 → TIFF
TIFF：位元組序 "II"（little endian）或 "MM"（big endian）；IFD0 位移在 TIFF+4
  IFD0 的 0x8769（ExifIFD 指標）→ ExifIFD 的 0x9003 DateTimeOriginal，沒有再 0x9004 DateTimeDigitized
  都沒有 → IFD0 的 0x0132 DateTime
字串格式 "YYYY:MM:DD HH:MM:SS"，以「本地時間」解讀；"0000:..." 視為無效
遇到 SOS（FF DA）或 EOI（FF D9）就停（不會再有 EXIF）
找不到（或非 JPEG）→ 檔案修改時間（exif = false）
```
- 結果在主行程快取（同一次執行內不重讀）。
- IPC `photo-dates(paths[])` → `[{ t: 毫秒, exif: bool }]`，內部 8 個併發。
- Android：可直接用 `ExifInterface` 讀 `TAG_DATETIME_ORIGINAL` → `TAG_DATETIME_DIGITIZED` → `TAG_DATETIME`，沒有再用檔案修改時間。

### 13.5 時間軸

```
vh = 畫面高
step = max(6, vh × 0.012)        每張照片在軸上的間距
monthGap = vh × 0.055，yearGap = vh × 0.1，maxMonth = vh × 0.5
依排序後清單逐張：
  年份變了：（不是第一年再加 0.6·yearGap）放年份標籤 → y += yearGap
  月份變了：（不是該年第一個月再加 0.4·monthGap）放刻度＋月份標籤（含該月張數）→ y += 0.6·monthGap
            該月間距 sp = min(step, maxMonth / 該月張數)      ← 一個月照片很多時壓縮
  這張的位置 pos[i] = y；y += sp
```
- 只建立年份與月份標籤（數量很少），不為每張照片建立元素 → 上萬張也沒問題。
- 標記點固定在時間軸區塊垂直中央；軸的 transform = `translateY(H/2 − pos[i])`，transition 捲動，曲線 `cubic-bezier(.45,0,.25,1)`。
- 目前月份的標籤加亮。
- 年份、月份文字用 `Intl.DateTimeFormat(語言, { year: 'numeric' })`、`{ month: 'long' }`。
- 外觀：軸寬 22vw；軸線在 62%（右側時 30%）；年份金色 `#f2d48a`、字級 vh×0.045；月份字級 vh×0.02；上下 18% 漸隱遮罩；
  標記點金色圓點＋光暈，並有一條漸隱的線指向照片。

### 13.6 照片與日期

- 照片區：時間軸另一側；`<img>` 兩層交叉淡化，object-fit: contain，上 5%、下 17% 留白，帶 drop-shadow。
- 日期：`Intl.DateTimeFormat(語言, { year, month: 'long', day, weekday: 'short' [, hour, minute] })`，字級 vh×0.04，置中在照片下方；
  沒有 EXIF 時下面小字顯示「（檔案修改日期）」。

### 13.7 驗收清單

- [ ] 有 EXIF 的照片依拍攝時間排序；沒有的用修改時間並標示
- [ ] 時間軸年份、月份與張數正確，捲動平順、目前月份加亮
- [ ] 由新到舊、時間軸放右邊都正常
- [ ] 循環關閉時播完會結束
- [ ] 上千張照片時開頭讀日期有進度、播放不卡
- [ ] 點擊／按鍵立即退出
