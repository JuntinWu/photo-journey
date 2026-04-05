#!/usr/bin/env node
/**
 * Photo Journey — Photo Processor
 *
 * Scans photos/ folder, extracts EXIF (GPS, timestamp, camera),
 * reverse-geocodes via OpenStreetMap Nominatim, generates thumbnails.
 *
 * Groups photos taken within GROUP_TIME_MIN minutes at the same
 * GPS location (within GROUP_DIST_M meters) into a single entry.
 *
 * AI-generated descriptions/tags are filled in by Claude (via the
 * photo-journey skill) after this script runs.
 */

import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import exifr from 'exifr';
import sharp from 'sharp';
import heicConvert from 'heic-convert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PHOTOS_DIR = path.join(ROOT, 'photos');
const THUMBS_DIR = path.join(ROOT, 'public/thumbs');
const DATA_FILE = path.join(ROOT, 'data/posts.json');

const SUPPORTED = /\.(jpe?g|png|heic|heif|tiff?|webp)$/i;
const THUMB_WIDTH = 1600;

// Grouping thresholds — tweak to taste
const GROUP_TIME_MIN = 120;   // photos within 2 hours...
const GROUP_DIST_M = 150;     // ...and 150 meters count as the same "visit"
const TRIP_GAP_DAYS = 21;     // photos more than 21 days apart → new trip

// ---------- Utilities ----------

function hashId(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

const formatDate = d => d.toISOString().slice(0, 10);
const formatTime = d => {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
};

function haversineM(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;
  return R * 2 * Math.asin(Math.sqrt(s));
}

// ---------- Reverse Geocoding (Nominatim) ----------

const geocodeCache = new Map();

async function reverseGeocode(lat, lon) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (geocodeCache.has(key)) return geocodeCache.get(key);
  await new Promise(r => setTimeout(r, 1100)); // Nominatim rate limit

  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=zh-TW,zh,en&zoom=16`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'photo-journey/0.1 (personal photo blog)' }
    });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const data = await res.json();
    const a = data.address || {};
    const placeName =
      a.tourism || a.attraction || a.historic || a.leisure || a.natural ||
      a.building || a.road || a.suburb || a.neighbourhood ||
      a.village || a.town || a.city || a.county || data.name || 'Unknown location';
    const city = a.city || a.town || a.village || a.municipality || a.county || '';
    const result = {
      place_name: placeName,
      city,
      country: a.country || '',
      country_code: (a.country_code || '').toUpperCase(),
      display_name: data.display_name || '',
    };
    geocodeCache.set(key, result);
    return result;
  } catch (err) {
    console.warn(`  ⚠ Geocoding failed for ${key}: ${err.message}`);
    const fallback = { place_name: 'Unknown location', city: '', country: '', country_code: '', display_name: '' };
    geocodeCache.set(key, fallback);
    return fallback;
  }
}

// ---------- Photo Processing ----------

const HEIC_RE = /\.(heic|heif)$/i;

async function ensureThumbnail(srcPath, id) {
  const thumbPath = path.join(THUMBS_DIR, `${id}.jpg`);
  if (existsSync(thumbPath)) return `public/thumbs/${id}.jpg`;
  try {
    // HEIC/HEIF: decode to JPEG buffer first (sharp's prebuilt binaries don't read HEIC)
    let input = srcPath;
    if (HEIC_RE.test(srcPath)) {
      console.log(`  🔄 Converting HEIC → JPEG...`);
      const heicBuf = await readFile(srcPath);
      input = await heicConvert({ buffer: heicBuf, format: 'JPEG', quality: 0.92 });
    }
    await sharp(input)
      .rotate()
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(thumbPath);
    return `public/thumbs/${id}.jpg`;
  } catch (err) {
    console.warn(`  ⚠ Thumbnail failed: ${err.message}`);
    return null;
  }
}

async function processPhoto(filename) {
  const srcPath = path.join(PHOTOS_DIR, filename);
  const stats = await stat(srcPath);
  const id = hashId(`${filename}:${stats.mtimeMs}:${stats.size}`);

  console.log(`📸 ${filename}`);

  let exif;
  try {
    exif = await exifr.parse(srcPath, true);
  } catch (err) {
    console.warn(`  ⚠ EXIF parse failed: ${err.message}`);
    exif = {};
  }
  exif = exif || {};

  // Prefer EXIF timestamp; otherwise fall back to upload time (file birthtime on local FS)
  const uploadTime = (stats.birthtime && stats.birthtime.getTime() > 0) ? stats.birthtime : stats.mtime;
  const taken = exif.DateTimeOriginal || exif.CreateDate || uploadTime;
  const takenDate = taken instanceof Date ? taken : new Date(taken);
  if (!exif.DateTimeOriginal && !exif.CreateDate) {
    console.log(`  🕒 No EXIF time → using upload time: ${takenDate.toISOString()}`);
  }

  let location = null;
  if (exif.latitude && exif.longitude) {
    console.log(`  📍 GPS: ${exif.latitude.toFixed(4)}, ${exif.longitude.toFixed(4)}`);
    const geo = await reverseGeocode(exif.latitude, exif.longitude);
    console.log(`  🗺  ${geo.place_name}${geo.city ? ', ' + geo.city : ''}`);
    location = {
      lat: Number(exif.latitude.toFixed(6)),
      lon: Number(exif.longitude.toFixed(6)),
      ...geo,
    };
  } else {
    console.log(`  ⚠ No GPS data`);
  }

  const thumbUrl = await ensureThumbnail(srcPath, id);

  return {
    id,
    filename,
    thumb: thumbUrl,
    taken_at: takenDate.toISOString(),
    time: formatTime(takenDate),
    camera: [exif.Make, exif.Model].filter(Boolean).join(' ') || null,
    lens: exif.LensModel || null,
    settings: exif.FNumber ? {
      iso: exif.ISO || null,
      f: `f/${exif.FNumber}`,
      shutter: exif.ExposureTime || null,
      focal: exif.FocalLength ? `${Math.round(exif.FocalLength)}mm` : null,
    } : null,
    location,
    _date: formatDate(takenDate), // internal only, moved up to entry level
  };
}

// ---------- Grouping into entries ----------

function groupPhotosIntoEntries(photos) {
  // Sort by time
  const sorted = [...photos].sort((a, b) => new Date(a.taken_at) - new Date(b.taken_at));
  const entries = [];

  for (const photo of sorted) {
    const last = entries[entries.length - 1];
    let grouped = false;

    if (last && last.photos.length > 0) {
      const prev = last.photos[last.photos.length - 1];
      const minutesDiff = (new Date(photo.taken_at) - new Date(prev.taken_at)) / 60000;
      const distance = haversineM(photo.location, prev.location);
      const sameDate = last.date === photo._date;

      if (sameDate && minutesDiff <= GROUP_TIME_MIN && distance <= GROUP_DIST_M) {
        last.photos.push(photo);
        grouped = true;
      }
    }

    if (!grouped) {
      entries.push({
        id: hashId(`${photo._date}:${photo.location?.lat || 0}:${photo.location?.lon || 0}:${photo.taken_at}`),
        date: photo._date,
        time: photo.time,
        location: photo.location,
        photos: [photo],
        ai_description: null,
        tags: [],
      });
    }
  }

  // Clean up internal _date field from photos
  for (const e of entries) {
    for (const p of e.photos) delete p._date;
  }
  return entries;
}

// ---------- Preserve user edits across re-runs ----------

function buildFilenameIndex(oldEntries) {
  // filename -> { entry, location, photo }
  const map = new Map();
  for (const entry of oldEntries) {
    for (const photo of entry.photos || []) {
      map.set(photo.filename, { entry, location: photo.location || entry.location, photo });
    }
  }
  return map;
}

function restoreLocationsByFilename(photos, oldEntries) {
  // If a new photo has no GPS location, inherit from previous run (manual edits survive)
  const idx = buildFilenameIndex(oldEntries);
  for (const p of photos) {
    if (!p.location && idx.has(p.filename)) {
      const prev = idx.get(p.filename).location;
      if (prev) {
        console.log(`  ↻ Restored location for ${p.filename}: ${prev.place_name}`);
        p.location = prev;
      }
    }
  }
}

function matchEntryKey(e) {
  const lat = e.location ? Math.round(e.location.lat * 1000) / 1000 : 'x';
  const lon = e.location ? Math.round(e.location.lon * 1000) / 1000 : 'x';
  return `${e.date}:${lat}:${lon}`;
}

function preserveAiContent(newEntries, oldEntries) {
  const oldMap = new Map(oldEntries.map(e => [matchEntryKey(e), e]));
  for (const entry of newEntries) {
    const prev = oldMap.get(matchEntryKey(entry));
    if (prev) {
      entry.ai_description = prev.ai_description ?? null;
      entry.tags = prev.tags?.length ? prev.tags : [];
      // Preserve custom place_name if user edited it
      if (prev.location?.place_name && entry.location) {
        entry.location.place_name = prev.location.place_name;
      }
    }
    // Cascade entry place_name down to photo-level for consistency
    if (entry.location?.place_name) {
      for (const p of entry.photos) {
        if (p.location) p.location.place_name = entry.location.place_name;
      }
    }
  }
}

// ---------- Trip grouping ----------

function groupEntriesIntoTrips(entries) {
  // Sort entries chronologically
  const sorted = [...entries].sort((a, b) =>
    new Date(a.photos[0].taken_at) - new Date(b.photos[0].taken_at));
  const trips = [];

  for (const entry of sorted) {
    const last = trips[trips.length - 1];
    const entryStart = new Date(entry.photos[0].taken_at);

    if (last) {
      const lastEntry = last.entries[last.entries.length - 1];
      const lastEnd = new Date(lastEntry.photos[lastEntry.photos.length - 1].taken_at);
      const gapDays = (entryStart - lastEnd) / (1000 * 60 * 60 * 24);
      if (gapDays < TRIP_GAP_DAYS) {
        last.entries.push(entry);
        continue;
      }
    }
    // New trip
    trips.push({ entries: [entry] });
  }

  return trips.map(t => finalizeTrip(t.entries));
}

function autoTitle(entries) {
  // Pick dominant country + year, e.g. "2025 挪威"
  const years = new Set(entries.map(e => e.date.slice(0, 4)));
  const countries = entries.map(e => e.location?.country).filter(Boolean);
  const topCountry = mostFrequent(countries) || '未知';
  const yearStr = [...years].sort().join('–');
  return `${yearStr} ${topCountry}`;
}

function mostFrequent(arr) {
  const counts = new Map();
  for (const v of arr) counts.set(v, (counts.get(v) || 0) + 1);
  let best = null, max = 0;
  for (const [k, v] of counts) if (v > max) { best = k; max = v; }
  return best;
}

function finalizeTrip(entries) {
  const dates = entries.map(e => e.date).sort();
  const title = autoTitle(entries);
  const id = hashId(`${dates[0]}:${title}`);
  return {
    id,
    title,
    subtitle: null,
    date_start: dates[0],
    date_end: dates[dates.length - 1],
    cover_photo_id: entries[0].photos[0].id,
    stats: computeStats(entries),
    entries,
  };
}

function preserveTripMeta(newTrips, oldTrips) {
  // Preserve user-edited title/subtitle/cover by date range overlap
  for (const trip of newTrips) {
    const match = oldTrips.find(o =>
      o.date_start === trip.date_start || o.id === trip.id);
    if (match) {
      trip.id = match.id; // keep stable id
      if (match.title && match.title !== autoTitle(trip.entries)) trip.title = match.title;
      if (match.subtitle) trip.subtitle = match.subtitle;
      if (match.cover_photo_id && trip.entries.some(e => e.photos.some(p => p.id === match.cover_photo_id))) {
        trip.cover_photo_id = match.cover_photo_id;
      }
    }
  }
}

// ---------- Stats ----------

function computeStats(entries) {
  const allPhotos = entries.flatMap(e => e.photos);
  if (allPhotos.length === 0) return { photos: 0, entries: 0, locations: 0, days: 0, km: 0 };

  const cities = new Set(entries.map(e => e.location?.city).filter(Boolean));
  const dates = new Set(entries.map(e => e.date));
  let km = 0;
  const geoEntries = entries.filter(e => e.location).sort((a, b) => new Date(a.photos[0].taken_at) - new Date(b.photos[0].taken_at));
  for (let i = 1; i < geoEntries.length; i++) {
    km += Math.round(haversineM(geoEntries[i-1].location, geoEntries[i].location) / 1000);
  }
  return {
    photos: allPhotos.length,
    entries: entries.length,
    locations: cities.size,
    days: dates.size,
    km,
  };
}

// ---------- Main ----------

async function loadExisting() {
  if (!existsSync(DATA_FILE)) return { trips: [], entries: [] };
  try {
    const raw = await readFile(DATA_FILE, 'utf-8');
    const data = JSON.parse(raw);
    // Gather flat entries (supports old "entries" schema or new "trips" schema)
    const flatEntries = data.trips
      ? data.trips.flatMap(t => t.entries)
      : (data.entries || (data.posts ? data.posts.map(p => ({
          id: p.id, date: p.date, time: p.time, location: p.location,
          photos: [{ id: p.id, filename: p.filename, thumb: p.thumb,
            taken_at: p.taken_at, time: p.time, camera: p.camera, lens: p.lens,
            settings: p.settings, location: p.location }],
          ai_description: p.ai_description, tags: p.tags || [],
        })) : []));
    return { trips: data.trips || [], entries: flatEntries };
  } catch {
    return { trips: [], entries: [] };
  }
}

async function main() {
  await mkdir(THUMBS_DIR, { recursive: true });
  await mkdir(path.dirname(DATA_FILE), { recursive: true });

  if (!existsSync(PHOTOS_DIR)) {
    console.error(`photos/ directory not found`);
    process.exit(1);
  }

  const files = (await readdir(PHOTOS_DIR)).filter(f => SUPPORTED.test(f));
  if (files.length === 0) {
    console.log('No photos in photos/. Drop some in and run again.');
    return;
  }

  console.log(`Processing ${files.length} photo(s)...\n`);

  const photos = [];
  for (const file of files) {
    photos.push(await processPhoto(file));
    console.log('');
  }

  const existing = await loadExisting();
  restoreLocationsByFilename(photos, existing.entries || []);
  const entries = groupPhotosIntoEntries(photos);
  preserveAiContent(entries, existing.entries || []);

  const trips = groupEntriesIntoTrips(entries);
  preserveTripMeta(trips, existing.trips || []);

  const totalStats = computeStats(entries);
  const output = {
    generated_at: new Date().toISOString(),
    stats: { ...totalStats, trips: trips.length },
    trips,
  };
  await writeFile(DATA_FILE, JSON.stringify(output, null, 2), 'utf-8');

  const needsAi = entries.filter(e => !e.ai_description).length;
  console.log(`✓ Saved ${trips.length} trip(s), ${entries.length} entries, ${totalStats.photos} photos`);
  for (const t of trips) {
    console.log(`  🧳 ${t.title}  (${t.date_start}${t.date_start !== t.date_end ? ' → ' + t.date_end : ''}) · ${t.entries.length} entries`);
  }
  if (needsAi > 0) {
    console.log(`\n⚡ ${needsAi} entry/ies need AI descriptions.`);
    console.log(`   Ask Claude: "write descriptions for photo-journey"`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
