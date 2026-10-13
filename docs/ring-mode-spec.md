# 3D 旋轉相簿模式（Ring Mode：旋轉木馬／立方體）規格

> 來源：`slideshow-desktop`（Electron 版）的 `slideshow.js`（`ringStart` / `ringBuild` / `ringStep` / `ringLoop`、`CUBE_FACES`、`cubeUpright`）、`slideshow.html`（`#ring` 區塊 CSS）、`index.html`（`#ringOpts`）、`renderer.js`（`RING_FIELDS`）。
> 寫法跟 `reel-mode-spec.md` 一樣，可直接拿來移植到 Android。

---

## 1. 一句話說明

圖片貼在**旋轉木馬**（N 張繞一圈）或**立方體**（6 面）上，每次轉一格（ease-in-out），轉到正面時停頓 `holdMs`，每轉幾格把正面那張放大成大圖。旋轉木馬轉到背面的圖自動換新；立方體翻之前先把「即將轉到正面」的那一面換成新圖並轉正。

---

## 2. 流程

```
[建立（全部面都放圖）→ 淡入]
  ┌→ [停頓 holdMs]
  │  (steps > 0 且 steps % bigEvery == 0 → 放大 flyMs → 大圖 bigMs → 收回 flyMs → 300ms)
  │  [轉一格 moveMs] → steps++
  └──────────────┘
```

---

## 3. 設定參數

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

## 4. 結構

```
#ringStage   perspective = max(1200, 4R, 3H) px（必須是 #ringRot 的直接父層）
 └ #ringRot  transform-style: preserve-3d；整個物體只改它的 transform（transition moveMs）
    └ .rface × N   各自 transform 定位在 3D 空間；內含 圖 + 黑幕
```

## 5. 旋轉木馬

```
w = round(H × aspect)
R = (w + gap) / (2·tan(π/N))
第 i 張：rotateY(i·360/N) translateZ(R)
#ringRot：translateZ(−R) rotateX(−tilt) rotateY(−F·360/N)     F＝目前正面索引（任意整數）
```
- 向左轉：`F++`；向右轉：`F--`。角度直接累加（不取餘數），transition 才不會繞遠路。
- 黑幕（跟 transform 同時 transition）：第 i 張 `veil = (1 − dim) × (1 − cos((i − F)·2π/N)) / 2`。
- 轉動的同時把「轉完後的正背面」`(F + round(N/2)) mod N` 換成新圖（此時在背面又被遮暗，換圖不突兀）。

## 6. 立方體（核心）

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

## 7. 放大

沿用圖牆／輪盤的 hero：從正面那一面的螢幕矩形變形成大圖；大圖停留期間隱藏整個 3D 物體。

## 8. 效能

- 同時最多 24（旋轉木馬）或 6（立方體）張 canvas 縮圖，cover 裁成面的大小。
- 每一步只改一個元素的 transform（加上旋轉木馬各面黑幕的 opacity）。
- 視窗大小改變：設旗標，下一步前淡出重建。

## 9. 驗收清單

- [ ] 旋轉木馬：每次轉一格、正面停頓、越後面越暗，背面圖會換新
- [ ] 立方體：隨機上下左右翻，轉到正面的圖永遠是正的
- [ ] 俯視角度 ≠ 0 的立方體只左右翻
- [ ] 每 N 次放大正面那張；0 時不放大
- [ ] 點擊／按鍵立即退出
