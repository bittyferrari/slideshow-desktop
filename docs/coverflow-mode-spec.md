# 3D 封面流模式（Coverflow Mode）規格

> 來源：`slideshow-desktop`（Electron 版）的 `slideshow.js`（`cfStart` / `cfLoop` / `cfStep` / `cfPose` / `cfSpotlight`）、`slideshow.html`（`#cf` 區塊 CSS）、`index.html`（`#cfOpts`）、`renderer.js`（`CF_FIELDS`）。
> 寫法跟 `reel-mode-spec.md` 一樣，可直接拿來移植到 Android。

---

## 1. 一句話說明

中間一張正面朝向觀眾，兩側各 `side` 張斜擺成 3D 透視（往後退、朝中間轉）→ 停留 `holdMs` → 整排往前移一格，下一張轉到正中 → … 每隔 `bigEvery` 格，正中那張用跟圖牆／輪盤同一套 hero 動畫放大成大圖、停留、收回。無限流動，直到使用者點擊或按任意鍵才退出。

---

## 2. 流程（時間軸）

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

## 3. 設定參數

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

## 4. 位置模型（核心）

- 每張記一個**邏輯位置** `li`（整數），`c` 是目前正中的邏輯位置。畫面位置 `d = li − c`。
- 前移一格＝`c++`，然後把每張的 transform 重新寫成新 `d` 的姿勢，交給 transition 補間（`moveMs`，`cubic-bezier(.25,.8,.3,1)`）。
- 平常保留 `li ∈ [c − side, c + side]` 共 `2·side+1` 張。
- 前移前：在 `li = c + side + 1`（畫面外、透明）先放一張新的，不帶動畫。
- 前移後：`li < c − side` 的那張（已淡出）移除並釋放縮圖。

### 姿勢 `pose(d)`

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

## 5. 放大

完全沿用圖牆／輪盤的 hero：從正中那張的螢幕矩形（含圓角）變形成置中 contain 大圖 → `heroSettled` 拿掉裁切 → 大圖停留期間隱藏整個封面流（只畫一張圖）→ 收回到原位。原圖載入失敗則跳過。

---

## 6. 視覺細節

- 倒影：`-webkit-box-reflect: below 2px linear-gradient(transparent 62%, rgba(255,255,255,.22))`，套在卡片本身，所以會跟著 3D 旋轉。
- 側邊變暗：每張自己一層黑幕的 opacity（跟 transform 同時 transition），不用 filter。
- 背景純黑。

---

## 7. 效能

- 同時最多 `2·side+2` 張 `<canvas>` 縮圖；只動 transform / opacity。
- 縮圖 cover 裁成 `fitBox(B, aspect)` 的尺寸，原圖解碼完立刻釋放。
- 視窗大小改變：設旗標，下一格前整排淡出、用新尺寸重建。

---

## 8. 驗收清單

- [ ] 中間正面、兩側斜擺有明顯 3D 透視，越外側越暗
- [ ] 每次前移一格，遠端新圖淡入、另一端淡出，無跳動
- [ ] 方向 right 時整個鏡像
- [ ] 每 N 格正中那張放大、收回；0 時不放大
- [ ] 倒影開關有效
- [ ] 移動滑鼠顯示正中那張的路徑與原圖尺寸
- [ ] 點擊／按鍵立即退出
