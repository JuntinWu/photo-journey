# 影像旅誌 · Photo Journey

將旅行照片自動轉換成時尚編輯風格的旅遊部落格 — 抓 EXIF / GPS、反查地點、Claude 自動撰寫景點介紹。

## 使用方式

### 1. 安裝
```bash
npm install
```

### 2. 放照片
把旅行照片（JPG / HEIC / PNG）丟進 `photos/` 資料夾。

### 3. 處理
```bash
npm run process
```
會自動：
- 讀 EXIF：拍攝時間、相機、GPS 座標
- 用 OpenStreetMap Nominatim 反查地點名稱
- 產生 1600px 縮圖到 `public/thumbs/`
- 寫入 `data/posts.json`

### 4. 讓 Claude 寫景點介紹
在 Claude Code 中說：
> 「幫我寫景點介紹」 或 「更新 photo-journey blog」

Claude 會讀取 `data/posts.json`，為每張照片用繁體中文撰寫 editorial 風格的景點介紹與標籤。

### 5. 開啟 blog
```bash
npm run dev
```
→ http://localhost:3456

## 專案結構

```
photo-journey/
├── photos/                          # 放照片的資料夾
├── public/thumbs/                   # 自動產生的縮圖
├── data/posts.json                  # 處理結果
├── scripts/process.js               # EXIF + 地理編碼
├── index.html                       # 部落格前端
├── serve.js                         # 本地開發伺服器
└── .claude/skills/photo-journey/    # Claude Skill 定義
    └── SKILL.md
```

## 技術

- **EXIF**：[exifr](https://github.com/MikeKovarik/exifr)
- **縮圖**：[sharp](https://sharp.pixelplumbing.com/)
- **反向地理編碼**：[OpenStreetMap Nominatim](https://nominatim.org/) (免費、無 API key)
- **AI 撰寫**：Claude (via skill)
- **前端**：純 HTML/CSS/JS，無建置流程

## Deploy

```
npx vercel --prod
```