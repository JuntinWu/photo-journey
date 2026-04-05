---
name: photo-journey
description: Process travel photos into a multi-trip blog timeline. Extracts EXIF/GPS, reverse-geocodes locations via Nominatim, upgrades vague street names to famous landmarks using Claude's knowledge, and writes Traditional Chinese (zh-TW) attraction descriptions. Use when the user drops photos in photos/ folder or asks to "process photos", "update travel blog", "write descriptions", or similar.
---

# Photo Journey Skill

Turns a folder of travel photos into a beautiful editorial-style multi-trip timeline blog (`影像旅誌`). The workflow: **extraction** (automated) → **landmark upgrade + AI writing** (you do this) → **preview / export**.

## Project Structure

```
photo-journey/
├── photos/                    # user drops photos here
├── public/thumbs/             # auto-generated thumbnails (1600px)
├── data/posts.json            # generated metadata (trips + entries)
├── scripts/process.js         # EXIF + Nominatim geocoding + trip grouping
├── scripts/build.js           # static site exporter (dist/)
├── index.html                 # multi-trip SPA frontend with Leaflet map
└── serve.js                   # local dev server
```

## Data model

```
posts.json
├── stats           (totals)
└── trips[]         (auto-grouped by >21 day time gap)
    ├── id, title, subtitle, date_start, date_end, cover_photo_id, stats
    └── entries[]   (grouped by time+location proximity)
        ├── id, date, time, location, ai_description, tags
        └── photos[] (EXIF, camera, settings, GPS)
```

## When invoked

### Step 1 — Run extraction

```bash
npm run process
```

This:
- Extracts EXIF (GPS, timestamp, camera) from every photo
- Reverse-geocodes via Nominatim (OpenStreetMap, rate-limited 1 req/s)
- Generates 1600px JPEG thumbnails (HEIC supported via heic-convert)
- Groups photos into entries (≤120min + ≤150m apart + same day)
- Groups entries into trips (time gap < 21 days)
- Auto-titles trips: `"{year} {country}"` (e.g. `"2025 挪威"`)

**Re-runs are safe**: existing `ai_description`, `tags`, custom `place_name`, trip `title`/`subtitle`/`cover_photo_id` are all preserved.

### Step 2a — 🏛 Upgrade place names to famous landmarks

Nominatim often returns vague names like road names or bridge names. You have world knowledge — use it to upgrade them.

For each entry where `location` is not null:
- Read `location.lat`, `location.lon`, `location.place_name`, `location.city`, `location.country`, `location.display_name`
- If you recognize the coordinates as a **famous landmark, attraction, or well-known area** (a place a traveler would name in their blog), overwrite `location.place_name` with the landmark name in zh-TW.
- If the Nominatim name is already a good landmark (e.g. `金閣寺`, `Reine`, `道頓堀`), keep it.
- If you're not confident what's at those coordinates, leave `place_name` unchanged.

**Examples of upgrades:**

| Nominatim returns | Upgrade to (if you recognize it) |
|---|---|
| `Breisundet bru, Hamnøya` @ 67.945,13.132 | `Hamnøy 漁村` (famous red-rorbu village) |
| `Moskenesveien, Å` @ 67.88,12.98 | `Å 村`（羅弗敦最南端） |
| `Ebisubashi-suji Shopping Street` @ 34.67,135.50 | `道頓堀 × 戎橋` |
| `Noboriōji-chō, 奈良市` @ 34.68,135.84 | `奈良公園` or `東大寺` (if close) |
| `中正路271號, 新竹市` | keep restaurant name if user set it |
| A random road name you don't recognize | keep unchanged |

**Rule:** only upgrade if you have **high confidence** in the landmark. Never invent. When in doubt, keep Nominatim's name.

### Step 2b — ✍️ Write AI descriptions & tags

For every entry where `ai_description` is `null` or empty:

1. Write a **Traditional Chinese (繁體中文)** description, 2–4 sentences, editorial/travel-journal tone
2. Generate 3–5 **Traditional Chinese tags** (short words, no `#` prefix)

**Tone & style:**
- Editorial, literary, like Kinfolk or 旅讀 magazine
- Avoid generic phrases like "美麗的"、"很棒的景點"
- Focus on sensory detail, history, cultural context, a traveler's inner experience
- 2–4 sentences, ~80–150 字
- Full-width punctuation (，。、—)

**Example:**
For `place_name: "金閣寺"`:
> 金閣寺又名鹿苑寺，是京都北山一座禪宗寺院。建於 1397 年，原為足利義滿將軍的別墅，上方兩層樓皆以金箔包覆。舍利殿倒映於鏡湖池的水面之上，構成日本最具代表性的景色之一，靜謐而華麗。

Tags: `["寺院", "京都", "世界遺產", "禪意"]`

**Writing guidance by place type:**
- **寺院 / 神社**：歷史、建築特色、宗教意義
- **自然景觀**：感官體驗（光線、聲音、氣味）、地貌
- **街區 / 巷弄**：氛圍、在地文化、特色美食
- **美食地點**：味道、料理傳統、用餐場景
- **漁村 / 小鎮**：在地生活節奏、產業背景、地理特色

### Step 2c — ✨ Consider improving trip titles

For each trip, check `trip.title`. The auto-title is `"{year} {dominant_country}"` (e.g. `"2025 挪威"`). If you can suggest a more evocative title based on the trip's content (e.g. `"2025 羅弗敦群島・極光邊境"`, `"2026 台灣・新竹夜食"`), update `trip.title` and optionally add a `trip.subtitle` (a short poetic tagline).

Keep changes subtle — the user can always override.

### Step 3 — Save and preview

Write the updated JSON back to `data/posts.json`, then:

```bash
npm run dev    # opens http://localhost:3456
```

User refreshes to see changes. The frontend has:
- 🧳 **Trip list**: grid of all trips (cover photo, dates, stats)
- 🗺 **Real Leaflet map**: markers + dashed route polyline per trip
- 📖 **Timeline**: entries grouped by date, per trip
- 🖼 **Lightbox**: click any photo for full-screen view
- ⬅➡ **Gallery**: prev/next for multi-photo entries

### Step 4 — Static export (optional)

```bash
npm run build       # generates dist/ folder
```

Deploy `dist/` to GitHub Pages / Vercel / Netlify.

## Important rules

1. **Never invent GPS data** — if `location` is `null`, write description from filename/date or ask user
2. **Only fill nulls** — preserve existing `ai_description` and `tags`
3. **Never modify** `id`, `taken_at`, photos' `camera`/`thumb`/`settings`/EXIF fields
4. **Language: always 繁體中文 (zh-TW)**
5. **Upgrade place names with high confidence only** — better to keep Nominatim than guess wrong
6. **One source of truth**: all writes go to `data/posts.json`

## Commands the user may say

| User says | You do |
|---|---|
| "處理照片" / "process photos" | Run `npm run process`, then Steps 2a/2b |
| "寫景點介紹" / "write descriptions" | Steps 2a/2b only (skip extraction) |
| "更新 blog" | Full workflow: extract → upgrade → write → refresh |
| "我加了新照片" | `npm run process`, then write only for new entries |
| "匯出靜態網站" | `npm run build`, then tell user where dist/ is |
| "重寫 XX 的介紹" | Find that entry, rewrite `ai_description` and `tags` |

## JSON schema (simplified)

```json
{
  "generated_at": "ISO timestamp",
  "stats": { "photos": 10, "entries": 7, "locations": 3, "days": 4, "km": 8188, "trips": 2 },
  "trips": [
    {
      "id": "ba8nz", "title": "2025 挪威", "subtitle": null,
      "date_start": "2025-03-05", "date_end": "2025-03-07",
      "cover_photo_id": "5kdyk0",
      "stats": { ... },
      "entries": [
        {
          "id": "vzvr2u", "date": "2025-03-05", "time": "19:02",
          "location": {
            "lat": 67.945, "lon": 13.132,
            "place_name": "Hamnøy 漁村",    ← you may upgrade this
            "city": "Hamnøya", "country": "挪威", "country_code": "NO"
          },
          "photos": [ { "id": "...", "filename": "...", "thumb": "...", ... } ],
          "ai_description": null,             ← fill this in
          "tags": []                           ← and this
        }
      ]
    }
  ]
}
```
