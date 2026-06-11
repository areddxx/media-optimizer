import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'

export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']

const BASE = import.meta.env.BASE_URL
const canUseMt = () => typeof window !== 'undefined' && window.crossOriginIsolated === true

let ffmpegInstance = null
let loadPromise = null
const loadListeners = new Set()

function emitLoad(payload) {
  for (const fn of loadListeners) {
    try { fn(payload) } catch {}
  }
}

export function onEngineLoad(fn) {
  loadListeners.add(fn)
  return () => loadListeners.delete(fn)
}

export function videoEngineInfo() {
  return { multithreaded: canUseMt(), ready: !!ffmpegInstance, loading: !!loadPromise && !ffmpegInstance }
}

async function fetchWithProgress(url, mime, onBytes) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body.getReader()
  const chunks = []
  let loaded = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    onBytes?.(loaded, total)
  }
  return URL.createObjectURL(new Blob(chunks, { type: mime }))
}

export function preloadVideoEngine() {
  if (ffmpegInstance || loadPromise) return loadPromise || Promise.resolve(ffmpegInstance)

  const ff = new FFmpeg()
  const mt = canUseMt()
  const dir = mt ? 'ffmpeg-mt' : 'ffmpeg-st'
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const coreURL = `${origin}${BASE}${dir}/ffmpeg-core.js`
  const wasmURL = `${origin}${BASE}${dir}/ffmpeg-core.wasm`
  const workerURL = mt ? `${origin}${BASE}${dir}/ffmpeg-core.worker.js` : undefined

  loadPromise = (async () => {
    // Only pre-fetch the wasm (big). JS files load directly so dynamic import + worker spawn keep path context.
    const wasmBlobURL = await fetchWithProgress(wasmURL, 'application/wasm', (loaded, total) => {
      emitLoad({ phase: 'downloading', loaded, total, mt })
    })
    emitLoad({ phase: 'initializing', mt })
    const opts = { coreURL, wasmURL: wasmBlobURL }
    if (workerURL) opts.workerURL = workerURL
    await ff.load(opts)
    ffmpegInstance = ff
    emitLoad({ phase: 'ready', mt })
    return ff
  })().catch((err) => {
    loadPromise = null
    emitLoad({ phase: 'error', error: err?.message || String(err) })
    throw err
  })
  return loadPromise
}

// Parse `frame=  123 fps= 45 q=28.0 size=...  time=00:00:05.12 bitrate=... speed=1.23x`
const FRAME_RE = /frame=\s*(\d+)/
const TIME_RE = /time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/
const SPEED_RE = /speed=\s*([\d.]+)x/
const DURATION_RE = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/

export async function optimizeVideo(file, { quality, maxDim, onProgress, onStage }) {
  if (!ffmpegInstance) onStage?.(canUseMt() ? 'Loading encoder (multi-threaded)' : 'Loading encoder')
  onProgress?.(0.01)
  const ff = await preloadVideoEngine()

  const inputName = 'in' + (file.name.match(/\.[^.]+$/)?.[0] || '.mp4')
  const outputName = 'out.mp4'

  onStage?.('Reading file')
  await ff.writeFile(inputName, await fetchFile(file))

  const crf = Math.round(32 - (Number(quality) - 0.1) * (32 - 18) / 0.9)

  const args = ['-i', inputName]
  if (maxDim) {
    args.push('-vf', `scale='if(gt(iw,ih),min(${maxDim},iw),-2)':'if(gt(iw,ih),-2,min(${maxDim},ih))'`)
  }
  args.push(
    '-c:v', 'libx264',
    '-threads', '1',
    '-preset', 'veryfast',
    '-crf', String(crf),
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-progress', '-',
    '-stats_period', '0.5',
    outputName
  )

  let durationSec = 0

  const onProg = (data) => {
    const { progress } = data || {}
    if (typeof progress === 'number' && isFinite(progress) && progress > 0) {
      onProgress?.(Math.max(0.05, Math.min(0.98, progress)))
    }
  }

  const onLog = (payload) => {
    const { message } = payload || {}
    if (!message) return
    const d = DURATION_RE.exec(message)
    if (d) durationSec = (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3])
    const frame = FRAME_RE.exec(message)?.[1]
    const t = TIME_RE.exec(message)
    const speed = SPEED_RE.exec(message)?.[1]
    if (frame || t) {
      const parts = []
      if (frame) parts.push(`frame ${frame}`)
      if (t) {
        const cur = (+t[1]) * 3600 + (+t[2]) * 60 + parseFloat(t[3])
        parts.push(`time ${t[1]}:${t[2]}:${t[3].split('.')[0].padStart(2, '0')}`)
        if (durationSec) {
          const p = Math.max(0.05, Math.min(0.98, cur / durationSec))
          onProgress?.(p)
        }
      }
      if (speed) parts.push(`${speed}×`)
      onStage?.(`Transcoding · ${parts.join(' · ')}`)
    }
  }

  ff.on('progress', onProg)
  ff.on('log', onLog)

  try {
    onStage?.('Transcoding · starting…')
    await ff.exec(args)
    const data = await ff.readFile(outputName)
    await ff.deleteFile(inputName).catch(() => {})
    await ff.deleteFile(outputName).catch(() => {})
    onProgress?.(1)
    const base = file.name.replace(/\.[^.]+$/, '')
    return { blob: new Blob([data.buffer], { type: 'video/mp4' }), name: `${base}.mp4` }
  } finally {
    ff.off('progress', onProg)
    ff.off('log', onLog)
  }
}
