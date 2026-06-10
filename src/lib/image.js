export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const extFor = (mime) => ({
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}[mime] || 'bin')

function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    return createImageBitmap(file)
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

export async function optimizeImage(file, { format, quality, maxDim, onProgress }) {
  onProgress?.(0.05)
  const bmp = await loadBitmap(file)
  let { width, height } = bmp.width != null ? bmp : { width: bmp.naturalWidth, height: bmp.naturalHeight }

  if (maxDim && (width > maxDim || height > maxDim)) {
    const scale = Math.min(maxDim / width, maxDim / height)
    width = Math.round(width * scale)
    height = Math.round(height * scale)
  }

  onProgress?.(0.3)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bmp, 0, 0, width, height)
  if (bmp.close) bmp.close()

  onProgress?.(0.6)
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Encoding failed'))),
      format,
      format === 'image/png' ? undefined : quality
    )
  })

  onProgress?.(1)
  const base = file.name.replace(/\.[^.]+$/, '')
  return { blob, name: `${base}.${extFor(format)}` }
}
