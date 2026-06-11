export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif']

const extFor = (mime) => ({
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/avif': 'avif',
}[mime] || 'bin')

let avifSupportPromise = null
export function supportsAvifEncode() {
  if (!avifSupportPromise) {
    avifSupportPromise = new Promise((resolve) => {
      const c = document.createElement('canvas')
      c.width = 1; c.height = 1
      c.toBlob((b) => resolve(!!b && b.type === 'image/avif'), 'image/avif', 0.5)
    })
  }
  return avifSupportPromise
}

const isHeic = (file) =>
  /\.hei[cf]$/i.test(file.name) || file.type === 'image/heic' || file.type === 'image/heif'

async function decodeHeic(file) {
  const mod = await import('heic2any')
  // heic2any@0.0.4 ships as a side-effect bundle that attaches to window.heic2any —
  // no real module export. Fall back to the global if the import shape is empty.
  const fn =
    (typeof mod === 'function' && mod) ||
    (typeof mod?.default === 'function' && mod.default) ||
    (typeof window !== 'undefined' && window.heic2any)
  if (typeof fn !== 'function') throw new Error('heic2any failed to load')
  const out = await fn({ blob: file, toType: 'image/jpeg', quality: 0.95 })
  return Array.isArray(out) ? out[0] : out
}

async function loadBitmap(blob) {
  if ('createImageBitmap' in window) return createImageBitmap(blob)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = URL.createObjectURL(blob)
  })
}

function encode(canvas, format, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Encoding failed'))),
      format,
      format === 'image/png' ? undefined : quality
    )
  })
}

export async function optimizeImage(file, { format, quality, maxDim, targetBytes, onProgress }) {
  onProgress?.(0.05)
  const source = isHeic(file) ? await decodeHeic(file) : file

  onProgress?.(0.15)
  const bmp = await loadBitmap(source)
  let { width, height } = bmp.width != null ? bmp : { width: bmp.naturalWidth, height: bmp.naturalHeight }

  if (maxDim && (width > maxDim || height > maxDim)) {
    const scale = Math.min(maxDim / width, maxDim / height)
    width = Math.round(width * scale)
    height = Math.round(height * scale)
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bmp, 0, 0, width, height)
  if (bmp.close) bmp.close()

  onProgress?.(0.35)

  let blob
  if (targetBytes && format !== 'image/png') {
    // Binary search quality until under target. Max 7 iterations.
    let lo = 0.1, hi = 1, best = null
    for (let i = 0; i < 7; i++) {
      const q = (lo + hi) / 2
      // eslint-disable-next-line no-await-in-loop
      const candidate = await encode(canvas, format, q)
      onProgress?.(0.35 + (i + 1) * 0.08)
      if (candidate.size <= targetBytes) {
        best = candidate
        lo = q
      } else {
        hi = q
      }
    }
    blob = best || (await encode(canvas, format, lo))
  } else {
    blob = await encode(canvas, format, quality)
  }

  onProgress?.(1)
  const base = file.name.replace(/\.[^.]+$/, '')
  return { blob, name: `${base}.${extFor(format)}` }
}
