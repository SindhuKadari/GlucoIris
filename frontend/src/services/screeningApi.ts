import type {
  AnalysisJob,
  Classification,
  DataMode,
  EvidenceArtifact,
  EyeImage,
  Grade,
  ModuleKey,
  ModuleState,
} from '../types/domain'
import { MODULE_KEYS } from '../types/domain'
import {
  DEMO_DETERMINABLE_MIN,
  DEMO_REFERABLE_THRESHOLD,
  FIXTURE_SCRIPTS,
  fixtureById,
} from '../demo/fixtures'
import { hashString, mulberry32, uid } from '../lib/util'
import { resolveImageUrl } from '../lib/images'
import { artifactUrl, serviceAnalyze, serviceHealth, type ServiceAnalysis } from './modelService'

/**
 * Replaceable model-service adapter (spec §12, §13, §22).
 *
 * The UI talks only to this interface. `DemoScreeningApi` produces explicitly
 * SIMULATED results for bundled fixtures; `ModelScreeningApi` calls the GlucoIris
 * inference service (real models). Demo success is never substituted for a real failure.
 */
export interface JobSnapshot {
  job: AnalysisJob
  classifications: Classification[]
  artifacts: EvidenceArtifact[]
  done: boolean
}

export interface ModelCatalogEntry {
  module: ModuleKey
  name: string
  version: string
  status: 'connected' | 'simulated' | 'reference_only' | 'not_available'
  note: string
}

export interface ScreeningApi {
  readonly mode: DataMode
  catalog(): ModelCatalogEntry[]
  startAnalysis(input: { encounterId: string; images: EyeImage[]; idempotencyKey: string; attempt: number }): Promise<AnalysisJob>
  getJob(job: AnalysisJob, images: EyeImage[]): Promise<JobSnapshot>
}

// ---------------------------------------------------------------------------
// Demo implementation
// ---------------------------------------------------------------------------

export const DEMO_MODEL = {
  id: 'glucoiris-vit-5class',
  version: 'demo-fixture-sim-0.1',
  preprocessing: 'n/a (simulated)',
  threshold: `demo-threshold-${DEMO_REFERABLE_THRESHOLD} (illustrative, not validation-derived)`,
}

type Plan = Record<ModuleKey, { start: number; end: number; outcome: 'completed' | 'failed' | 'unavailable'; message?: string; provenance?: ModuleState['provenance']; version?: string }>

function planFor(image: EyeImage, index: number, attempt: number): Plan {
  const fx = image.source.kind === 'fixture' ? fixtureById(image.source.fixtureId) : undefined
  const off = index * 700
  const unavailable = (message: string) => ({ start: 0, end: 0, outcome: 'unavailable' as const, message })
  if (!fx) {
    return {
      dr_binary: unavailable('No inference service connected (EfficientNet-B4 runs on the backend).'),
      classification: unavailable('No inference service connected. This upload can be previewed and reviewed, but no model result is produced.'),
      attribution: unavailable('Requires a connected classifier.'),
      lesions: unavailable('IDRiD lesion segmentation model not yet trained (spec §7.2).'),
      vessels: unavailable('DRIVE vessel segmentation model not yet trained (spec §7.3).'),
    }
  }
  const script = FIXTURE_SCRIPTS[fx.id] ?? {}
  const attrFails = script.attributionFailsFirstAttempt && attempt === 1
  return {
    dr_binary: unavailable('EfficientNet-B4 runs on the inference service — start the backend for real output.'),
    classification: { start: off + 500, end: off + 2600, outcome: 'completed', provenance: 'simulated', version: DEMO_MODEL.version },
    attribution: attrFails
      ? { start: off + 2600, end: off + 3900, outcome: 'failed', message: 'Simulated failure: attribution worker timed out. Classification is unaffected — retry the analysis.' }
      : { start: off + 2600, end: off + 4300, outcome: 'completed', provenance: 'simulated', version: 'sim-attribution-0.1' },
    lesions: unavailable('IDRiD lesion segmentation model not yet trained (spec §7.2).'),
    vessels: fx.vesselMask
      ? { start: off + 1200, end: off + 3100, outcome: 'completed', provenance: 'reference_annotation', version: 'DRIVE 1st_manual' }
      : unavailable('DRIVE vessel segmentation model not yet trained (spec §7.3).'),
  }
}

function stateAt(p: Plan[ModuleKey], elapsed: number): ModuleState {
  const updatedAt = new Date().toISOString()
  if (p.outcome === 'unavailable') return { status: 'unavailable', progress: 0, message: p.message, updatedAt }
  if (elapsed < p.start) return { status: 'queued', progress: 0, updatedAt }
  if (elapsed < p.end) {
    return { status: 'processing', progress: (elapsed - p.start) / (p.end - p.start), updatedAt }
  }
  if (p.outcome === 'failed') return { status: 'failed', progress: 1, message: p.message, updatedAt }
  return { status: 'completed', progress: 1, provenance: p.provenance, version: p.version, updatedAt }
}

function simulatedProbabilities(fixtureId: string, centre: Grade): [number, number, number, number, number] {
  const scripted = FIXTURE_SCRIPTS[fixtureId]?.probabilities
  if (scripted) return scripted
  const rand = mulberry32(hashString(fixtureId))
  const raw = [0, 1, 2, 3, 4].map((g) => {
    const d = Math.abs(g - centre)
    return Math.exp(-d * 1.7) * (0.75 + rand() * 0.5)
  })
  raw[centre] *= 2.2
  const s = raw.reduce((a, b) => a + b, 0)
  return raw.map((v) => Math.round((v / s) * 1000) / 1000) as [number, number, number, number, number]
}

export function buildClassification(image: EyeImage, job: AnalysisJob, probs: Classification['probabilities'], provenance: Classification['provenance'], meta: { modelId: string; modelVersion: string; preprocessing: string; threshold: string; referableThreshold: number; completedAt: string }): Classification {
  const predictedGrade = probs.indexOf(Math.max(...probs)) as Grade
  const anyDrScore = probs[1] + probs[2] + probs[3] + probs[4]
  const referableDrScore = probs[2] + probs[3] + probs[4]
  return {
    id: `cls_${job.id}_${image.id}`,
    imageId: image.id,
    jobId: job.id,
    modelId: meta.modelId,
    modelVersion: meta.modelVersion,
    preprocessingVersion: meta.preprocessing,
    thresholdVersion: meta.threshold,
    mode: job.mode,
    provenance,
    probabilities: probs,
    predictedGrade,
    anyDrScore,
    referableDrScore,
    referableThreshold: meta.referableThreshold,
    referableFlag: referableDrScore >= meta.referableThreshold,
    calibration: 'uncalibrated',
    determinable: Math.max(...probs) >= DEMO_DETERMINABLE_MIN,
    createdAt: meta.completedAt,
  }
}

export class DemoScreeningApi implements ScreeningApi {
  readonly mode: DataMode = 'demo'

  catalog(): ModelCatalogEntry[] {
    return [
      { module: 'classification', name: 'Five-class ViT (APTOS 2019)', version: DEMO_MODEL.version, status: 'simulated', note: 'Recorded checkpoint not yet connected. Demo fixtures return scripted, simulated scores.' },
      { module: 'attribution', name: 'ViT attention rollout / attribution', version: 'sim-attribution-0.1', status: 'simulated', note: 'Illustrative simulated maps on demo fixtures only.' },
      { module: 'lesions', name: 'IDRiD lesion U-Net', version: '—', status: 'not_available', note: 'Separate model work required.' },
      { module: 'vessels', name: 'DRIVE vessel segmentation', version: 'DRIVE 1st_manual', status: 'reference_only', note: 'No model yet. DRIVE fixtures show the manual reference annotation.' },
    ]
  }

  async startAnalysis(input: { encounterId: string; images: EyeImage[]; idempotencyKey: string; attempt: number }): Promise<AnalysisJob> {
    const job: AnalysisJob = {
      id: uid('job'),
      encounterId: input.encounterId,
      idempotencyKey: input.idempotencyKey,
      imageIds: input.images.map((i) => i.id),
      createdAt: new Date().toISOString(),
      attempt: input.attempt,
      mode: 'demo',
      modules: {},
    }
    input.images.forEach((img, i) => {
      const plan = planFor(img, i, input.attempt)
      job.modules[img.id] = Object.fromEntries(MODULE_KEYS.map((k) => [k, stateAt(plan[k], 0)])) as Record<ModuleKey, ModuleState>
    })
    return job
  }

  async getJob(job: AnalysisJob, images: EyeImage[]): Promise<JobSnapshot> {
    const elapsed = Date.now() - new Date(job.createdAt).getTime()
    const classifications: Classification[] = []
    const artifacts: EvidenceArtifact[] = []
    const modules: AnalysisJob['modules'] = {}
    let done = true
    job.imageIds.forEach((imageId, i) => {
      const image = images.find((im) => im.id === imageId)
      if (!image) return
      const plan = planFor(image, i, job.attempt)
      const states = Object.fromEntries(MODULE_KEYS.map((k) => [k, stateAt(plan[k], elapsed)])) as Record<ModuleKey, ModuleState>
      modules[imageId] = states
      if (MODULE_KEYS.some((k) => states[k].status === 'queued' || states[k].status === 'processing')) done = false
      const fx = image.source.kind === 'fixture' ? fixtureById(image.source.fixtureId) : undefined
      if (!fx) return
      if (states.classification.status === 'completed') {
        const centre = (fx.referenceGrade ?? 0) as Grade
        classifications.push(
          buildClassification(image, job, simulatedProbabilities(fx.id, centre), 'simulated', {
            modelId: DEMO_MODEL.id,
            modelVersion: DEMO_MODEL.version,
            preprocessing: DEMO_MODEL.preprocessing,
            threshold: DEMO_MODEL.threshold,
            referableThreshold: DEMO_REFERABLE_THRESHOLD,
            completedAt: new Date(new Date(job.createdAt).getTime() + plan.classification.end).toISOString(),
          }),
        )
      }
      const aw = 640
      const ah = Math.round((image.height * aw) / image.width)
      // attribution is no longer in MODULE_KEYS, so it may be absent from the computed states.
      if (states.attribution?.status === 'completed') {
        artifacts.push({
          id: `art_${job.id}_${image.id}_attr`,
          imageId,
          jobId: job.id,
          type: 'attribution',
          provenance: 'simulated',
          method: 'Simulated attribution map (illustrative only — not model output)',
          source: { kind: 'generated', seed: hashString(fx.id) },
          mapping: { sourceWidth: image.width, sourceHeight: image.height, artifactWidth: aw, artifactHeight: ah, transform: 'resize' },
          legend: [
            { label: 'Low attribution', color: '#1428a0' },
            { label: 'High attribution', color: '#B9D4FF' },
          ],
          createdAt: new Date().toISOString(),
        })
      }
      if (states.vessels.status === 'completed' && fx.vesselMask) {
        artifacts.push({
          id: `art_${job.id}_${image.id}_vessels`,
          imageId,
          jobId: job.id,
          type: 'vessel_mask',
          provenance: 'reference_annotation',
          method: 'DRIVE manual vessel annotation (1st observer) — reference, not model output',
          source: { kind: 'url', url: fx.vesselMask },
          mapping: { sourceWidth: image.width, sourceHeight: image.height, artifactWidth: fx.originalWidth, artifactHeight: fx.originalHeight, transform: 'resize' },
          legend: [{ label: 'Retinal vessel (manual annotation)', color: '#B9D4FF' }],
          createdAt: new Date().toISOString(),
        })
      }
    })
    return { job: { ...job, modules }, classifications, artifacts, done }
  }
}

// ---------------------------------------------------------------------------
// Model-service implementation: real inference from backend/app (FastAPI).
// Results carry provenance 'model'. A failed or missing module is reported as
// such — demo output is never substituted for a real failure.
// ---------------------------------------------------------------------------

interface PendingRun {
  started: number
  results: Record<string, { status: 'processing' | 'done' | 'error'; data?: ServiceAnalysis; error?: string }>
}

const runs = new Map<string, PendingRun>()

async function imageBlob(image: EyeImage): Promise<Blob> {
  const url = await resolveImageUrl(image)
  if (!url) throw new Error('Image data is not available in this browser.')
  const res = await fetch(url)
  return res.blob()
}

function artifactFor(image: EyeImage, job: AnalysisJob, a: ServiceAnalysis, key: 'gradcam_b4' | 'attribution' | 'vessels' | 'lesions', completedAt: string): EvidenceArtifact | null {
  const art = a.artifacts[key]
  if (!art) return null
  const mapping = { sourceWidth: image.width, sourceHeight: image.height, artifactWidth: art.width, artifactHeight: art.height, transform: 'resize' as const }
  if (key === 'gradcam_b4') {
    const r = a.dr_binary
    return {
      id: `art_${job.id}_${image.id}_b4`, imageId: image.id, jobId: job.id, type: 'gradcam_b4', provenance: 'model',
      method: `Grad-CAM on EfficientNet-B4 (features[-1]) for the DR logit`,
      source: { kind: 'url', url: artifactUrl(art.url) }, prerendered: true, mapping,
      legend: [{ label: 'Low', color: '#00008f' }, { label: 'High', color: '#8f0000' }],
      blendImageUrl: a.artifacts.gradcam_b4_blend ? artifactUrl(a.artifacts.gradcam_b4_blend.url) : undefined,
      boxesImageUrl: a.artifacts.gradcam_b4_boxes ? artifactUrl(a.artifacts.gradcam_b4_boxes.url) : undefined,
      camRegions: a.gradcam_b4_regions,
      result: r ? { probability: r.probability, threshold: r.threshold, positive: r.positive, label: r.label, task: r.task, model: r.model_name, version: r.model_version } : undefined,
      createdAt: completedAt,
    }
  }
  if (key === 'attribution') {
    return {
      id: `art_${job.id}_${image.id}_attr`, imageId: image.id, jobId: job.id, type: 'attribution', provenance: 'model',
      method: `Grad-CAM on the ViT (last block) for the predicted class (${a.classification?.cam_target ?? '—'})`,
      source: { kind: 'url', url: artifactUrl(art.url) }, prerendered: true, mapping,
      legend: [{ label: 'Low', color: '#00008f' }, { label: 'High', color: '#8f0000' }],
      blendImageUrl: a.artifacts.attribution_blend ? artifactUrl(a.artifacts.attribution_blend.url) : undefined,
      boxesImageUrl: a.artifacts.attribution_boxes ? artifactUrl(a.artifacts.attribution_boxes.url) : undefined,
      camRegions: a.attribution_regions,
      createdAt: completedAt,
    }
  }
  if (key === 'vessels') {
    return {
      id: `art_${job.id}_${image.id}_vessels`, imageId: image.id, jobId: job.id, type: 'vessel_mask', provenance: 'model',
      method: `U-Net vessel segmentation (DRIVE) · ${a.vessels?.version ?? ''} · vessel density ${((a.vessels?.vessel_density ?? 0) * 100).toFixed(1)}% of field`,
      source: { kind: 'url', url: artifactUrl(art.url) }, prerendered: true, mapping,
      legend: [{ label: 'Retinal vessel (model)', color: '#B9D4FF' }],
      createdAt: completedAt,
    }
  }
  return {
    id: `art_${job.id}_${image.id}_lesions`, imageId: image.id, jobId: job.id, type: 'lesion_mask', provenance: 'model',
    method: `ResNet34 U-Net lesion segmentation (IDRiD) · ${a.lesions?.version ?? ''}`,
    source: { kind: 'url', url: artifactUrl(art.url) }, prerendered: true, mapping,
    legend: (a.lesions?.legend ?? []).map((l) => ({ label: l.label, color: l.color })),
    boxes: (a.lesions?.boxes ?? []).map((b) => ({ ...b, color: a.lesions?.legend.find((l) => l.class === b.class)?.color ?? '#ffffff' })),
    boxesImageUrl: a.artifacts.boxes_image ? artifactUrl(a.artifacts.boxes_image.url) : undefined,
    createdAt: completedAt,
  }
}

export class ModelScreeningApi implements ScreeningApi {
  readonly mode: DataMode = 'demo'

  catalog(): ModelCatalogEntry[] {
    return MODULE_KEYS.map((module) => ({ module, name: module, version: 'from service', status: 'connected', note: 'Reported by the GlucoIris inference service.' }))
  }

  async startAnalysis(input: { encounterId: string; images: EyeImage[]; idempotencyKey: string; attempt: number }): Promise<AnalysisJob> {
    const now = new Date().toISOString()
    const job: AnalysisJob = {
      id: uid('job'), encounterId: input.encounterId, idempotencyKey: input.idempotencyKey,
      imageIds: input.images.map((i) => i.id), createdAt: now, attempt: input.attempt, mode: 'demo', modules: {},
    }
    const run: PendingRun = { started: Date.now(), results: {} }
    runs.set(job.id, run)
    for (const img of input.images) {
      job.modules[img.id] = Object.fromEntries(MODULE_KEYS.map((k) => [k, { status: 'processing', progress: 0, updatedAt: now }])) as Record<ModuleKey, ModuleState>
      run.results[img.id] = { status: 'processing' }
      imageBlob(img)
        .then(serviceAnalyze)
        .then((data) => (run.results[img.id] = { status: 'done', data }))
        .catch((e) => (run.results[img.id] = { status: 'error', error: (e as Error).message }))
    }
    return job
  }

  async getJob(job: AnalysisJob, images: EyeImage[]): Promise<JobSnapshot> {
    const run = runs.get(job.id)
    const classifications: Classification[] = []
    const artifacts: EvidenceArtifact[] = []
    const modules: AnalysisJob['modules'] = {}
    let done = true
    for (const imageId of job.imageIds) {
      const image = images.find((i) => i.id === imageId)
      if (!image) continue
      const r = run?.results[imageId]
      const updatedAt = new Date().toISOString()
      if (!r) {
        // Page was reloaded mid-analysis: the request is gone — report it, never guess.
        const prev = job.modules[imageId]
        const settled = prev && MODULE_KEYS.every((k) => prev[k].status !== 'processing' && prev[k].status !== 'queued')
        modules[imageId] = settled
          ? prev
          : (Object.fromEntries(MODULE_KEYS.map((k) => [k, { status: 'failed', progress: 1, message: 'Analysis was interrupted (page reloaded). Retry the analysis.', updatedAt }])) as Record<ModuleKey, ModuleState>)
        continue
      }
      if (r.status === 'processing') {
        done = false
        const elapsed = (Date.now() - (run?.started ?? Date.now())) / 1000
        modules[imageId] = Object.fromEntries(MODULE_KEYS.map((k) => [k, { status: 'processing', progress: Math.min(0.92, elapsed / 12), updatedAt }])) as Record<ModuleKey, ModuleState>
        continue
      }
      if (r.status === 'error') {
        modules[imageId] = Object.fromEntries(MODULE_KEYS.map((k) => [k, { status: 'failed', progress: 1, message: r.error, updatedAt }])) as Record<ModuleKey, ModuleState>
        continue
      }
      const a = r.data!
      const completedAt = updatedAt
      const st = (k: ModuleKey): ModuleState => {
        const m = a.modules[k]
        return {
          status: m.status === 'completed' ? 'completed' : m.status === 'failed' ? 'failed' : 'unavailable',
          progress: 1,
          message: m.message,
          provenance: m.status === 'completed' ? 'model' : undefined,
          version: k === 'dr_binary' ? a.dr_binary?.model_version : k === 'classification' || k === 'attribution' ? a.classification?.model_version : k === 'vessels' ? a.vessels?.version : a.lesions?.version,
          updatedAt,
        }
      }
      modules[imageId] = { dr_binary: st('dr_binary'), classification: st('classification'), attribution: st('attribution'), lesions: st('lesions'), vessels: st('vessels') }
      if (a.classification) {
        const c = a.classification
        const cls = buildClassification(image, job, c.probabilities, 'model', {
          modelId: c.model_name,
          modelVersion: c.model_version,
          preprocessing: c.preprocessing,
          threshold: `referable threshold ${c.referable_threshold.toFixed(2)}`,
          referableThreshold: c.referable_threshold,
          completedAt,
        })
        classifications.push({ ...cls, determinable: c.determinable, calibration: c.calibration === 'temperature-scaled' ? 'calibrated' : 'uncalibrated' })
      }
      for (const k of ['gradcam_b4', 'attribution', 'vessels', 'lesions'] as const) {
        const art = artifactFor(image, job, a, k, completedAt)
        if (art) artifacts.push(art)
      }
    }
    return { job: { ...job, modules }, classifications, artifacts, done }
  }
}

/**
 * Picks the inference service when it is reachable, otherwise the demo service.
 * Checked per analysis so starting the backend later needs no reload.
 */
class AutoScreeningApi implements ScreeningApi {
  readonly mode: DataMode = 'demo'
  private demo = new DemoScreeningApi()
  private model = new ModelScreeningApi()
  private byJob = new Map<string, ScreeningApi>()

  catalog() {
    return this.demo.catalog()
  }

  async startAnalysis(input: { encounterId: string; images: EyeImage[]; idempotencyKey: string; attempt: number }) {
    const health = await serviceHealth(true)
    const api = health ? this.model : this.demo
    const job = await api.startAnalysis(input)
    this.byJob.set(job.id, api)
    return job
  }

  getJob(job: AnalysisJob, images: EyeImage[]) {
    return (this.byJob.get(job.id) ?? this.demo).getJob(job, images)
  }
}

export const screeningApi: ScreeningApi = new AutoScreeningApi()
