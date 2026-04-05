// Create sample photos with embedded EXIF GPS for testing
import sharp from 'sharp';
import piexif from 'piexifjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PHOTOS = path.resolve(__dirname, '../photos');

// GPS helper for piexif
function toDMS(deg) {
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const s = ((abs - d - m/60) * 3600);
  return [[d,1], [m,1], [Math.round(s*100),100]];
}

const samples = [
  { name: '01-kinkakuji.jpg',   lat: 35.0394, lon: 135.7292, dt: '2026:04:02 09:23:45', color: '#d4b87a' },
  { name: '02-arashiyama.jpg',  lat: 35.0173, lon: 135.6711, dt: '2026:04:02 14:15:10', color: '#5a7c5f' },
  { name: '03-dotonbori.jpg',   lat: 34.6687, lon: 135.5013, dt: '2026:04:03 12:40:22', color: '#c4554d' },
  { name: '04-nara-park.jpg',   lat: 34.6851, lon: 135.8430, dt: '2026:04:04 10:05:33', color: '#8a9a7b' },
];

async function makeSample(s) {
  // Create a simple gradient image
  const jpeg = await sharp({
    create: { width: 2400, height: 1600, channels: 3, background: s.color }
  }).jpeg({ quality: 85 }).toBuffer();

  // Inject EXIF with GPS
  const exifObj = {
    '0th': {
      [piexif.ImageIFD.Make]: 'Apple',
      [piexif.ImageIFD.Model]: 'iPhone 15 Pro',
      [piexif.ImageIFD.DateTime]: s.dt,
    },
    'Exif': {
      [piexif.ExifIFD.DateTimeOriginal]: s.dt,
      [piexif.ExifIFD.DateTimeDigitized]: s.dt,
      [piexif.ExifIFD.FNumber]: [18,10],
      [piexif.ExifIFD.ISOSpeedRatings]: 100,
      [piexif.ExifIFD.FocalLength]: [24,1],
      [piexif.ExifIFD.ExposureTime]: [1,250],
    },
    'GPS': {
      [piexif.GPSIFD.GPSLatitudeRef]: s.lat >= 0 ? 'N' : 'S',
      [piexif.GPSIFD.GPSLatitude]: toDMS(s.lat),
      [piexif.GPSIFD.GPSLongitudeRef]: s.lon >= 0 ? 'E' : 'W',
      [piexif.GPSIFD.GPSLongitude]: toDMS(s.lon),
    },
    '1st': {},
    'thumbnail': null,
  };

  const exifBytes = piexif.dump(exifObj);
  const jpegDataUrl = 'data:image/jpeg;base64,' + jpeg.toString('base64');
  const newDataUrl = piexif.insert(exifBytes, jpegDataUrl);
  const b64 = newDataUrl.replace('data:image/jpeg;base64,', '');
  const out = Buffer.from(b64, 'base64');

  const outPath = path.join(PHOTOS, s.name);
  await writeFile(outPath, out);
  console.log(`  ✓ ${s.name}`);
}

console.log('Creating sample photos with EXIF/GPS...\n');
for (const s of samples) await makeSample(s);
console.log('\nDone. Now run: npm run process');
