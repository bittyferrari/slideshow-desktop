# 時間軸模式（Timeline Mode）規格

> 來源：`slideshow-desktop`（Electron 版）的 `main.js`（`parseExifDate` / `photoDate` / IPC `photo-dates`）、`preload.js`（`photoDates`）、`slideshow.js`（`timelineStart` / `tlLoadDates` / `tlBuildAxis` / `tlShow` / `tlLoop`）、`slideshow.html`（`#tl` 區塊 CSS）、`index.html`（`#tlOpts`）、`renderer.js`（`TL_FIELDS`）。
> 寫法跟 `reel-mode-spec.md` 一樣，可直接拿來移植到 Android。

---

## 1. 一句話說明

讀每張照片的拍攝日期，依日期排序一張張播放：照片交叉淡化、下方大字顯示日期；旁邊一條直式時間軸（年份、月份＋張數）同步捲動，讓目前這張停在標記點上。適合家庭相簿。

---

## 2. 流程

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

## 3. 設定參數

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

## 4. 拍攝日期（主行程，不用套件）

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

## 5. 時間軸

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

## 6. 照片與日期

- 照片區：時間軸另一側；`<img>` 兩層交叉淡化，object-fit: contain，上 5%、下 17% 留白，帶 drop-shadow。
- 日期：`Intl.DateTimeFormat(語言, { year, month: 'long', day, weekday: 'short' [, hour, minute] })`，字級 vh×0.04，置中在照片下方；
  沒有 EXIF 時下面小字顯示「（檔案修改日期）」。

## 7. 驗收清單

- [ ] 有 EXIF 的照片依拍攝時間排序；沒有的用修改時間並標示
- [ ] 時間軸年份、月份與張數正確，捲動平順、目前月份加亮
- [ ] 由新到舊、時間軸放右邊都正常
- [ ] 循環關閉時播完會結束
- [ ] 上千張照片時開頭讀日期有進度、播放不卡
- [ ] 點擊／按鍵立即退出
