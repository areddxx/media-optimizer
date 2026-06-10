# Image Optimizer

A 100% client-side image optimizer. Nothing is uploaded — all processing runs in your browser using the Canvas API.

## Features

- Drag-and-drop multi-file input with per-file before/after size and % saved
- JPG / PNG / WebP input, with configurable output format
- Quality slider (JPEG/WebP) and optional max-dimension resize
- Per-file progress, individual downloads, and batch `.zip` (via fflate)
- No service worker, no special headers — works on plain static hosting like GitHub Pages

## Local development

```bash
npm install
npm run dev
```

## Deploying to GitHub Pages

1. Open `vite.config.js` and set `REPO_BASE` to your repo path, e.g.:
   ```js
   export const REPO_BASE = '/your-repo-name/'
   ```
   (Use `'/'` for user/org sites like `username.github.io`.)
2. Commit and push to `main`.
3. In the GitHub repo settings → **Pages**, set **Source** to **GitHub Actions**.
4. The included workflow at `.github/workflows/deploy.yml` builds and deploys automatically on each push to `main`.

Your site will be live at `https://<user>.github.io/<repo-name>/`.

## Notes

Images are re-encoded through `<canvas>`, which strips EXIF/metadata implicitly.
