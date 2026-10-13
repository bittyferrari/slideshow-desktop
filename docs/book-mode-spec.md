# 翻頁書模式（Book Mode）規格

> 來源：`slideshow-desktop`（Electron 版）的 `slideshow.js`（`bookStart` / `bookBuild` / `bookFlip` / `bookLoop`）、`slideshow.html`（`#book` 區塊 CSS）、`index.html`（`#bookOpts`）、`renderer.js`（`BOOK_FIELDS`）。
> 寫法跟 `reel-mode-spec.md` 一樣，可直接拿來移植到 Android。

---

## 1. 一句話說明

相簿風格的書攤開在桌上，左右兩頁各貼一張照片 → 停留 → 右頁以書脊為軸翻過去（CSS 3D），背面就是下一個左頁，底下露出下一個右頁 → 停留 → …（可選每翻幾次放大一張）。

---

## 2. 流程

```
[建立左右兩頁 → 淡入]
  ┌→ [停留 holdMs；同時在背景做好下一組兩張縮圖]
  │  (flips > 0 且 flips % bigEvery == 0 → 隨機左或右頁放大 → 收回 → 300ms)
  │  [翻頁 flipMs] → flips++
  └──────────────┘
```

圖片用完一律從頭再用。

---

## 3. 設定參數

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

## 4. 幾何

```
ph = 畫面高 × size；pw = ph × aspect
若 2·pw > 畫面寬 × 0.94 → pw、ph 同比例縮小
pad = round(min(pw, ph) × padPct)
照片區：iw = pw − 2·pad、ih = ph − 2·pad（cover 裁切）
書（#bookSpread）：寬 2·pw、高 ph，置中；左頁 x = 0、右頁 x = pw
perspective = 4·pw（設在 #bookSpread，也就是葉子的直接父層）
```

## 5. 外觀

- 紙張顏色 / 頁緣兩層顏色：cream `#f2ede1 / #ddd6c6 / #c9c1b0`、white `#fafafa / #e2e2e2 / #cfcfcf`、black `#1a1a1a / #2c2c2c / #3a3a3a`。
- 頁緣厚度：左頁 `box-shadow: -2px 2px 0 e1, -4px 4px 0 e2`，右頁鏡像。外側圓角 6px。
- 書脊陰影：每頁靠書脊那側 `rgba(0,0,0,.28) → .08（6%）→ 透明（14%）` 的漸層。
- 照片：`0 1px 3px rgba(0,0,0,.35)` 陰影（像貼上去的）。
- 整本書底下一層 `0 30px 60px rgba(0,0,0,.6)` 投影；桌面是深色木色的放射漸層。

## 6. 翻頁（核心）

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

## 7. 放大

隨機挑左頁或右頁，用 hero 從那張照片（canvas）的螢幕矩形放大；大圖停留期間隱藏整本書。

## 8. 效能

- 同時最多 4 張 canvas（左、右、葉子兩面），每張只有照片區大小。
- 翻頁只動葉子的 transform 和 4 層陰影的 opacity。
- 下一組縮圖在停留期間先做好。
- 視窗大小改變：設旗標，下一次翻頁前淡出重建。

## 9. 驗收清單

- [ ] 翻頁有立體感，翻過去的背面圖片方向正確（不是鏡像）
- [ ] 翻頁時正面漸暗、背面漸亮，底下與左頁有投影
- [ ] 三種紙色、留白 0（滿版）都正常
- [ ] 每 N 次放大一張；預設 0 不放大
- [ ] 點擊／按鍵立即退出
