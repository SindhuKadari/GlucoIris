import type { QualityDimension, QualityResult } from '../types/domain'
import { serviceHealth, serviceQuality } from './modelService'
import { loadImageElement, rasterize } from '../lib/images'
import { assess, measure, QUALITY_VERSION } from '../lib/quality'
import type { Laterality } from '../types/domain'

export type QualityDraft = Omit<QualityResult, 'id'>

/**
 * Quality screen. Uses the GlucoIris quality algorithm on the inference service
 * when reachable (sharpness, brightness, contrast, illumination, glare, noise,
 * field, resolution); otherwise the in-browser heuristic. Failures return
 * `unavailable`, never a pass.
 */
export async function runQuality(imageId: string, url: string): Promise<QualityDraft> {
  const assessedAt = new Date().toISOString()
  if (await serviceHealth()) {
    try {
      const blob = await (await fetch(url)).blob()
      const q = await serviceQuality(blob)
      return {
        imageId,
        version: q.version,
        assessedAt,
        outcome: q.outcome,
        score: q.score,
        dimensions: q.dimensions.map((d) => ({ key: d.key as QualityDimension['key'], label: d.label, status: d.status, detail: d.detail, value: d.value, score: d.score })),
        reasons: q.reasons,
        guidance: q.guidance,
      }
    } catch {
      /* service hiccup: fall through to the in-browser screen */
    }
  }
  try {
    const img = await loadImageElement(url)
    const a = assess(measure(img))
    return { imageId, version: QUALITY_VERSION, assessedAt, ...a }
  } catch (e) {
    return {
      imageId,
      version: QUALITY_VERSION,
      assessedAt,
      outcome: 'unavailable',
      dimensions: [],
      reasons: [`Quality assessment could not run: ${(e as Error).message}`],
      guidance: ['Retry the assessment or replace the image. The image has not been approved.'],
    }
  }
}

/**
 * Heuristic laterality hint from optic-disc position (brightest blurred region).
 * Assumes a macula-centred field; used only to warn about possible mislabelling.
 */
export async function estimateLaterality(url: string): Promise<Laterality | null> {
  try {
    const img = await loadImageElement(url)
    const { data } = rasterize(img, 128)
    const { width: w, height: h } = data
    const g = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++) g[i] = data.data[i * 4 + 1]
    const r = 6
    let best = -1, bx = 0
    for (let y = r; y < h - r; y += 2) {
      for (let x = r; x < w - r; x += 2) {
        let s = 0
        for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) s += g[(y + dy) * w + x + dx]
        if (s > best) { best = s; bx = x }
      }
    }
    if (Math.abs(bx - w / 2) < w * 0.08) return null
    return bx > w / 2 ? 'right' : 'left'
  } catch {
    return null
  }
}
