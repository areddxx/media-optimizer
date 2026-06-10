import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// IMPORTANT: change this to your repo name for GitHub Pages.
// Use '/' for a user/organization site (username.github.io) or for local-only use.
export const REPO_BASE = '/image-optimizer/'

export default defineConfig({
  base: REPO_BASE,
  plugins: [react()],
})
