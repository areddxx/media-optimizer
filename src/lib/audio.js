import { fetchFile } from '@ffmpeg/util'
import { preloadVideoEngine } from './video.js'

export const AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/x-flac']
export const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac']

const TIME_RE = /time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/
const DURATION_RE = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/

const codecFor = {
  mp3: { codec: 'libmp3lame', ext: 'mp3' },
  opus: { codec: 'libopus', ext: 'opus' },
  aac: { codec: 'aac', ext: 'm4a' },
}

export async function optimizeAudio(file, { format = 'mp3', bitrate = '128k', onProgress, onStage }) {
  if (!preloadVideoEngine) throw new Error('encoder unavailable')
  onStage?.('Loading encoder')
  onProgress?.(0.01)
  const ff = await preloadVideoEngine()

  const { codec, ext } = codecFor[format] || codecFor.mp3
  const inputName = 'in' + (file.name.match(/\.[^.]+$/)?.[0] || '.bin')
  const outputName = `out.${ext}`

  onStage?.('Reading file')
  await ff.writeFile(inputName, await fetchFile(file))

  let durationSec = 0
  const onLog = ({ message }) => {
    if (!message) return
    const d = DURATION_RE.exec(message)
    if (d) durationSec = (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3])
    const t = TIME_RE.exec(message)
    if (t && durationSec) {
      const cur = (+t[1]) * 3600 + (+t[2]) * 60 + parseFloat(t[3])
      onProgress?.(Math.max(0.05, Math.min(0.98, cur / durationSec)))
      onStage?.(`Transcoding · ${t[1]}:${t[2]}:${t[3].split('.')[0].padStart(2, '0')}`)
    }
  }
  ff.on('log', onLog)

  try {
    onStage?.('Transcoding · starting…')
    await ff.exec([
      '-i', inputName,
      '-vn',
      '-c:a', codec,
      '-b:a', bitrate,
      '-progress', '-',
      '-stats_period', '0.5',
      outputName,
    ])
    const data = await ff.readFile(outputName)
    await ff.deleteFile(inputName).catch(() => {})
    await ff.deleteFile(outputName).catch(() => {})
    onProgress?.(1)
    const base = file.name.replace(/\.[^.]+$/, '')
    const mime = format === 'mp3' ? 'audio/mpeg' : format === 'opus' ? 'audio/ogg' : 'audio/mp4'
    return { blob: new Blob([data.buffer], { type: mime }), name: `${base}.${ext}` }
  } finally {
    ff.off('log', onLog)
  }
}
