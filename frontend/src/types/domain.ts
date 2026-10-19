// Core GlucoIris domain types. Mirrors the entities in GlucoIris_Project.md §12.

export type DataMode = 'demo' | 'real'
export type Laterality = 'right' | 'left'
export const LATERALITIES: Laterality[] = ['right', 'left']

export type Grade = 0 | 1 | 2 | 3 | 4

export interface Clinician {
  id: string
  displayName: string
  organisation: string
  role: 'clinician' | 'operator'
  email: string
}

export interface Session {
  clinician: Clinician
  mode: DataMode
  startedAt: string
  expiresAt: string
}

export type DiabetesType = 'type1' | 'type2' | 'gestational' | 'other' | 'unknown'

export interface Patient {
  id: string
  clinicPatientId: string
  name: string
  dateOfBirth?: string
  age?: number
  sex?: 'female' | 'male' | 'other' | 'undisclosed'
  diabetesType?: DiabetesType
  diabetesSinceYear?: number
  hba1c?: { value: number; measuredOn: string }
  symptoms?: string
  notes?: string
  createdAt: string
  mode: DataMode
}

export type EncounterStatus =
  | 'acquisition'
  | 'quality'
  | 'analysis'
  | 'awaiting_review'
  | 'reviewed'

export interface ConsentRecord {
  obtained: boolean
  method: 'verbal' | 'written' | 'programme_policy'
  recordedBy: string
  recordedAt: string
}

export interface Encounter {
  id: string
  patientId: string
  operator: string
  consent: ConsentRecord
  eyesPlanned: Laterality[]
  notScreened: Partial<Record<Laterality, string>>
  status: EncounterStatus
  device?: string
  createdAt: string
  updatedAt: string
  mode: DataMode
  idempotencyKey: string
}

export type ImageSource =
  | { kind: 'fixture'; fixtureId: string; url: string }
  | { kind: 'blob'; blobKey: string }

export interface EyeImage {
  id: string
  encounterId: string
  laterality: Laterality
  origin: 'upload' | 'camera' | 'fixture'
  source: ImageSource
  fileName: string
  mime: string
  width: number
  height: number
  bytes: number
  checksum: string
  acquiredAt: string
  device?: string
  status: 'active' | 'replaced' | 'removed'
}

export type QualityOutcome = 'acceptable' | 'borderline' | 'ungradeable' | 'unavailable'
export type DimensionKey =
  | 'validity'
  | 'focus'
  | 'sharpness'
  | 'brightness'
  | 'contrast'
  | 'illumination'
  | 'glare'
  | 'noise'
  | 'field'
  | 'resolution'
export type DimensionStatus = 'pass' | 'warn' | 'fail'

export interface QualityDimension {
  key: DimensionKey
  label: string
  status: DimensionStatus
  detail: string
  value?: number
  /** 0–100, when the quality service provides it */
  score?: number
}

export interface QualityResult {
  id: string
  imageId: string
  version: string
  assessedAt: string
  outcome: QualityOutcome
  dimensions: QualityDimension[]
  reasons: string[]
  guidance: string[]
  /** Overall 0–100 score from the quality service */
  score?: number
  override?: { by: string; at: string; reason: string }
}

export type ModuleKey = 'dr_binary' | 'classification' | 'attribution' | 'lesions' | 'vessels'
export const MODULE_KEYS: ModuleKey[] = ['dr_binary', 'classification', 'lesions', 'vessels']
export type ModuleStatus = 'unavailable' | 'queued' | 'processing' | 'completed' | 'failed'

export interface ModuleState {
  status: ModuleStatus
  progress: number
  message?: string
  version?: string
  provenance?: 'model' | 'simulated' | 'reference_annotation'
  updatedAt: string
}

export interface AnalysisJob {
  id: string
  encounterId: string
  idempotencyKey: string
  imageIds: string[]
  createdAt: string
  attempt: number
  mode: DataMode
  modules: Record<string, Record<ModuleKey, ModuleState>>
}

export interface Classification {
  id: string
  imageId: string
  jobId: string
  modelId: string
  modelVersion: string
  preprocessingVersion: string
  thresholdVersion: string
  mode: DataMode
  provenance: 'model' | 'simulated'
  probabilities: [number, number, number, number, number]
  predictedGrade: Grade
  anyDrScore: number
  referableDrScore: number
  referableThreshold: number
  referableFlag: boolean
  calibration: 'uncalibrated' | 'calibrated'
  determinable: boolean
  createdAt: string
}

export type ArtifactType = 'attribution' | 'gradcam_b4' | 'lesion_mask' | 'vessel_mask'

export interface EvidenceArtifact {
  id: string
  imageId: string
  jobId: string
  type: ArtifactType
  provenance: 'model' | 'simulated' | 'reference_annotation'
  method: string
  /** URL (fixture) or a generator seed for simulated maps */
  source: { kind: 'url'; url: string } | { kind: 'generated'; seed: number }
  /** Coordinate mapping back to the source image (artifact covers the full frame) */
  mapping: { sourceWidth: number; sourceHeight: number; artifactWidth: number; artifactHeight: number; transform: 'resize' }
  legend: { label: string; color: string }[]
  /** Overlay is already a coloured RGBA image (model output) — draw as-is */
  prerendered?: boolean
  /** Lesion bounding boxes in source-image pixels */
  boxes?: LesionBox[]
  /** Original image with boxes drawn (for reports) */
  boxesImageUrl?: string
  /** 50/50 original + jet heatmap blend (for reports) */
  blendImageUrl?: string
  /** Grad-CAM regions responsible for the prediction (normalised 0–1 boxes, ranked by heat share) */
  camRegions?: CamRegion[]
  /** Binary screen result carried with its Grad-CAM (EfficientNet-B4) */
  result?: { probability: number; threshold: number; positive: boolean; label: string; task: string; model: string; version: string }
  createdAt: string
}

export interface CamRegion {
  rank: number
  x: number
  y: number
  w: number
  h: number
  /** Highest normalised heat inside the box (0–1) */
  peak: number
  mean: number
  /** Fraction of the total above-threshold heat that falls in this region */
  share: number
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
  color: string
}

export type ClinicianGrade = Grade | 'ungradeable' | 'not_screened'

export type FollowUp =
  | 'routine_12m'
  | 'repeat_6m'
  | 'refer_routine'
  | 'refer_urgent'
  | 'recapture'
  | 'further_assessment'

export interface EyeInterpretation {
  clinicianGrade: ClinicianGrade | null
  agreesWithModel: boolean | null
  dme: 'none' | 'suspected' | 'present' | 'not_assessed'
  findings: string
}

export interface ClinicalReview {
  id: string
  encounterId: string
  reviewer: string
  eyes: Record<Laterality, EyeInterpretation>
  followUp: FollowUp | null
  notes: string
  savedAt: string
}

export interface ReportSnapshot {
  patient: Patient
  encounter: Encounter
  images: EyeImage[]
  quality: QualityResult[]
  classifications: Classification[]
  artifacts: EvidenceArtifact[]
  modules: AnalysisJob['modules']
  review: ClinicalReview
}

export interface Report {
  id: string
  encounterId: string
  revision: number
  status: 'final' | 'superseded'
  finalizedBy: string
  finalizedAt: string
  revisionReason?: string
  mode: DataMode
  snapshot: ReportSnapshot
}

export interface AuditEvent {
  id: string
  at: string
  actor: string
  action: string
  entity: string
  entityId: string
  detail?: string
}

export interface Fixture {
  id: string
  dataset: string
  source: string
  image: string
  thumb: string
  width: number
  height: number
  originalWidth: number
  originalHeight: number
  laterality: Laterality
  lateralitySource: string
  referenceGrade: Grade | null
  referenceDmeRisk: number | null
  scenario: 'standard' | 'blur' | 'underexposed' | 'glare'
  vesselMask: string | null
  note: string | null
}
