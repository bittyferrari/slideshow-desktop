# 電影膠卷模式（Filmstrip Mode）規格

> 來源：`slideshow-desktop`（Electron 版）的 `slideshow.js`（`filmStart` / `filmBuild` / `filmRun` / `filmMaintain` / `filmSpotlight`）、`slideshow.html`（`#film`、`#filmFx` 區塊 CSS）、`index.html`（`#filmOpts`）、`renderer.js`（`FILM_FIELDS`）。
> 寫法跟 `reel-mode-spec.md` 一樣，可直接拿來移植到 Android。

---

## 1. 一句話說明

一條帶齒孔的底片橫向等速慢慢捲動（無限）→ 每隔 `bigEveryMs`，底片慢慢減速停下，最靠近畫面中央的那格放大成大圖 → 停留 → 收回 → 底片慢慢加速繼續走。可加底片顆粒、閃爍、輕微晃動、復古色調、傾斜。

---

## 2. 流程

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

## 3. 設定參數

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

## 4. 底片格的幾何（每格寬度固定）

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

## 5. 捲動

- 位移 `o`：畫面左緣在底片座標中的位置。底片容器 transform = `translateX(−o)`。
- 一段動畫 10 分鐘、等速、從目前 `o` 走到 `o + dirSign·v·600000ms`；結束時從終點接下一段。
  （交給合成器跑，主執行緒忙也不卡。）
- 目前位移 `o = 段起點 + dirSign · v · anim.currentTime`。
- 減速／加速用 `updatePlaybackRate` 漸變（每 40ms 一步，ease-out），位移連續。

### 維護（每 250ms）

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

## 6. 放大

- 挑格子：已畫好照片、照片區完整在畫面內、中心離畫面中心最近的那格。
- 用跟圖牆／輪盤同一套 hero：從那格照片區的螢幕矩形變形成大圖（圓角 2px）。大圖停留期間隱藏底片。
- 色調 sepia / bw 時大圖套同樣濾鏡（`sepia(.65) contrast(1.05)` / `grayscale(1) contrast(1.08)`）。

---

## 7. 懷舊效果（全部是合成層動畫，不重繪）

- **顆粒**：一張「半解析度 + 64px」的灰階雜訊 canvas，放大 2 倍（pixelated），opacity 0.09，用 `steps(1)` 每 0.1 秒跳到不同位移。蓋在最上層（大圖也有顆粒）。
- **閃爍**：暗角層 opacity 在 1 / 0.86 / 0.95 間跳動（0.27 秒一輪，steps）。
- **暗角**：`radial-gradient(transparent 55%, rgba(0,0,0,.55))`，固定。
- **晃動**：底片外層用 `translate` 在 ±1px 內跳動（0.5 秒一輪，steps），不影響捲動用的 transform。

---

## 8. 驗收清單

- [ ] 底片等速捲動、齒孔連續、無縫無跳動，長時間播放不會出現空白格
- [ ] 往右捲時方向相反；傾斜時畫面兩端仍蓋滿
- [ ] 每隔設定時間慢慢停下、放大中間那格、收回後慢慢再走；設 0 時不放大
- [ ] 三種色調都正確，大圖色調一致
- [ ] 顆粒、晃動開關有效
- [ ] 移動滑鼠顯示畫面中央那格的路徑與原圖尺寸
- [ ] 點擊／按鍵立即退出
