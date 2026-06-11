import { mkdirSync, copyFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const jobs = [
  { from: '@ffmpeg/core/dist/esm', to: 'public/ffmpeg-st' },
  { from: '@ffmpeg/core-mt/dist/esm', to: 'public/ffmpeg-mt' },
  { from: 'coi-serviceworker', to: 'public', only: ['coi-serviceworker.min.js'] },
]

for (const { from, to, only } of jobs) {
  const src = join(root, 'node_modules', from)
  const dst = join(root, to)
  if (!existsSync(src)) continue
  mkdirSync(dst, { recursive: true })
  const files = only ?? readdirSync(src).filter((f) => /\.(js|wasm)$/.test(f))
  for (const f of files) copyFileSync(join(src, f), join(dst, f))
  console.log(`copied ${files.length} files → ${to}`)
}
