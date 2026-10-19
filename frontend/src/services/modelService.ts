/**
 * Client for the GlucoIris inference service (backend/app/main.py).
 *
 * The service is optional: when it is not reachable the app stays in demo
 * mode (scripted results for bundled samples, browser quality heuristic).
 */

import type { CamRegion } from '../types/domain'

export const MODEL_API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000'

export interface ModuleHealth {
  status: 'available' | 'unavailable' | 'failed'
  version?: string
  message?: string
  smoke_test?: boolean
  meta?: Record<string, unknown>
}

export interface ServiceHealth {
  service: string
  version: string
  modules: {
    quality: ModuleHealth
    dr_binary: ModuleHealth
    classification: ModuleHealth
    attribution: ModuleHealth
    vessels: ModuleHealth
    lesions: ModuleHealth
    device: string
  }
}

export interface ServiceQualityDimension {
  key: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  score: number
  value: number
  detail: string
}

export interface ServiceQuality {
  outcome: 'acceptable' | 'borderline' | 'ungradeable'
  score: number
  dimensions: ServiceQualityDimension[]
  reasons: string[]
  guidance: string[]
  version: string
}

export interface LesionBox {
  class: string
  label: string
  x: number
  y: number
  w: number
  h: number
  area_px: number
  score: number
}

export interface ServiceArtifact {
  url: string
  width: number
  height: number
}

export interface ServiceAnalysis {
  image: { width: number; height: number; artifact_width: number; artifact_height: number }
  quality: ServiceQuality
  modules: Record<'dr_binary' | 'classification' | 'attribution' | 'vessels' | 'lesions', { status: 'completed' | 'unavailable' | 'failed'; message?: string; method?: string }>
  classification?: {
    probabilities: [number, number, number, number, number]
    predicted_grade: number
    any_dr_score: number
    referable_dr_score: number
    referable_threshold: number
    referable_flag: boolean
    determinable: boolean
    calibration: string
    temperature: number
    model_version: string
    model_name: string
    preprocessing: string
    cam_target: string
  }
  dr_binary?: { probability: number; threshold: number; positive: boolean; label: string; model_name: string; model_version: string; task: string; preprocessing: string; explainability: string }
  vessels?: { vessel_density: number; threshold: number; version: string }
  lesions?: { boxes: LesionBox[]; counts: Record<string, number>; thresholds: Record<string, number>; version: string; legend: { class: string; label: string; color: string }[] }
  gradcam_b4_regions?: CamRegion[]
  attribution_regions?: CamRegion[]
  artifacts: Partial<Record<'gradcam_b4' | 'gradcam_b4_blend' | 'gradcam_b4_boxes' | 'attribution' | 'attribution_blend' | 'attribution_boxes' | 'vessels' | 'lesions' | 'boxes_image', ServiceArtifact>>
  timings_ms: Record<string, number>
}

let healthPromise: Promise<ServiceHealth | null> | null = null

/** Cached reachability check (1.5 s timeout). `force` re-checks. */
export function serviceHealth(force = false): Promise<ServiceHealth | null> {
  if (!healthPromise || force) {
    healthPromise = (async () => {
      try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 1500)
        const res = await fetch(`${MODEL_API_BASE}/v1/health`, { signal: ctrl.signal })
        clearTimeout(t)
        return res.ok ? ((await res.json()) as ServiceHealth) : null
      } catch {
        return null
      }
    })()
  }
  return healthPromise
}

export const artifactUrl = (path: string) => (path.startsWith('http') ? path : `${MODEL_API_BASE}${path}`)

async function postImage<T>(path: string, blob: Blob): Promise<T> {
  const form = new FormData()
  form.append('file', blob, blob.type === 'image/png' ? 'image.png' : 'image.jpg')
  const res = await fetch(`${MODEL_API_BASE}${path}`, { method: 'POST', body: form })
  if (!res.ok) {
    let detail = `${res.status}`
    try {
      detail = (await res.json()).detail ?? detail
    } catch {
      /* not JSON */
    }
    throw new Error(`Inference service error: ${detail}`)
  }
  return res.json() as Promise<T>
}

export const serviceQuality = (blob: Blob) => postImage<ServiceQuality>('/v1/quality', blob)
export const serviceAnalyze = (blob: Blob) => postImage<ServiceAnalysis>('/v1/analyze?quality_gate=false', blob)
