import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// IMPORTANT: change this to your repo name for GitHub Pages.
// Use '/' for a user/organization site (username.github.io) or for local-only use.
export const REPO_BASE = '/image-optimizer/'

export default defineConfig({
  base: REPO_BASE,
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', 'heic2any', 'pdfjs-dist'],
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  },
})
