import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { PDFDocument } from 'pdf-lib'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

export async function optimizePdf(file, { format, quality, maxDim, onProgress }) {
  onProgress?.(0.02)
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  const out = await PDFDocument.create()

  const useJpeg = format !== 'image/png'
  const encodeMime = useJpeg ? 'image/jpeg' : 'image/png'

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const baseViewport = page.getViewport({ scale: 1 })

    let scale = 2
    if (maxDim) {
      const longest = Math.max(baseViewport.width, baseViewport.height)
      scale = Math.min(scale, maxDim / longest)
      if (!isFinite(scale) || scale <= 0) scale = 1
    }

    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(viewport.width))
    canvas.height = Math.max(1, Math.round(viewport.height))
    const ctx = canvas.getContext('2d')

    if (useJpeg) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }

    await page.render({ canvasContext: ctx, viewport, canvas }).promise

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Page encoding failed'))),
        encodeMime,
        useJpeg ? quality : undefined
      )
    })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const img = useJpeg ? await out.embedJpg(bytes) : await out.embedPng(bytes)
    const newPage = out.addPage([baseViewport.width, baseViewport.height])
    newPage.drawImage(img, { x: 0, y: 0, width: baseViewport.width, height: baseViewport.height })

    page.cleanup?.()
    onProgress?.(0.05 + (0.9 * i) / pdf.numPages)
  }

  const saved = await out.save({ useObjectStreams: true })
  const blob = new Blob([saved], { type: 'application/pdf' })
  onProgress?.(1)
  const base = file.name.replace(/\.[^.]+$/, '')
  return { blob, name: `${base}.pdf` }
}
