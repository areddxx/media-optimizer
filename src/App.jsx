import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { zipSync } from 'fflate'
import {
  ImageDown, Upload, FileImage, FileText, FileVideo, FileAudio,
  Download, X, Play, Trash2, Archive, Eye, GripVertical, Palette, Crop,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { optimizeImage, IMAGE_TYPES, supportsAvifEncode, decodeHeic, isHeic } from './lib/image.js'
import { optimizePdf } from './lib/pdf.js'
import { optimizeVideo, VIDEO_TYPES, videoEngineInfo, preloadVideoEngine, onEngineLoad } from './lib/video.js'
import { optimizeAudio, AUDIO_TYPES, AUDIO_EXTS } from './lib/audio.js'
import { usePersistedState } from './lib/usePersistedState.js'

const fmtBytes = (n) => {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

const IMG_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'heic', 'heif']
const isImage = (f) =>
  IMAGE_TYPES.some((t) => f.type === t) || IMG_EXTS.some((ext) => f.name.toLowerCase().endsWith('.' + ext))
const isPdf = (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
const VIDEO_EXTS = ['mp4', 'mov', 'webm', 'm4v', 'gif']
const isVideo = (f) =>
  VIDEO_TYPES.includes(f.type) || f.type === 'image/gif' ||
  VIDEO_EXTS.some((ext) => f.name.toLowerCase().endsWith('.' + ext))
const isAudio = (f) =>
  AUDIO_TYPES.includes(f.type) || AUDIO_EXTS.some((ext) => f.name.toLowerCase().endsWith('.' + ext))

let idSeq = 1

function FieldLabel({ children, hint }) {
  return (
    <div className="flex items-baseline justify-between mb-1.5">
      <label className="text-sm font-medium text-foreground">{children}</label>
      {hint != null && <span className="text-xs text-muted-foreground tabular-nums">{hint}</span>}
    </div>
  )
}

function Card({ className, ...props }) {
  return <div className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)} {...props} />
}

const THEMES = [
  { id: 'palenight',       name: 'Material Palenight', bg: '#292D3E', primary: '#82AAFF' },
  { id: 'dracula',         name: 'Dracula',            bg: '#282A36', primary: '#BD93F9' },
  { id: 'onedark',         name: 'One Dark Pro',       bg: '#282C34', primary: '#61AFEF' },
  { id: 'tokyonight',      name: 'Tokyo Night',        bg: '#1A1B26', primary: '#7AA2F7' },
  { id: 'nord',            name: 'Nord',               bg: '#2E3440', primary: '#88C0D0' },
  { id: 'github-light',    name: 'GitHub Light',       bg: '#FFFFFF', primary: '#0969DA' },
  { id: 'solarized-light', name: 'Solarized Light',    bg: '#FDF6E3', primary: '#268BD2' },
]
const THEME_CLASSES = THEMES.map((t) => 'theme-' + t.id)
const VALID_THEME_IDS = new Set(THEMES.map((t) => t.id))

function ThemeSelector() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'palenight'
    const saved = localStorage.getItem('theme')
    return saved && VALID_THEME_IDS.has(saved) ? saved : 'palenight'
  })
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    const html = document.documentElement
    THEME_CLASSES.forEach((c) => html.classList.remove(c))
    html.classList.remove('light', 'dark')
    html.classList.add('theme-' + theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <Button size="icon" variant="ghost" onClick={() => setOpen((o) => !o)} aria-label="Theme">
        <Palette className="h-4 w-4" />
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 bg-card border rounded-md shadow-lg py-1 min-w-[12rem]" style={{ backgroundColor: 'hsl(var(--card))' }}>
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { setTheme(t.id); setOpen(false) }}
              className={cn(
                'flex w-full items-center gap-2.5 px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors',
                theme === t.id && 'bg-accent/60 font-medium'
              )}
            >
              <span className="flex-1 truncate">{t.name}</span>
              {theme === t.id && <span className="text-primary text-xs">●</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CropModal({ open, onClose, item, onApply }) {
  const [url, setUrl] = useState(null)
  const [natural, setNatural] = useState(null) // { w, h }
  const [loading, setLoading] = useState(false)
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 })
  const [rect, setRect] = useState(null) // in natural pixel coords {x,y,w,h}
  const [drawing, setDrawing] = useState(null) // {startX,startY} in display coords
  const imgRef = useRef(null)
  const stageRef = useRef(null)

  useEffect(() => {
    if (!open || !item) return
    let cancelled = false
    let objectUrl
    setRect(item.cropRect || null)
    setDrawing(null)
    ;(async () => {
      let blob = item.file
      if (isHeic(item.file)) {
        setLoading(true)
        try { blob = await decodeHeic(item.file) } catch {/* keep raw */}
        if (cancelled) return
        setLoading(false)
      }
      objectUrl = URL.createObjectURL(blob)
      if (cancelled) { URL.revokeObjectURL(objectUrl); return }
      setUrl(objectUrl)
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setUrl(null); setNatural(null); setDisplaySize({ w: 0, h: 0 })
    }
  }, [open, item])

  const onImgLoad = () => {
    const img = imgRef.current
    if (!img) return
    setNatural({ w: img.naturalWidth, h: img.naturalHeight })
    setDisplaySize({ w: img.clientWidth, h: img.clientHeight })
  }

  useEffect(() => {
    if (!open) return
    const onResize = () => {
      const img = imgRef.current
      if (img) setDisplaySize({ w: img.clientWidth, h: img.clientHeight })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open])

  const scale = natural && displaySize.w ? displaySize.w / natural.w : 1

  const toNatural = (px, py) => ({
    x: Math.max(0, Math.min(natural.w, px / scale)),
    y: Math.max(0, Math.min(natural.h, py / scale)),
  })

  const handleDown = (e) => {
    if (!natural || !stageRef.current) return
    const r = stageRef.current.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    setDrawing({ startX: x, startY: y })
    const n = toNatural(x, y)
    setRect({ x: n.x, y: n.y, w: 0, h: 0 })
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const handleMove = (e) => {
    if (!drawing || !natural || !stageRef.current) return
    const r = stageRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(displaySize.w, e.clientX - r.left))
    const y = Math.max(0, Math.min(displaySize.h, e.clientY - r.top))
    const a = toNatural(Math.min(drawing.startX, x), Math.min(drawing.startY, y))
    const b = toNatural(Math.max(drawing.startX, x), Math.max(drawing.startY, y))
    setRect({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y })
  }
  const handleUp = () => setDrawing(null)

  const apply = () => {
    if (!rect || rect.w < 2 || rect.h < 2) { onApply(null); onClose(); return }
    onApply({
      x: Math.round(rect.x), y: Math.round(rect.y),
      w: Math.round(rect.w), h: Math.round(rect.h),
    })
    onClose()
  }
  const reset = () => setRect(null)

  if (!open || !item) return null
  const dispRect = rect && scale ? {
    left: rect.x * scale,
    top: rect.y * scale,
    width: rect.w * scale,
    height: rect.h * scale,
  } : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-card border rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <div className="text-sm font-semibold truncate">Crop · {item.name}</div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {natural ? `${natural.w} × ${natural.h}` : '—'}
              {rect && rect.w >= 1 && rect.h >= 1 && (
                <span className="ml-2">→ {Math.round(rect.w)} × {Math.round(rect.h)}</span>
              )}
            </div>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="p-5">
          <div className="rounded-md border bg-muted/30 overflow-hidden flex items-center justify-center min-h-[200px]">
            {loading ? (
              <div className="text-xs text-muted-foreground p-6">Decoding HEIC…</div>
            ) : url ? (
              <div
                ref={stageRef}
                className="relative inline-block select-none touch-none cursor-crosshair"
                style={{ maxWidth: '100%', maxHeight: '70vh' }}
                onPointerDown={handleDown}
                onPointerMove={handleMove}
                onPointerUp={handleUp}
                onPointerCancel={handleUp}
              >
                <img
                  ref={imgRef}
                  src={url}
                  alt="crop"
                  onLoad={onImgLoad}
                  draggable={false}
                  className="block max-w-full max-h-[70vh] w-auto h-auto pointer-events-none"
                />
                {dispRect && (
                  <>
                    <div className="absolute inset-0 pointer-events-none" style={{
                      boxShadow: `0 0 0 9999px rgba(0,0,0,0.5)`,
                      clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${dispRect.top}px, ${dispRect.left}px ${dispRect.top}px, ${dispRect.left}px ${dispRect.top + dispRect.height}px, ${dispRect.left + dispRect.width}px ${dispRect.top + dispRect.height}px, ${dispRect.left + dispRect.width}px ${dispRect.top}px, 0 ${dispRect.top}px)`,
                    }} />
                    <div
                      className="absolute border-2 border-primary pointer-events-none"
                      style={{
                        left: dispRect.left, top: dispRect.top,
                        width: dispRect.width, height: dispRect.height,
                      }}
                    />
                  </>
                )}
              </div>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Click and drag on the image to draw the crop region. Leave empty to clear.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <Button variant="ghost" onClick={reset} disabled={!rect}>Reset</Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={apply}>Apply crop</Button>
        </div>
      </div>
    </div>
  )
}

function ImagePreviewModal({ open, onClose, item }) {
  const [origUrl, setOrigUrl] = useState(null)
  const [outUrl, setOutUrl] = useState(null)
  const [origLoading, setOrigLoading] = useState(false)

  useEffect(() => {
    if (!open || !item) return
    let cancelled = false
    let u1, u2
    ;(async () => {
      let origBlob = item.file
      if (isHeic(item.file)) {
        setOrigLoading(true)
        try {
          origBlob = await decodeHeic(item.file)
        } catch {/* fall through with raw file */}
        if (cancelled) return
        setOrigLoading(false)
      }
      u1 = URL.createObjectURL(origBlob)
      u2 = item.outBlob ? URL.createObjectURL(item.outBlob) : null
      if (cancelled) {
        URL.revokeObjectURL(u1); if (u2) URL.revokeObjectURL(u2)
        return
      }
      setOrigUrl(u1); setOutUrl(u2)
    })()
    return () => {
      cancelled = true
      if (u1) URL.revokeObjectURL(u1)
      if (u2) URL.revokeObjectURL(u2)
      setOrigUrl(null); setOutUrl(null)
    }
  }, [open, item])

  if (!open || !item) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-card border rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <div className="text-sm font-semibold truncate">{item.name}</div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {fmtBytes(item.origSize)} → {fmtBytes(item.outSize)}
              {item.origSize && item.outSize && (
                <span className="ml-2 text-success font-medium">
                  −{Math.round((1 - item.outSize / item.origSize) * 100)}%
                </span>
              )}
            </div>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="grid md:grid-cols-2 gap-4 p-5">
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2">Original</div>
            <div className="rounded-md border bg-muted/30 overflow-hidden min-h-[200px] flex items-center justify-center">
              {origLoading ? (
                <div className="text-xs text-muted-foreground p-6">Decoding HEIC…</div>
              ) : origUrl ? (
                <img src={origUrl} alt="original" className="w-full h-auto object-contain max-h-[60vh] mx-auto" />
              ) : null}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2">Optimized</div>
            <div className="rounded-md border bg-muted/30 overflow-hidden">
              {outUrl && <img src={outUrl} alt="optimized" className="w-full h-auto object-contain max-h-[60vh] mx-auto" />}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [items, setItems] = useState([])
  const [drag, setDrag] = useState(false)

  const [imgFormat, setImgFormat] = usePersistedState('imgFormat', 'image/webp')
  const [imgQuality, setImgQuality] = usePersistedState('imgQuality', 0.8)
  const [imgMaxDim, setImgMaxDim] = usePersistedState('imgMaxDim', '')
  const [imgTargetMode, setImgTargetMode] = usePersistedState('imgTargetMode', false)
  const [imgTargetKb, setImgTargetKb] = usePersistedState('imgTargetKb', '500')

  const [pdfFormat, setPdfFormat] = usePersistedState('pdfFormat', 'image/jpeg')
  const [pdfQuality, setPdfQuality] = usePersistedState('pdfQuality', 0.7)
  const [pdfMaxDim, setPdfMaxDim] = usePersistedState('pdfMaxDim', '')

  const [videoQuality, setVideoQuality] = usePersistedState('videoQuality', 0.6)
  const [videoScale, setVideoScale] = usePersistedState('videoScale', 'none')
  const [videoCustomDim, setVideoCustomDim] = usePersistedState('videoCustomDim', '')

  const [audioFormat, setAudioFormat] = usePersistedState('audioFormat', 'mp3')
  const [audioBitrate, setAudioBitrate] = usePersistedState('audioBitrate', '128k')

  const [busy, setBusy] = useState(false)
  const [engine, setEngine] = useState(() => ({ phase: 'idle', loaded: 0, total: 0, mt: false }))
  const [avifOk, setAvifOk] = useState(false)
  const [previewItem, setPreviewItem] = useState(null)
  const [cropItem, setCropItem] = useState(null)
  const [dragId, setDragId] = useState(null)
  const inputRef = useRef(null)

  useEffect(() => onEngineLoad((p) => setEngine((prev) => ({ ...prev, ...p }))), [])
  useEffect(() => { supportsAvifEncode().then(setAvifOk) }, [])
  useEffect(() => {
    if (imgFormat === 'image/avif' && avifOk === false) setImgFormat('image/webp')
  }, [imgFormat, avifOk, setImgFormat])

  const addFiles = useCallback((files) => {
    const next = Array.from(files).map((f) => ({
      id: idSeq++,
      file: f,
      name: f.name,
      origSize: f.size,
      kind: isImage(f) ? 'image' : isPdf(f) ? 'pdf' : isVideo(f) ? 'video' : isAudio(f) ? 'audio' : 'other',
      stage: null,
      status: 'queued',
      progress: 0,
      outBlob: null,
      outSize: null,
      outName: null,
      error: null,
      cropRect: null,
    }))
    setItems((p) => [...p, ...next])
    if (next.some((it) => it.kind === 'video' || it.kind === 'audio')) preloadVideoEngine().catch(() => {})
  }, [])

  const onDrop = (e) => {
    e.preventDefault()
    setDrag(false)
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
  }

  const update = (id, patch) => setItems((p) => p.map((it) => (it.id === id ? { ...it, ...patch } : it)))

  const runOne = async (it) => {
    if (!['image', 'pdf', 'video', 'audio'].includes(it.kind)) {
      update(it.id, { status: 'error', error: 'Unsupported file type' })
      return
    }
    update(it.id, { status: 'processing', progress: 0, error: null, stage: null })
    try {
      const onProgress = (p) => update(it.id, { progress: p })
      const onStage = (s) => update(it.id, { stage: s })
      let result
      if (it.kind === 'image') {
        result = await optimizeImage(it.file, {
          format: imgFormat,
          quality: Number(imgQuality),
          maxDim: imgMaxDim ? Number(imgMaxDim) : null,
          targetBytes: imgTargetMode && imgTargetKb ? Number(imgTargetKb) * 1024 : null,
          crop: it.cropRect,
          onProgress,
        })
      } else if (it.kind === 'pdf') {
        result = await optimizePdf(it.file, {
          format: pdfFormat,
          quality: Number(pdfQuality),
          maxDim: pdfMaxDim ? Number(pdfMaxDim) : null,
          onProgress,
        })
      } else if (it.kind === 'video') {
        const maxDim =
          videoScale === '720' ? 1280
            : videoScale === '1080' ? 1920
            : videoScale === 'custom' && videoCustomDim ? Number(videoCustomDim)
            : null
        result = await optimizeVideo(it.file, { quality: Number(videoQuality), maxDim, onProgress, onStage })
      } else {
        result = await optimizeAudio(it.file, { format: audioFormat, bitrate: audioBitrate, onProgress, onStage })
      }
      update(it.id, { status: 'done', outBlob: result.blob, outSize: result.blob.size, outName: result.name, progress: 1, stage: null })
    } catch (err) {
      update(it.id, { status: 'error', error: err?.message || String(err) })
    }
  }

  const runAll = async () => {
    setBusy(true)
    for (const it of items) {
      if (it.status === 'done' || it.status === 'processing') continue
      // eslint-disable-next-line no-await-in-loop
      await runOne(it)
    }
    setBusy(false)
  }

  const removeOne = (id) => setItems((p) => p.filter((it) => it.id !== id))
  const clearAll = () => setItems([])

  const downloadOne = (it) => {
    if (!it.outBlob) return
    const url = URL.createObjectURL(it.outBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = it.outName || it.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const downloadZip = async () => {
    const done = items.filter((i) => i.status === 'done' && i.outBlob)
    if (!done.length) return
    const entries = {}
    for (const it of done) {
      const buf = new Uint8Array(await it.outBlob.arrayBuffer())
      entries[it.outName || it.name] = buf
    }
    const zipped = zipSync(entries, { level: 0 })
    const blob = new Blob([zipped], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'optimized.zip'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const onRowDragStart = (id) => setDragId(id)
  const onRowDragOver = (e, overId) => {
    e.preventDefault()
    if (dragId == null || dragId === overId) return
    setItems((p) => {
      const from = p.findIndex((x) => x.id === dragId)
      const to = p.findIndex((x) => x.id === overId)
      if (from < 0 || to < 0) return p
      const next = p.slice()
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }
  const onRowDragEnd = () => setDragId(null)

  const totals = useMemo(() => {
    let orig = 0, out = 0, done = 0
    for (const it of items) {
      orig += it.origSize || 0
      if (it.status === 'done') {
        out += it.outSize || 0
        done++
      }
    }
    return { orig, out, done, count: items.length, saved: orig && out ? orig - out : 0 }
  }, [items])

  const hasImages = items.some((i) => i.kind === 'image')
  const hasPdfs = items.some((i) => i.kind === 'pdf')
  const hasVideos = items.some((i) => i.kind === 'video')
  const hasAudios = items.some((i) => i.kind === 'audio')

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2">
            <ImageDown className="h-5 w-5 text-primary" />
            <span className="font-semibold">Media Optimizer</span>
            <span className="text-xs text-muted-foreground hidden sm:inline">
              Images · PDFs · Video · Audio — all in your browser
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 text-success px-2.5 py-1 text-xs font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              100% client-side
            </span>
            <ThemeSelector />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8 space-y-6">
        <div
          className={cn(
            'group relative flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed px-8 py-16 transition-colors cursor-pointer',
            drag ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-accent/30'
          )}
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <div className="rounded-full bg-secondary p-4">
            <Upload className="h-8 w-8 text-primary" />
          </div>
          <div className="text-center max-w-md">
            <p className="text-lg font-semibold">Drop files here</p>
            <p className="text-sm text-muted-foreground mt-1">
              JPG, PNG, WebP, AVIF, HEIC, PDF, MP4 / MOV / WebM / GIF, MP3 / WAV / FLAC. Files never leave your device.
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,application/pdf,.pdf,video/*,audio/*,.heic,.heif,.gif,.mp4,.mov,.webm,.m4v,.mp3,.wav,.m4a,.flac,.aac,.ogg,.opus"
            className="hidden"
            onChange={(e) => { if (e.target.files) { addFiles(e.target.files); e.target.value = '' } }}
          />
        </div>

        {(hasImages || hasPdfs || hasVideos || hasAudios) && (
          <div className="grid gap-4 md:grid-cols-2">
            {hasImages && (
              <Card className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <FileImage className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">Image options</h3>
                </div>
                <div className="space-y-4">
                  <div>
                    <FieldLabel>Output format</FieldLabel>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={imgFormat}
                      onChange={(e) => setImgFormat(e.target.value)}
                    >
                      <option value="image/webp">WebP</option>
                      <option value="image/jpeg">JPEG</option>
                      <option value="image/png">PNG (lossless)</option>
                      {avifOk && <option value="image/avif">AVIF (smallest)</option>}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      id="target-mode"
                      type="checkbox"
                      checked={imgTargetMode}
                      disabled={imgFormat === 'image/png'}
                      onChange={(e) => setImgTargetMode(e.target.checked)}
                      className="h-4 w-4 accent-primary"
                    />
                    <label htmlFor="target-mode" className="text-sm">Target file size</label>
                  </div>
                  {imgTargetMode && imgFormat !== 'image/png' ? (
                    <div>
                      <FieldLabel hint="KB">Max output size</FieldLabel>
                      <input
                        type="number" min="1" value={imgTargetKb}
                        onChange={(e) => setImgTargetKb(e.target.value)}
                        placeholder="e.g. 500"
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </div>
                  ) : (
                    <div>
                      <FieldLabel hint={imgFormat === 'image/png' ? 'n/a' : imgQuality.toFixed(2)}>Quality</FieldLabel>
                      <input
                        type="range" min="0.1" max="1" step="0.05"
                        value={imgQuality}
                        disabled={imgFormat === 'image/png'}
                        onChange={(e) => setImgQuality(Number(e.target.value))}
                        className="w-full accent-primary disabled:opacity-50"
                      />
                    </div>
                  )}
                  <div>
                    <FieldLabel>Max dimension (px, optional)</FieldLabel>
                    <input
                      type="number" min="1" value={imgMaxDim}
                      onChange={(e) => setImgMaxDim(e.target.value)}
                      placeholder="e.g. 2000"
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                </div>
              </Card>
            )}

            {hasPdfs && (
              <Card className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <FileText className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">PDF options</h3>
                </div>
                <div className="space-y-4">
                  <div>
                    <FieldLabel>Page image format</FieldLabel>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={pdfFormat}
                      onChange={(e) => setPdfFormat(e.target.value)}
                    >
                      <option value="image/jpeg">JPEG (smallest)</option>
                      <option value="image/png">PNG (lossless)</option>
                    </select>
                  </div>
                  <div>
                    <FieldLabel hint={pdfFormat === 'image/png' ? 'n/a' : pdfQuality.toFixed(2)}>Quality</FieldLabel>
                    <input
                      type="range" min="0.1" max="1" step="0.05"
                      value={pdfQuality}
                      disabled={pdfFormat === 'image/png'}
                      onChange={(e) => setPdfQuality(Number(e.target.value))}
                      className="w-full accent-primary disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <FieldLabel>Max dimension (px, optional)</FieldLabel>
                    <input
                      type="number" min="1" value={pdfMaxDim}
                      onChange={(e) => setPdfMaxDim(e.target.value)}
                      placeholder="e.g. 2000"
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Pages rasterized at ~2× (or capped by max dimension). Text becomes non-selectable.
                  </p>
                </div>
              </Card>
            )}

            {hasVideos && (
              <Card className="p-5 md:col-span-2">
                <div className="flex items-center gap-2 mb-4">
                  <FileVideo className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">Video options</h3>
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <FieldLabel hint={videoQuality.toFixed(2)}>Quality (lower = smaller file)</FieldLabel>
                      <input
                        type="range" min="0.1" max="1" step="0.05"
                        value={videoQuality}
                        onChange={(e) => setVideoQuality(Number(e.target.value))}
                        className="w-full accent-primary"
                      />
                    </div>
                    <div>
                      <FieldLabel>Resolution</FieldLabel>
                      <select
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={videoScale}
                        onChange={(e) => setVideoScale(e.target.value)}
                      >
                        <option value="none">Keep original</option>
                        <option value="1080">1080p</option>
                        <option value="720">720p</option>
                        <option value="custom">Custom max dimension…</option>
                      </select>
                    </div>
                  </div>
                  {videoScale === 'custom' && (
                    <div>
                      <FieldLabel>Max dimension (px)</FieldLabel>
                      <input
                        type="number" min="1"
                        value={videoCustomDim}
                        onChange={(e) => setVideoCustomDim(e.target.value)}
                        placeholder="e.g. 1440"
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    H.264 + AAC, web-optimized.{' '}
                    {videoEngineInfo().multithreaded
                      ? 'Multi-threaded encoder.'
                      : 'Single-threaded encoder — reload to unlock MT.'}
                    {' '}GIFs are converted to MP4.
                  </p>
                </div>
              </Card>
            )}

            {hasAudios && (
              <Card className="p-5 md:col-span-2">
                <div className="flex items-center gap-2 mb-4">
                  <FileAudio className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">Audio options</h3>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FieldLabel>Codec</FieldLabel>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={audioFormat}
                      onChange={(e) => setAudioFormat(e.target.value)}
                    >
                      <option value="mp3">MP3 (universal)</option>
                      <option value="opus">Opus (smaller)</option>
                      <option value="aac">AAC (M4A)</option>
                    </select>
                  </div>
                  <div>
                    <FieldLabel>Bitrate</FieldLabel>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={audioBitrate}
                      onChange={(e) => setAudioBitrate(e.target.value)}
                    >
                      <option value="64k">64 kbps</option>
                      <option value="96k">96 kbps</option>
                      <option value="128k">128 kbps</option>
                      <option value="192k">192 kbps</option>
                      <option value="256k">256 kbps</option>
                      <option value="320k">320 kbps</option>
                    </select>
                  </div>
                </div>
              </Card>
            )}
          </div>
        )}

        {(hasVideos || hasAudios) && (engine.phase === 'downloading' || engine.phase === 'initializing') && (
          <Card className="p-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <div>
                <div className="font-medium">
                  {engine.phase === 'initializing' ? 'Initializing encoder…' : 'Downloading encoder'}
                  {engine.mt ? ' (multi-threaded)' : ''}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {engine.phase === 'downloading' && engine.total
                    ? `${fmtBytes(engine.loaded)} / ${fmtBytes(engine.total)}`
                    : engine.phase === 'downloading'
                      ? fmtBytes(engine.loaded)
                      : 'One-time setup — cached for future runs.'}
                </div>
              </div>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-[width] duration-150"
                style={{
                  width:
                    engine.phase === 'initializing'
                      ? '100%'
                      : `${engine.total ? Math.round((engine.loaded / engine.total) * 100) : 5}%`,
                }}
              />
            </div>
          </Card>
        )}

        {items.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={runAll} disabled={busy || !items.length}>
              <Play className="h-4 w-4" />
              {busy ? 'Processing…' : 'Optimize all'}
            </Button>
            <Button variant="outline" onClick={downloadZip} disabled={!items.some((i) => i.status === 'done')}>
              <Archive className="h-4 w-4" />
              Download .zip
            </Button>
            <Button variant="ghost" onClick={clearAll} disabled={!items.length || busy}>
              <Trash2 className="h-4 w-4" />
              Clear
            </Button>
            <div className="ml-auto text-sm text-muted-foreground tabular-nums">
              {totals.done}/{totals.count} done · saved {fmtBytes(totals.saved)}
              {totals.orig && totals.out ? ` (${Math.round((totals.saved / totals.orig) * 100)}%)` : ''}
            </div>
          </div>
        )}

        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((it) => {
              const pct = it.origSize && it.outSize ? Math.round((1 - it.outSize / it.origSize) * 100) : null
              const Icon = it.kind === 'pdf' ? FileText
                : it.kind === 'video' ? FileVideo
                : it.kind === 'audio' ? FileAudio
                : FileImage
              const canPreview = it.kind === 'image' && it.status === 'done'
              const canCrop = it.kind === 'image' && it.status !== 'processing'
              return (
                <Card
                  key={it.id}
                  className={cn('p-4 transition-opacity', dragId === it.id && 'opacity-50')}
                  draggable={!busy && it.status !== 'processing'}
                  onDragStart={() => onRowDragStart(it.id)}
                  onDragOver={(e) => onRowDragOver(e, it.id)}
                  onDragEnd={onRowDragEnd}
                >
                  <div className="flex items-center gap-3">
                    <GripVertical className="h-4 w-4 text-muted-foreground/60 shrink-0 cursor-grab" />
                    <div className="rounded-md bg-secondary p-2 shrink-0">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{it.name}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {fmtBytes(it.origSize)}
                        {it.outSize != null && (
                          <>
                            {' → '}{fmtBytes(it.outSize)}
                            {pct != null && (
                              <span className={cn('ml-1.5 font-medium', pct >= 0 ? 'text-success' : 'text-warning')}>
                                ({pct >= 0 ? '−' : '+'}{Math.abs(pct)}%)
                              </span>
                            )}
                          </>
                        )}
                      </div>
                      {it.status === 'error' && <div className="text-xs text-destructive mt-1">{it.error}</div>}
                      {it.status === 'processing' && (
                        <>
                          {it.stage && <div className="text-xs text-muted-foreground mt-1">{it.stage}…</div>}
                          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-primary transition-[width] duration-150"
                              style={{ width: `${Math.round((it.progress || 0) * 100)}%` }}
                            />
                          </div>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {canCrop && (
                        <Button
                          size="icon"
                          variant={it.cropRect ? 'secondary' : 'ghost'}
                          onClick={() => setCropItem(it)}
                          aria-label="Crop"
                          title={it.cropRect ? `Crop: ${it.cropRect.w}×${it.cropRect.h}` : 'Crop'}
                        >
                          <Crop className="h-4 w-4" />
                        </Button>
                      )}
                      {canPreview && (
                        <Button size="icon" variant="ghost" onClick={() => setPreviewItem(it)} aria-label="Preview">
                          <Eye className="h-4 w-4" />
                        </Button>
                      )}
                      {it.status === 'done' && (
                        <Button size="sm" onClick={() => downloadOne(it)}>
                          <Download className="h-4 w-4" />
                          Download
                        </Button>
                      )}
                      {it.status !== 'processing' && it.status !== 'done' && (
                        <Button size="sm" variant="outline" onClick={() => runOne(it)} disabled={busy}>
                          <Play className="h-4 w-4" />
                          Run
                        </Button>
                      )}
                      <Button
                        size="icon" variant="ghost"
                        onClick={() => removeOne(it.id)}
                        disabled={it.status === 'processing'}
                        aria-label="Remove"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </main>

      <footer className="border-t">
        <div className="mx-auto max-w-5xl px-6 py-4 text-xs text-muted-foreground text-center">
          Built with React + Canvas + ffmpeg.wasm. 100% client-side.
        </div>
      </footer>

      <ImagePreviewModal open={!!previewItem} item={previewItem} onClose={() => setPreviewItem(null)} />
      <CropModal
        open={!!cropItem}
        item={cropItem}
        onClose={() => setCropItem(null)}
        onApply={(rect) => {
          if (!cropItem) return
          update(cropItem.id, {
            cropRect: rect,
            status: 'queued',
            outBlob: null,
            outSize: null,
            outName: null,
            progress: 0,
            error: null,
          })
        }}
      />
    </div>
  )
}
