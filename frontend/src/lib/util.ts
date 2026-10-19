import type { ClinicianGrade, FollowUp, Grade, Laterality, ModuleKey, ModuleStatus } from '../types/domain'
import { localeOf } from './i18n'

export function uid(prefix: string): string {
  const rand = crypto.getRandomValues(new Uint32Array(2))
  return `${prefix}_${Date.now().toString(36)}${rand[0].toString(36)}${rand[1].toString(36).slice(0, 4)}`
}

export const nowIso = () => new Date().toISOString()

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function formatDate(iso?: string, withTime = false): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(localeOf(), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

export function ageFrom(dob?: string, fallback?: number): number | undefined {
  if (!dob) return fallback
  const d = new Date(dob)
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--
  return age
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`

/** Each screening captures ONE retinal fundus image, stored in this single slot. */
export const IMAGE_SLOT: Laterality = 'right'
export const IMAGE_SLOTS: Laterality[] = [IMAGE_SLOT]
export const EYE_LABEL: Record<Laterality, string> = { right: 'Retinal fundus image', left: 'Retinal fundus image' }
export const EYE_SHORT: Record<Laterality, string> = { right: 'OD', left: 'OS' }

export const GRADE_LABEL: Record<Grade, string> = {
  0: 'No DR',
  1: 'Mild NPDR',
  2: 'Moderate NPDR',
  3: 'Severe NPDR',
  4: 'Proliferative DR',
}

export const GRADE_LONG: Record<Grade, string> = {
  0: 'No diabetic retinopathy',
  1: 'Mild non-proliferative DR',
  2: 'Moderate non-proliferative DR',
  3: 'Severe non-proliferative DR',
  4: 'Proliferative DR',
}

export const GRADE_COLOR: Record<Grade, string> = {
  0: 'var(--color-g0)',
  1: 'var(--color-g1)',
  2: 'var(--color-g2)',
  3: 'var(--color-g3)',
  4: 'var(--color-g4)',
}

export const GRADE_HEX: Record<Grade, string> = {
  0: '#B9D4FF',
  1: '#7FB2FF',
  2: '#4A83ED',
  3: '#245CEB',
  4: '#FF5C72',
}

export function clinicianGradeLabel(g: ClinicianGrade | null): string {
  if (g === null) return 'Not recorded'
  if (g === 'ungradeable') return 'Unable to screen — image quality inadequate'
  if (g === 'not_screened') return 'Not screened'
  return GRADE_LONG[g]
}

export const FOLLOW_UP_LABEL: Record<FollowUp, string> = {
  routine_12m: 'Routine rescreen in 12 months',
  repeat_6m: 'Repeat screening in 6 months',
  refer_routine: 'Refer to ophthalmology (routine)',
  refer_urgent: 'Refer to ophthalmology (urgent)',
  recapture: 'Recapture images — screening incomplete',
  further_assessment: 'Further assessment required',
}

export const MODULE_LABEL: Record<ModuleKey, string> = {
  dr_binary: 'DR detection (EfficientNet-B4) + Grad-CAM',
  classification: 'Five-class DR grading (ViT)',
  attribution: 'Model attribution map',
  lesions: 'Lesion segmentation',
  vessels: 'Vessel segmentation',
}

export const MODULE_STATUS_LABEL: Record<ModuleStatus, string> = {
  unavailable: 'Unavailable',
  queued: 'Queued',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
}

/** Small deterministic PRNG for reproducible demo fixtures. */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
