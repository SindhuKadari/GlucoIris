import type { DimensionStatus, QualityDimension, QualityOutcome } from '../types/domain'
import { rasterize } from './images'

/**
 * Heuristic fundus image-quality screen (v0.1, UNVALIDATED).
 *
 * Classical image measurements, not a trained gradeability model. Thresholds were
 * set on IDRiD/DRIVE samples and synthetic degradations (scripts/quality_metrics.py
 * is the Python reference; browser resampling reads sharpness ~30% lower, so the
 * focus thresholds here are scaled accordingly). It must be evaluated on representative images before
 * any clinical use (spec §6, §16).
 */
export const QUALITY_VERSION = 'heuristic-quality-0.1 (unvalidated)'

const WORK_WIDTH = 512

export interface QualityMetrics {
  fovFraction: number
  fovFill: number
  redGreenRatio: number
  meanRed: number
  luminance: number
  sharpness: number
  glareFraction: number
  unevenness: number
  shortSide: number
}

export function measure(img: HTMLImageElement | ImageBitmap): QualityMetrics {
  const { data } = rasterize(img, WORK_WIDTH)
  const { width: w, height: h } = data
  const px = data.data
  const n = w * h
  const R = new Float32Array(n)
  const G = new Float32Array(n)
  const B = new Float32Array(n)
  const fov = new Uint8Array(n)
  let minX = w, maxX = 0, minY = h, maxY = 0, fovCount = 0
  for (let i = 0; i < n; i++) {
    R[i] = px[i * 4]
    G[i] = px[i * 4 + 1]
    B[i] = px[i * 4 + 2]
    if (R[i] > 25) {
      fov[i] = 1
      fovCount++
      const x = i % w, y = (i / w) | 0
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  const shortSide = Math.min(img.width, img.height)
  if (fovCount < n * 0.02) {
    return { fovFraction: fovCount / n, fovFill: 0, redGreenRatio: 0, meanRed: 0, luminance: 0, sharpness: 0, glareFraction: 0, unevenness: 0, shortSide }
  }

  // Erode the field of view so the rim edge does not dominate sharpness.
  const k = Math.max(1, Math.floor((WORK_WIDTH * 0.04) / 2))
  const inner = erode(fov, w, h, k)

  let sr = 0, sg = 0, sl = 0, cnt = 0
  for (let i = 0; i < n; i++) {
    if (!inner[i]) continue
    sr += R[i]
    sg += G[i]
    sl += 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i]
    cnt++
  }
  cnt = Math.max(cnt, 1)
  const meanR = sr / cnt, meanG = sg / cnt, lum = sl / cnt

  // Contrast-normalised variance of the Laplacian on the green channel.
  let gVar = 0
  for (let i = 0; i < n; i++) if (inner[i]) gVar += (G[i] - meanG) ** 2
  const gStd = Math.sqrt(gVar / cnt)
  let lapSum = 0, lapSq = 0, lapN = 0, glare = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (!inner[i]) continue
      const lap = G[i - 1] + G[i + 1] + G[i - w] + G[i + w] - 4 * G[i]
      lapSum += lap
      lapSq += lap * lap
      lapN++
      if (R[i] > 245 && G[i] > 235 && B[i] > 220) glare++
    }
  }
  const lapMean = lapSum / Math.max(lapN, 1)
  const lapVar = lapSq / Math.max(lapN, 1) - lapMean * lapMean
  const sharpness = lapVar / (gStd + 1e-3)

  // Quadrant luminance spread for uneven illumination.
  const cxm = (minX + maxX) / 2, cym = (minY + maxY) / 2
  const qs = [0, 0, 0, 0], qn = [0, 0, 0, 0]
  for (let i = 0; i < n; i++) {
    if (!inner[i]) continue
    const x = i % w, y = (i / w) | 0
    const q = (y < cym ? 0 : 2) + (x < cxm ? 0 : 1)
    qs[q] += 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i]
    qn[q]++
  }
  const qMeans = qs.map((s, i) => (qn[i] > 50 ? s / qn[i] : NaN)).filter((v) => !Number.isNaN(v))
  const qAvg = qMeans.reduce((a, b) => a + b, 0) / Math.max(qMeans.length, 1)
  const unevenness = qMeans.length ? (Math.max(...qMeans) - Math.min(...qMeans)) / (qAvg + 1e-3) : 0

  return {
    fovFraction: fovCount / n,
    fovFill: fovCount / ((maxX - minX + 1) * (maxY - minY + 1)),
    redGreenRatio: meanR / (meanG + 1e-3),
    meanRed: meanR,
    luminance: lum,
    sharpness,
    glareFraction: glare / Math.max(lapN, 1),
    unevenness,
    shortSide,
  }
}

function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  // Separable box erosion (horizontal then vertical).
  const tmp = new Uint8Array(mask.length)
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < h; y++) {
    let run = 0
    const row = y * w
    const prefix = new Int32Array(w + 1)
    for (let x = 0; x < w; x++) prefix[x + 1] = prefix[x] + mask[row + x]
    for (let x = 0; x < w; x++) {
      const a = Math.max(0, x - r), b = Math.min(w, x + r + 1)
      run = prefix[b] - prefix[a]
      tmp[row + x] = run === b - a ? 1 : 0
    }
  }
  for (let x = 0; x < w; x++) {
    const prefix = new Int32Array(h + 1)
    for (let y = 0; y < h; y++) prefix[y + 1] = prefix[y] + tmp[y * w + x]
    for (let y = 0; y < h; y++) {
      const a = Math.max(0, y - r), b = Math.min(h, y + r + 1)
      out[y * w + x] = prefix[b] - prefix[a] === b - a ? 1 : 0
    }
  }
  return out
}

export interface QualityAssessment {
  outcome: QualityOutcome
  dimensions: QualityDimension[]
  reasons: string[]
  guidance: string[]
}

export function assess(m: QualityMetrics): QualityAssessment {
  const dims: QualityDimension[] = []
  const push = (key: QualityDimension['key'], label: string, status: DimensionStatus, detail: string, value?: number) =>
    dims.push({ key, label, status, detail, value })

  const looksFundus = m.fovFraction > 0.2 && m.fovFill > 0.55 && m.redGreenRatio > 1.25 && m.meanRed > 40
  push(
    'validity',
    'Fundus image validity',
    looksFundus ? 'pass' : 'fail',
    looksFundus
      ? 'Circular retinal field with expected fundus colouring detected.'
      : 'Image does not appear to be a retinal fundus photograph.',
  )

  if (!looksFundus) {
    return {
      outcome: 'ungradeable',
      dimensions: dims,
      reasons: ['Image does not appear to be a retinal fundus photograph.'],
      guidance: [
        'Upload or capture a colour fundus photograph of the specified eye.',
        'A normal phone or laptop camera image is not a fundus image.',
      ],
    }
  }

  const s = m.sharpness
  push(
    'focus',
    'Focus and blur',
    s < 0.35 ? 'fail' : s < 0.6 ? 'warn' : 'pass',
    s < 0.35
      ? 'Image appears out of focus — vessel edges are not resolved.'
      : s < 0.6
        ? 'Image is slightly soft; fine detail such as microaneurysms may be missed.'
        : 'Vessel edges are sharply resolved.',
    s,
  )

  const l = m.luminance
  const u = m.unevenness
  const illumStatus: DimensionStatus = l < 35 || l > 200 || u > 0.8 ? 'fail' : l < 55 || l > 170 || u > 0.55 ? 'warn' : 'pass'
  push(
    'illumination',
    'Illumination and exposure',
    illumStatus,
    l < 35
      ? 'Image is severely under-exposed; retinal detail is not visible.'
      : l > 200
        ? 'Image is over-exposed; detail is washed out.'
        : u > 0.8
          ? 'Illumination is strongly uneven across the field.'
          : l < 55
            ? 'Image is dark; consider increasing flash or pupil dilation.'
            : l > 170
              ? 'Image is bright; some detail may be washed out.'
              : u > 0.55
                ? 'Illumination is uneven across the field.'
                : 'Exposure is within the expected range.',
    l,
  )

  const g = m.glareFraction
  push(
    'glare',
    'Glare and artefacts',
    g > 0.03 ? 'fail' : g > 0.008 ? 'warn' : 'pass',
    g > 0.03
      ? 'Glare obscures retinal detail over part of the field.'
      : g > 0.008
        ? 'Small saturated reflections present; check they do not cover lesions.'
        : 'No significant saturated reflections detected.',
    g,
  )

  const f = m.fovFraction
  push(
    'field',
    'Field coverage',
    f < 0.35 ? 'fail' : f < 0.5 ? 'warn' : 'pass',
    f < 0.35
      ? 'Retinal field is too small or cut off; re-centre the camera.'
      : f < 0.5
        ? 'Retinal field is partially cropped.'
        : 'Retinal field fills the expected area.',
    f,
  )

  const r = m.shortSide
  push(
    'resolution',
    'Resolution',
    r < 480 ? 'fail' : r < 1000 ? 'warn' : 'pass',
    r < 480
      ? `Resolution (${r}px short side) is too low for grading.`
      : r < 1000
        ? `Resolution (${r}px short side) is below the recommended 1000px; small lesions may not be resolved.`
        : `Resolution is adequate (${r}px short side).`,
    r,
  )

  const fails = dims.filter((d) => d.status === 'fail')
  const warns = dims.filter((d) => d.status === 'warn')
  const outcome: QualityOutcome = fails.length ? 'ungradeable' : warns.length ? 'borderline' : 'acceptable'

  const guidance: string[] = []
  for (const d of [...fails, ...warns]) {
    if (d.key === 'focus') guidance.push('Refocus the camera on the retina and ask the patient to keep still before recapturing.')
    if (d.key === 'illumination') guidance.push('Adjust flash intensity, allow pupils to dilate further, or reduce ambient light.')
    if (d.key === 'glare') guidance.push('Realign the camera to move reflections off the retina; check the lens is clean.')
    if (d.key === 'field') guidance.push('Centre the fundus in the frame so the full retinal field is visible.')
    if (d.key === 'resolution') guidance.push('Use the camera’s full-resolution output rather than a screenshot or compressed copy.')
  }

  return { outcome, dimensions: dims, reasons: [...fails, ...warns].map((d) => d.detail), guidance }
}
