import { createStore, del, get, set } from 'idb-keyval'
import type { EyeImage, ImageSource } from '../types/domain'

// Uploaded/captured image blobs live in IndexedDB (records hold only keys).
// Demo-only: real patient images belong in private server storage (spec §13, §15).
const blobStore = createStore('glucoiris-demo', 'image-blobs')

export const putBlob = (key: string, blob: Blob) => set(key, blob, blobStore)
export const getBlob = (key: string) => get<Blob>(key, blobStore)
export const deleteBlob = (key: string) => del(key, blobStore)

const urlCache = new Map<string, string>()

/** Resolve an image source to a URL usable by <img>/<canvas>. */
export async function resolveSourceUrl(source: ImageSource): Promise<string | null> {
  if (source.kind === 'fixture') return source.url
  const cached = urlCache.get(source.blobKey)
  if (cached) return cached
  const blob = await getBlob(source.blobKey)
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  urlCache.set(source.blobKey, url)
  return url
}

export const resolveImageUrl = (img: EyeImage) => resolveSourceUrl(img.source)

export function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    // Model artifacts come from the inference service: request CORS so canvases stay readable (PDF export).
    if (/^https?:/.test(url) && !url.startsWith(window.location.origin)) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image could not be decoded'))
    img.src = url
  })
}

/** Draw an image into a canvas at a target width and return its pixels. */
export function rasterize(img: CanvasImageSource & { width: number; height: number }, width: number) {
  const w = Math.min(width, img.width)
  const h = Math.round((img.height * w) / img.width)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  return { canvas, ctx, data: ctx.getImageData(0, 0, w, h) }
}

export async function readImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const bmp = await createImageBitmap(blob)
  const dims = { width: bmp.width, height: bmp.height }
  bmp.close()
  return dims
}
