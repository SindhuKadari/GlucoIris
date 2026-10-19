import type { EvidenceArtifact } from '../types/domain'
import { loadImageElement } from './images'
import { mulberry32 } from './util'

const cache = new Map<string, Promise<string>>()

/** Render an evidence artifact to a transparent overlay URL aligned to the source frame. */
export function overlayUrl(artifact: EvidenceArtifact): Promise<string> {
  let p = cache.get(artifact.id)
  if (!p) {
    p =
      artifact.source.kind === 'generated'
        ? simulatedAttribution(artifact)
        : artifact.prerendered
          ? Promise.resolve(artifact.source.url)
          : colouriseMask(artifact)
    cache.set(artifact.id, p)
  }
  return p
}

function toUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(URL.createObjectURL(b!)), 'image/png'))
}

/**
 * Deterministic SIMULATED attribution map for demo fixtures. It is illustrative
 * only: not produced by a model, not a lesion detector (spec §7.4, §13).
 */
async function simulatedAttribution(a: EvidenceArtifact): Promise<string> {
  const { artifactWidth: w, artifactHeight: h } = a.mapping
  const seed = a.source.kind === 'generated' ? a.source.seed : 1
  const rand = mulberry32(seed)
  const field = new Float32Array(w * h)
  const cx = w / 2, cy = h / 2
  const radius = Math.min(w, h) * 0.46
  const blobs = 4 + Math.floor(rand() * 4)
  for (let b = 0; b < blobs; b++) {
    const ang = rand() * Math.PI * 2
    const dist = Math.sqrt(rand()) * radius * 0.75
    const bx = cx + Math.cos(ang) * dist
    const by = cy + Math.sin(ang) * dist
    const sigma = radius * (0.08 + rand() * 0.14)
    const amp = 0.45 + rand() * 0.55
    const x0 = Math.max(0, Math.floor(bx - sigma * 3)), x1 = Math.min(w, Math.ceil(bx + sigma * 3))
    const y0 = Math.max(0, Math.floor(by - sigma * 3)), y1 = Math.min(h, Math.ceil(by + sigma * 3))
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const d2 = (x - bx) ** 2 + (y - by) ** 2
        field[y * w + x] += amp * Math.exp(-d2 / (2 * sigma * sigma))
      }
    }
  }
  let max = 0
  for (const v of field) if (v > max) max = v
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const inside = (x - cx) ** 2 + (y - cy) ** 2 < radius * radius
      const v = inside ? field[i] / (max || 1) : 0
      const [r, g, bl] = ramp(v)
      img.data[i * 4] = r
      img.data[i * 4 + 1] = g
      img.data[i * 4 + 2] = bl
      img.data[i * 4 + 3] = v < 0.12 ? 0 : Math.round(Math.min(1, v * 1.1) * 235)
    }
  }
  ctx.putImageData(img, 0, 0)
  return toUrl(canvas)
}

/** Deep blue → electric blue → cyan ramp: contrasts with the orange fundus. */
export function ramp(v: number): [number, number, number] {
  const stops: [number, number, number, number][] = [
    [0, 20, 40, 160],
    [0.5, 41, 121, 255],
    [0.85, 0, 166, 255],
    [1, 99, 217, 255],
  ]
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [p0, r0, g0, b0] = stops[i - 1]
      const [p1, r1, g1, b1] = stops[i]
      const t = (v - p0) / (p1 - p0)
      return [r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t]
    }
  }
  return [99, 217, 255]
}

async function colouriseMask(a: EvidenceArtifact): Promise<string> {
  if (a.source.kind !== 'url') throw new Error('unexpected source')
  const img = await loadImageElement(a.source.url)
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, img.width, img.height)
  const [r, g, b] = hex(a.legend[0]?.color ?? '#B9D4FF')
  for (let i = 0; i < d.data.length; i += 4) {
    const v = d.data[i]
    d.data[i] = r
    d.data[i + 1] = g
    d.data[i + 2] = b
    d.data[i + 3] = v > 127 ? 255 : 0
  }
  ctx.putImageData(d, 0, 0)
  return toUrl(canvas)
}

function hex(c: string): [number, number, number] {
  const n = parseInt(c.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
