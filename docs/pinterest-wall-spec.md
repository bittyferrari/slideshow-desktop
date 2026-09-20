# Pinterest 圖牆效果（Wall Mode）完整規格

> 來源專案：slideshow-desktop（Electron）
> 相關檔案：`slideshow.js`（L286–L756 圖牆邏輯）、`slideshow.html`（L116–L200 圖牆 CSS）、
> `index.html`（設定 UI）、`renderer.js`（`WALL_FIELDS` 預設值對照表）
> 本文件用途：提供給 Android 專案照著實作同樣的視覺與節奏。

---

## 1. 一句話描述

滿版的 masonry（磚牆／瀑布流）圖片牆 → 整個畫面變暗 → 其中一張慢慢「亮起來」→
從它原本的位置放大飛成全螢幕大圖 → 停留（帶呼吸動畫）→ 原路收回 →
（一輪可重複聚焦 N 張）→ 回復亮度 → 依比例換掉一部分舊圖 → 無限循環。

---

## 2. 版面（Layout）

### 2.1 結構層級

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

### 2.2 欄寬計算

```
cols     = wallCols > 0 ? wallCols : auto
auto     = clamp(3, 10, round(screenWidth / 300))      // 每欄約 300px
innerW   = wallWidth  - gap * 2
wallH    = wallHeight - gap * 2
colW     = floor((innerW - gap * (cols - 1)) / cols)
```

### 2.3 磚塊高度與定位（自製 masonry，不是等高格線）

- 每塊磚高度 `h = round(colW * (原圖高 / 原圖寬))` → **保持原圖比例，不裁切變形**。
- 放置規則：永遠放進「目前累計高度最短的那一欄」的最底部（shortest-column first）。
- 位置用 `translate3d(x, y, 0)`：
  ```
  x = col * (colW + gap)
  y = 該欄目前累計高度
  該欄累計高度 += h + gap
  ```
- **關鍵：位置變化只改 transform，絕不改 left/top/width/height**（避免 reflow）。

### 2.4 填滿策略

- 目標：每欄堆到 `wallH * 1.25`（比可視區高 25%），畫面下緣外預留備援磚塊，
  這樣「往上推」時下方才有東西補位、不會露出黑底。
- 張數上限 `cap = max(cols, round(cols * wallRows))`。
- 換圖後若欄底露白，用 `topUpColumns()` 補到 `wallH * 1.15`，上限 `cols * wallRows * 1.5`。

### 2.5 視窗尺寸改變

`resize` 事件 debounce 400ms 後整面重建（欄寬變了，所有高度都要重算）。
→ Android 對應：螢幕旋轉／多視窗尺寸變更時重建。

---

## 3. 圖片載入管線（效能核心）

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

## 4. 播放狀態機（一輪的完整節奏）

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

## 5. 聚焦單張（spotlightOne）

### 5.1 挑選規則
- 候選 = 已顯示（`shown`）且 `y < wallH`（在可視範圍內）且本輪未被選過（無 `used`）的磚塊。
- 若候選為空，退而選所有可視磚塊。
- 從候選中**隨機**挑一張，標記 `used`。

### 5.2 動作序列

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

## 6. 換圖（一輪結束後）

隨機挑 `round(磚塊數 × replacePct / 100)` 張。
**縮圖一律先在背景全部做好，才開始播動畫**（避免動畫中途卡在解碼）。

### 方式 A：`fade`（原地淡出淡入）
- 磚塊位置與高度不變，只換內容物。
- 依序（每張間隔 `staggerMs`）移除 `shown` → 淡出並 `scale(0.96) translateY(10px)`。
- 等 `staggerMs × n + max(400, dimMs × 0.8)` 後替換 canvas，再依序加回 `shown` 淡入。
- 動畫時間 `--tile-ms = max(300, round(dimMs * 0.8))`，easing `ease`。

### 方式 B：`push`（預設，移除 → 下面往上推 → 欄底補新圖）
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

## 7. 磚塊進場動畫

- 初始狀態：`.tile-inner { opacity: 0; transform: scale(0.96) translateY(10px); }`
- 顯示：加上 `shown` → `opacity: 1; transform: none;`，時間 `--tile-ms`，easing `ease`。
- 建牆時**逐張錯開**：第 i 張延遲 `staggerMs × i` 才顯示。
- 建牆完成後再等 `staggerMs × n + 400ms` 才開始主迴圈。

---

## 8. 參數總表

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

## 9. Android 實作時的效能鐵則（原專案註解直接翻過來）

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

## 10. 附帶行為

- **資訊面板**：滑鼠移動時顯示目前聚焦圖片的檔名／路徑／尺寸；聚焦開始時就更新 `current`。
  → Android 可改為觸控時顯示，或直接省略。
- **離開**：點擊或任意按鍵退出播放，`wallStopped = true`，
  所有 `await` 之後都會檢查這個旗標並提前 return（避免非同步流程繼續跑）。
  → Android 對應：用 CoroutineScope + `isActive` 檢查，或 Job.cancel()。
