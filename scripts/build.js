#!/usr/bin/env node
/**
 * Photo Journey — Static Site Builder
 *
 * Copies all required files into dist/ so you can deploy to
 * GitHub Pages / Vercel / Netlify / Cloudflare Pages / anywhere static.
 *
 * Usage:
 *   npm run build
 */

import { mkdir, copyFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

async function copyDir(src, dest) {
  if (!existsSync(src)) return;
  await mkdir(dest, { recursive: true });
  for (const name of await readdir(src)) {
    if (name.startsWith('.')) continue;
    const s = path.join(src, name);
    const d = path.join(dest, name);
    const st = await stat(s);
    if (st.isDirectory()) {
      await copyDir(s, d);
    } else {
      await copyFile(s, d);
    }
  }
}

async function main() {
  console.log('🔨 Building static site...\n');

  // Clean & create dist
  if (existsSync(DIST)) await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  // Required static assets
  await copyFile(path.join(ROOT, 'index.html'), path.join(DIST, 'index.html'));
  console.log('✓ index.html');

  await copyDir(path.join(ROOT, 'data'), path.join(DIST, 'data'));
  console.log('✓ data/');

  await copyDir(path.join(ROOT, 'public'), path.join(DIST, 'public'));
  console.log('✓ public/ (thumbnails)');

  // Add a .nojekyll for GitHub Pages (prevents underscore prefix issues)
  await writeFile(path.join(DIST, '.nojekyll'), '', 'utf-8');

  // Deploy helper docs
  const readme = `# Deploy

This folder is a self-contained static site. Deploy anywhere:

**GitHub Pages:**
  Push dist/ contents to the \`gh-pages\` branch, or enable Pages from
  a folder in your repo.

**Vercel / Netlify / Cloudflare Pages:**
  Point the project at this folder (or set build output to \`dist\`).

**Local preview:**
  cd dist && python3 -m http.server 8000
  or: npx serve .

Nothing server-side is needed — just a static host.
`;
  await writeFile(path.join(DIST, 'README.md'), readme, 'utf-8');

  // Size report
  async function sizeOf(dir) {
    let total = 0, files = 0;
    async function walk(d) {
      for (const name of await readdir(d)) {
        const p = path.join(d, name);
        const st = await stat(p);
        if (st.isDirectory()) await walk(p);
        else { total += st.size; files++; }
      }
    }
    await walk(dir);
    return { total, files };
  }
  const { total, files } = await sizeOf(DIST);
  const mb = (total / 1024 / 1024).toFixed(2);

  console.log(`\n✓ dist/ ready — ${files} files, ${mb} MB`);
  console.log(`\nDeploy with:`);
  console.log(`  npx vercel --prod ${path.relative(process.cwd(), DIST)}`);
  console.log(`  or push dist/ to your gh-pages branch`);
}

main().catch(err => { console.error('Build failed:', err); process.exit(1); });
