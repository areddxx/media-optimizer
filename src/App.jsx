import React, { useCallback, useMemo, useRef, useState } from 'react'
import { zipSync } from 'fflate'
import { optimizeImage, IMAGE_TYPES } from './lib/image.js'

const fmtBytes = (n) => {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

const isImage = (f) => IMAGE_TYPES.some((t) => f.type === t || f.name.toLowerCase().endsWith(t.split('/')[1]))

let idSeq = 1

export default function App() {
  const [items, setItems] = useState([])
  const [drag, setDrag] = useState(false)
  const [imgFormat, setImgFormat] = useState('image/webp')
  const [imgQuality, setImgQuality] = useState(0.8)
  const [maxDim, setMaxDim] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  const addFiles = useCallback((files) => {
    const next = Array.from(files).map((f) => ({
      id: idSeq++,
      file: f,
      name: f.name,
      origSize: f.size,
      kind: isImage(f) ? 'image' : 'other',
      status: 'queued',
      progress: 0,
      outBlob: null,
      outSize: null,
      outName: null,
      error: null,
    }))
    setItems((p) => [...p, ...next])
  }, [])

  const onDrop = (e) => {
    e.preventDefault()
    setDrag(false)
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
  }

  const update = (id, patch) => setItems((p) => p.map((it) => (it.id === id ? { ...it, ...patch } : it)))

  const runOne = async (it) => {
    if (it.kind !== 'image') {
      update(it.id, { status: 'error', error: 'Unsupported file type' })
      return
    }
    update(it.id, { status: 'processing', progress: 0, error: null })
    try {
      const { blob, name } = await optimizeImage(it.file, {
        format: imgFormat,
        quality: Number(imgQuality),
        maxDim: maxDim ? Number(maxDim) : null,
        onProgress: (p) => update(it.id, { progress: p }),
      })
      update(it.id, { status: 'done', outBlob: blob, outSize: blob.size, outName: name, progress: 1 })
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

  const totals = useMemo(() => {
    let orig = 0
    let out = 0
    let done = 0
    for (const it of items) {
      orig += it.origSize || 0
      if (it.status === 'done') {
        out += it.outSize || 0
        done++
      }
    }
    return { orig, out, done, count: items.length, saved: orig && out ? orig - out : 0 }
  }, [items])

  return (
    <div className="app">
      <h1>Image Optimizer</h1>
      <div className="sub">Compress images — entirely in your browser.</div>
      <div className="privacy">Your files never leave your device.</div>

      <div
        className={`dropzone ${drag ? 'drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <p><strong>Drop images here</strong> or click to choose</p>
        <p>JPG, PNG, WebP</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files) { addFiles(e.target.files); e.target.value = '' } }}
        />
      </div>

      <div className="section-title">Image options</div>
      <div className="controls">
        <div>
          <label>Output format</label>
          <select value={imgFormat} onChange={(e) => setImgFormat(e.target.value)}>
            <option value="image/webp">WebP</option>
            <option value="image/jpeg">JPEG</option>
            <option value="image/png">PNG (lossless)</option>
          </select>
        </div>
        <div>
          <label>Quality <span className="val">{imgFormat === 'image/png' ? 'n/a' : imgQuality.toFixed(2)}</span></label>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={imgQuality}
            disabled={imgFormat === 'image/png'}
            onChange={(e) => setImgQuality(Number(e.target.value))}
          />
        </div>
        <div>
          <label>Max dimension (px, optional)</label>
          <input type="number" min="1" value={maxDim} onChange={(e) => setMaxDim(e.target.value)} placeholder="e.g. 2000" />
        </div>
      </div>

      <div className="toolbar">
        <button className="btn" disabled={busy || !items.length} onClick={runAll}>
          {busy ? 'Processing…' : 'Optimize all'}
        </button>
        <button className="btn ghost" disabled={!items.some((i) => i.status === 'done')} onClick={downloadZip}>
          Download .zip
        </button>
        <button className="btn ghost" disabled={!items.length || busy} onClick={clearAll}>Clear</button>
        <div className="summary">
          {totals.done}/{totals.count} done · saved {fmtBytes(totals.saved)}
          {totals.orig && totals.out ? ` (${Math.round((totals.saved / totals.orig) * 100)}%)` : ''}
        </div>
      </div>

      <div className="section-title">Files</div>
      <div className="files">
        {items.length === 0 && <div className="sub">No files yet.</div>}
        {items.map((it) => {
          const pct = it.origSize && it.outSize ? Math.round((1 - it.outSize / it.origSize) * 100) : null
          return (
            <div className="file" key={it.id}>
              <div>
                <div className="name">{it.name}</div>
                <div className="meta">
                  {fmtBytes(it.origSize)}
                  {it.outSize != null && <> → {fmtBytes(it.outSize)} {pct != null && <span className={pct >= 0 ? 'status ok' : 'status warn'}>({pct >= 0 ? '−' : '+'}{Math.abs(pct)}%)</span>}</>}
                </div>
                {it.status === 'error' && <div className="status err">{it.error}</div>}
                {it.status === 'processing' && (
                  <div className="progress"><div style={{ width: `${Math.round((it.progress || 0) * 100)}%` }} /></div>
                )}
              </div>
              <div className="actions">
                {it.status === 'done' && <button className="btn" onClick={() => downloadOne(it)}>Download</button>}
                {it.status !== 'processing' && it.status !== 'done' && (
                  <button className="btn ghost" onClick={() => runOne(it)} disabled={busy}>Run</button>
                )}
                <button className="btn ghost" onClick={() => removeOne(it.id)} disabled={it.status === 'processing'}>✕</button>
              </div>
            </div>
          )
        })}
      </div>

      <footer>
        Built with React + Canvas API. 100% client-side.
      </footer>
    </div>
  )
}
