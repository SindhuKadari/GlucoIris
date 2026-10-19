import { loadImageElement, rasterize } from './images'

/**
 * Viewer-only enhancement: CLAHE on luminance (8×8 tiles, clip 2.0).
 * Display aid for the clinician — it is NOT applied to model inputs, and it
 * cannot recover information that was not captured (spec §6).
 */
export const ENHANCEMENT_METHOD = 'CLAHE (luminance, 8×8 tiles, clip 2.0) — viewer only'

const cache = new Map<string, Promise<string>>()

export function enhancedUrl(sourceUrl: string, maxWidth = 1280): Promise<string> {
  const key = `${sourceUrl}@${maxWidth}`
  let p = cache.get(key)
  if (!p) {
    p = loadImageElement(sourceUrl).then((img) => {
      const { canvas, ctx, data } = rasterize(img, maxWidth)
      clahe(data, 8, 2.0)
      ctx.putImageData(data, 0, 0)
      return new Promise<string>((resolve) =>
        canvas.toBlob((b) => resolve(URL.createObjectURL(b!)), 'image/jpeg', 0.9),
      )
    })
    cache.set(key, p)
  }
  return p
}

export function clahe(img: ImageData, tiles: number, clipLimit: number) {
  const { width: w, height: h, data } = img
  const n = w * h
  const Y = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    Y[i] = Math.min(255, Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]))
  }
  const tw = Math.ceil(w / tiles)
  const th = Math.ceil(h / tiles)
  const luts: Uint8Array[] = []
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      const hist = new Float64Array(256)
      const x0 = tx * tw, y0 = ty * th
      const x1 = Math.min(w, x0 + tw), y1 = Math.min(h, y0 + th)
      let count = 0
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { hist[Y[y * w + x]]++; count++ }
      const limit = Math.max(1, (clipLimit * count) / 256)
      let excess = 0
      for (let i = 0; i < 256; i++) if (hist[i] > limit) { excess += hist[i] - limit; hist[i] = limit }
      const add = excess / 256
      for (let i = 0; i < 256; i++) hist[i] += add
      const lut = new Uint8Array(256)
      let cum = 0
      for (let i = 0; i < 256; i++) {
        cum += hist[i]
        lut[i] = Math.min(255, Math.round((cum / Math.max(count, 1)) * 255))
      }
      luts.push(lut)
    }
  }
  for (let y = 0; y < h; y++) {
    const gy = y / th - 0.5
    const ty0 = Math.max(0, Math.min(tiles - 1, Math.floor(gy)))
    const ty1 = Math.min(tiles - 1, ty0 + 1)
    const fy = Math.max(0, Math.min(1, gy - ty0))
    for (let x = 0; x < w; x++) {
      const gx = x / tw - 0.5
      const tx0 = Math.max(0, Math.min(tiles - 1, Math.floor(gx)))
      const tx1 = Math.min(tiles - 1, tx0 + 1)
      const fx = Math.max(0, Math.min(1, gx - tx0))
      const i = y * w + x
      const v = Y[i]
      const a = luts[ty0 * tiles + tx0][v], b = luts[ty0 * tiles + tx1][v]
      const c = luts[ty1 * tiles + tx0][v], d = luts[ty1 * tiles + tx1][v]
      const ny = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
      const ratio = v > 2 ? ny / v : 1
      data[i * 4] = Math.min(255, data[i * 4] * ratio)
      data[i * 4 + 1] = Math.min(255, data[i * 4 + 1] * ratio)
      data[i * 4 + 2] = Math.min(255, data[i * 4 + 2] * ratio)
    }
  }
}
