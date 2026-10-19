import type { Classification, EvidenceArtifact, EyeImage, EyeInterpretation, Laterality, ModuleKey, ModuleState, QualityResult, ReportSnapshot } from '../../types/domain'
import { MODULE_KEYS } from '../../types/domain'
import { DATASET_ATTRIBUTION, fixtureById } from '../../demo/fixtures'
import { GRADE_LABEL } from '../../lib/util'
import { tr } from '../../lib/i18n'

export interface EyeSection {
  eye: Laterality
  notScreenedReason?: string
  image?: EyeImage
  quality?: QualityResult
  classification?: Classification
  artifacts: EvidenceArtifact[]
  modules?: Record<ModuleKey, ModuleState>
  interpretation: EyeInterpretation
}

export function eyeSections(s: ReportSnapshot): EyeSection[] {
  // One retinal fundus image per screening; older two-image records keep both sections.
  const slots: Laterality[] = s.encounter.eyesPlanned.length ? s.encounter.eyesPlanned : ['right']
  return slots.map((eye) => {
    const image = s.images.find((i) => i.laterality === eye)
    return {
      eye,
      notScreenedReason: s.encounter.notScreened[eye] ?? (image ? undefined : 'No retinal fundus image was acquired.'),
      image,
      quality: image ? s.quality.find((q) => q.imageId === image.id) : undefined,
      classification: image ? s.classifications.find((c) => c.imageId === image.id) : undefined,
      artifacts: image ? s.artifacts.filter((a) => a.imageId === image.id) : [],
      modules: image ? s.modules[image.id] : undefined,
      interpretation: s.review.eyes[eye],
    }
  })
}

/** English labels (translation keys) for stored enum values shown on reports. */
export const SEX_LABEL: Record<string, string> = { female: 'Female', male: 'Male', other: 'Other', undisclosed: 'Prefer not to say' }
export const DIABETES_LABEL: Record<string, string> = { type1: 'Type 1', type2: 'Type 2', gestational: 'Gestational', other: 'Other', unknown: 'Unknown' }
export const CONSENT_LABEL: Record<string, string> = { verbal: 'Verbal consent', written: 'Written consent', programme_policy: 'Programme enrolment policy' }
export const QUALITY_LABEL: Record<string, string> = { acceptable: 'Acceptable', borderline: 'Borderline', ungradeable: 'Ungradeable', unavailable: 'Unavailable' }

export interface DrVerdict {
  status: 'dr' | 'no_dr' | 'undetermined' | 'not_screened'
  headline: string
  detail: string
}

/**
 * Headline answer for the report: does this image show diabetic retinopathy?
 * EfficientNet-B4 (binary DR detection) decides when present; otherwise the ViT grade
 * (when determinable). Disagreement between the two is stated, never hidden.
 */
export function drVerdict(sec: EyeSection): DrVerdict {
  if (!sec.image) return { status: 'not_screened', headline: tr('Not screened'), detail: tr(sec.notScreenedReason ?? 'No retinal fundus image was acquired.') }
  if (sec.quality?.outcome === 'ungradeable') return { status: 'undetermined', headline: tr('Unable to screen'), detail: tr('Image quality inadequate — recapture required.') }
  const b4 = sec.artifacts.find((a) => a.type === 'gradcam_b4')?.result
  const c = sec.classification
  const les = sec.artifacts.find((a) => a.type === 'lesion_mask' && a.provenance === 'model')
  const counts = (les?.boxes ?? []).reduce<Record<string, number>>((acc, b) => ({ ...acc, [b.label]: (acc[b.label] ?? 0) + 1 }), {})
  const lesionText = les
    ? Object.keys(counts).length
      ? tr('Lesions: {list}', { list: Object.entries(counts).map(([k, v]) => `${tr(k)} ${v}`).join(', ') })
      : tr('Lesions: none found')
    : ''
  const grade = c ? tr(GRADE_LABEL[c.predictedGrade]) : ''
  const vitText = c ? `${tr('ViT grade: {grade}', { grade: c.determinable ? grade : tr('uncertain (most likely {grade})', { grade }) })}${c.provenance === 'simulated' ? ` [${tr('simulated')}]` : ''}` : ''
  if (b4) {
    const parts = [tr('EfficientNet-B4 P(DR) {p} (threshold {t})', { p: b4.probability.toFixed(3), t: b4.threshold.toFixed(2) }), vitText, lesionText].filter(Boolean)
    const disagree = c?.determinable && (c.predictedGrade >= 1) !== b4.positive
    return {
      status: b4.positive ? 'dr' : 'no_dr',
      headline: tr(b4.positive ? 'Diabetic retinopathy detected' : 'No diabetic retinopathy detected'),
      detail: parts.join(' · ') + (disagree ? ` · ${tr('the two models disagree — clinician review required')}` : ''),
    }
  }
  if (c?.determinable) return { status: c.predictedGrade >= 1 ? 'dr' : 'no_dr', headline: tr(c.predictedGrade >= 1 ? 'Diabetic retinopathy detected' : 'No diabetic retinopathy detected'), detail: [vitText, lesionText].filter(Boolean).join(' · ') }
  return { status: 'undetermined', headline: tr('DR status not determined'), detail: [vitText, lesionText].filter(Boolean).join(' · ') || tr('No model result is available — clinician review required.') }
}

/** Modules that did not produce evidence, listed explicitly on every report. */
export function missingModules(sec: EyeSection): { module: ModuleKey; reason: string }[] {
  if (!sec.image) return []
  return MODULE_KEYS.filter((k) => sec.modules?.[k]?.status !== 'completed').map((k) => ({
    module: k,
    reason: sec.modules?.[k] ? `${sec.modules[k].status}${sec.modules[k].message ? ` — ${sec.modules[k].message}` : ''}` : 'not run (image did not pass the quality gate or analysis was not started)',
  }))
}

export function datasetCredits(s: ReportSnapshot): string[] {
  const sets = new Set<string>()
  s.images.forEach((i) => {
    if (i.source.kind === 'fixture') {
      const ds = fixtureById(i.source.fixtureId)?.dataset.split(' ')[0]
      if (ds) sets.add(ds)
    }
  })
  return [...sets].map((d) => DATASET_ATTRIBUTION[d]).filter(Boolean)
}

export const REPORT_LIMITATIONS = [
  'GlucoIris is a software research prototype. It supports clinical review and does not diagnose, prescribe, or replace a comprehensive eye examination.',
  'Model scores are uncalibrated outputs, not risk estimates. Attribution maps show regions associated with the model output; they are not verified lesions.',
  'The image-quality screen is heuristic and has not been validated against human graders.',
  'No regulatory clearance or clinical deployment approval is claimed.',
]
