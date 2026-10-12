# 輪盤模式（Reel Mode）規格：移植到 Android 用

> 來源：`slideshow-desktop`（Electron 版）的 `slideshow.js`、`slideshow.html`、`index.html`、`renderer.js`。
> 這份文件把桌面版輪盤模式的行為、參數、數學和效能做法完整寫下來，給 Android 專案（Kotlin，建議用 Jetpack Compose）重新實作。
> **目標：畫面和手感跟桌面版一致，全程 60fps 不卡頓。**

---

## 1. 一句話說明

一排圖片沿水平或垂直方向排成一條無限循環的帶子 → **加速 → 等速平移 → 減速停下**，而且一定剛好停在「這輪預先選好的那張」的正中間 → 其他圖變暗，選中的那張浮起來 → **從原位置放大成大圖（飛出去）** → 停留（可以加呼吸動畫）→ **縮回原位** → 換掉一部分圖片 → 下一輪。不斷循環，直到使用者觸碰或按任意鍵才退出。

---

## 2. 一輪的流程（時間軸）

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

## 3. 設定參數（全部要可以在設定頁調整並儲存）

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

## 4. 版面與名詞

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

## 5. 停準的數學（核心，請照抄）

### 5.1 運動方程式

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

### 5.2 每輪開始時算出等速距離，保證停在選中那張的正中間

```kotlin
O = mod(O, L)
val b = pick()                                   // 先選好這輪要停哪張
val want = b.x + b.len/2 - screenMain/2          // 讓 b 的中心對齊螢幕中心所需的位移（mod L）
val cruise0 = v * max(0, spinMs)
val C = cruise0 + mod(dirSign*(want - O) - uA - cruise0 - dDec, L)
// 等速時間 Cm = C / v
```

結束時 `O_end = O + dirSign*(uA + C + dDec)`，且 `mod(O_end, L) == mod(want, L)` → 選中那張剛好在正中央。

### 5.3 找出畫面正中間的是哪一份複本（放大時要從它的位置飛出）

```
m = round((screenMain/2 - b.len/2 - b.x + mod(O, L)) / L)
m = clamp(m, 0, K-1)
該複本在螢幕上的主軸位置 = m*L + b.x - mod(O, L)
```

### 5.4 選圖規則 `pick()`

- 從「這批還沒被選過（`used == false`）且不是上一輪那張」裡隨機挑
- 全部都用過 → 把 `used` 全部清掉，再從「不是上一輪那張」裡挑
- 還是沒有（只有 1 張）→ 從全部挑
- 選中後 `used = true`、`last = b`

---

## 6. 換圖（每輪結束）

- `n = min(N, round(N × replacePct/100))`，n ≤ 0 就跳過
- 隨機挑 n 塊要被換掉的磚塊
- **先在背景做好 n 張新縮圖**（併發 3），做好才開始換，失敗的圖自動跳過
- 圖片來源順序：依序取圖片清單下一張；走完一輪時，若設定「循環」就從頭開始（若設定「隨機」則重新洗牌），否則停止供圖
- **固定比例（aspect > 0）**：主軸長度不變 → 每塊依序（間隔 60ms 錯開）原地「縮小到 0.9 + 淡出」（450ms）→ 換內容 → 依序淡入還原（450ms）。位置完全不動
- **原圖比例（aspect == 0）**：長度會變 → 整條帶子淡出（450ms）→ 換資料、重新排版（重算 x、L、K）→ 淡入（450ms）
- 換掉的舊縮圖要 `recycle()` / 釋放

---

## 7. 開始 / 建立 / 重建

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

## 8. 縮圖製作（效能關鍵）

- 讀原圖 → **cover 裁切**成磚塊比例 → 縮到 `磚塊尺寸 × density × thumbScale` 像素 → 立即釋放原圖
  ```
  若 nw/nh > w/h：sw = round(nh*w/h), sx = (nw-sw)/2, sy = 0, sh = nh
  否則：         sh = round(nw*h/w), sy = (nh-sh)/2, sx = 0, sw = nw
  ```
- Android：用 `BitmapFactory.Options.inSampleSize` 先粗縮再精縮（或 Coil/Glide 指定尺寸＋`Scale.FILL`），`Bitmap.Config.RGB_565` 或 `HARDWARE` 皆可，避免把數十張原圖留在記憶體
- 解碼在 `Dispatchers.IO`，併發 3
- 大圖（放大用）才載入原始解析度，一次只有一張，但要限制最大尺寸不超過螢幕尺寸（避免 OOM）

---

## 9. 動畫與效能要求

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

## 10. 視覺細節

- 背景純黑
- 磚塊：圓角 `radius`，裁切內容，空的時候底色 `#111`
- 變暗黑幕：`#000`，alpha `1 - dim`，淡入淡出 `dimMs`
- 選中磚塊：在黑幕之上，`scale(1.06)`，邊框 `2dp rgba(255,255,255,0.4)`，陰影約 `0 18dp 50dp rgba(0,0,0,0.75)`，過程 `spotMs` ease-in-out
- 大圖背景黑底：`rgba(0,0,0,0.96)`，淡入淡出 `flyMs`
- 大圖停留期間隱藏輪盤
- （選配）桌面版有「圖片資訊」面板：顯示目前圖片的檔名、路徑、尺寸等，Android 可改為輕觸一下顯示、再次輕觸或返回鍵退出

---

## 11. 驗收清單

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
