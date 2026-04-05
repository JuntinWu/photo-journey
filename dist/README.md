# Deploy

This folder is a self-contained static site. Deploy anywhere:

**GitHub Pages:**
  Push dist/ contents to the `gh-pages` branch, or enable Pages from
  a folder in your repo.

**Vercel / Netlify / Cloudflare Pages:**
  Point the project at this folder (or set build output to `dist`).

**Local preview:**
  cd dist && python3 -m http.server 8000
  or: npx serve .

Nothing server-side is needed — just a static host.
