import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type {
  AnalysisJob,
  AuditEvent,
  ClinicalReview,
  Classification,
  Clinician,
  DataMode,
  Encounter,
  EncounterStatus,
  EvidenceArtifact,
  EyeImage,
  Laterality,
  Patient,
  QualityResult,
  Report,
  ReportSnapshot,
  Session,
} from '../types/domain'
import { nowIso, uid } from '../lib/util'
import type { JobSnapshot } from '../services/screeningApi'

/**
 * Demo persistence layer. Holds SYNTHETIC demo records in browser storage only
 * (spec §13). Real deployments keep records server-side behind authorisation.
 */
export interface DbState {
  session: Session | null
  seeded: boolean
  patients: Patient[]
  encounters: Encounter[]
  images: EyeImage[]
  quality: QualityResult[]
  jobs: AnalysisJob[]
  classifications: Classification[]
  artifacts: EvidenceArtifact[]
  reviews: ClinicalReview[]
  reports: Report[]
  audit: AuditEvent[]
}

interface Actions {
  signInDemo: (clinician: Clinician) => void
  signOut: () => void
  touchSession: () => void
  addPatient: (p: Omit<Patient, 'id' | 'createdAt' | 'mode'>) => Patient
  updatePatient: (id: string, patch: Partial<Patient>) => void
  createEncounter: (input: Omit<Encounter, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'mode' | 'notScreened'>) => Encounter
  setEncounterStatus: (id: string, status: EncounterStatus) => void
  setNotScreened: (id: string, eye: Laterality, reason: string | null) => void
  addImage: (img: Omit<EyeImage, 'id' | 'status'>) => EyeImage
  removeImage: (id: string) => void
  saveQuality: (q: Omit<QualityResult, 'id'>) => QualityResult
  overrideQuality: (qualityId: string, reason: string) => void
  addJob: (job: AnalysisJob) => void
  applySnapshot: (snap: JobSnapshot) => void
  saveReview: (r: Omit<ClinicalReview, 'id' | 'savedAt'>) => ClinicalReview
  finalizeReport: (encounterId: string, reason?: string) => Report | null
  log: (action: string, entity: string, entityId: string, detail?: string) => void
  replaceAll: (data: Partial<DbState>) => void
  resetDemo: () => void
}

export type Store = DbState & Actions

const empty: DbState = {
  session: null,
  seeded: false,
  patients: [],
  encounters: [],
  images: [],
  quality: [],
  jobs: [],
  classifications: [],
  artifacts: [],
  reviews: [],
  reports: [],
  audit: [],
}

const SESSION_HOURS = 8

export const useStore = create<Store>()(
  persist(
    (set, get) => {
      const actor = () => get().session?.clinician.displayName ?? 'system'
      const mode = (): DataMode => get().session?.mode ?? 'demo'
      const log: Actions['log'] = (action, entity, entityId, detail) =>
        set((s) => ({ audit: [{ id: uid('aud'), at: nowIso(), actor: actor(), action, entity, entityId, detail }, ...s.audit].slice(0, 500) }))

      return {
        ...empty,
        log,

        signInDemo: (clinician) => {
          const now = new Date()
          set({
            session: {
              clinician,
              mode: 'demo',
              startedAt: now.toISOString(),
              expiresAt: new Date(now.getTime() + SESSION_HOURS * 3600_000).toISOString(),
            },
          })
          log('signed_in', 'session', clinician.id, 'Demo access')
        },
        signOut: () => {
          log('signed_out', 'session', get().session?.clinician.id ?? '-')
          set({ session: null })
        },
        touchSession: () => {
          const s = get().session
          if (!s) return
          set({ session: { ...s, expiresAt: new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString() } })
        },

        addPatient: (p) => {
          const patient: Patient = { ...p, id: uid('pat'), createdAt: nowIso(), mode: mode() }
          set((s) => ({ patients: [patient, ...s.patients] }))
          log('registered', 'patient', patient.id, patient.clinicPatientId)
          return patient
        },
        updatePatient: (id, patch) => {
          set((s) => ({ patients: s.patients.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
          log('updated', 'patient', id)
        },

        createEncounter: (input) => {
          // Idempotent: a retried submit with the same key returns the original encounter.
          const existing = get().encounters.find((e) => e.idempotencyKey === input.idempotencyKey)
          if (existing) return existing
          const enc: Encounter = {
            ...input,
            id: uid('enc'),
            status: 'acquisition',
            notScreened: {},
            createdAt: nowIso(),
            updatedAt: nowIso(),
            mode: mode(),
          }
          set((s) => ({ encounters: [enc, ...s.encounters] }))
          log('created', 'encounter', enc.id, `eyes: ${input.eyesPlanned.join(', ')}`)
          return enc
        },
        setEncounterStatus: (id, status) =>
          set((s) => ({ encounters: s.encounters.map((e) => (e.id === id ? { ...e, status, updatedAt: nowIso() } : e)) })),
        setNotScreened: (id, eye, reason) => {
          set((s) => ({
            encounters: s.encounters.map((e) => {
              if (e.id !== id) return e
              const notScreened = { ...e.notScreened }
              if (reason) notScreened[eye] = reason
              else delete notScreened[eye]
              return { ...e, notScreened, updatedAt: nowIso() }
            }),
          }))
          log(reason ? 'marked_not_screened' : 'cleared_not_screened', 'encounter', id, `${eye}${reason ? `: ${reason}` : ''}`)
        },

        addImage: (img) => {
          const image: EyeImage = { ...img, id: uid('img'), status: 'active' }
          set((s) => ({
            images: [
              image,
              ...s.images.map((i) =>
                i.encounterId === img.encounterId && i.laterality === img.laterality && i.status === 'active'
                  ? { ...i, status: 'replaced' as const }
                  : i,
              ),
            ],
            // A changed image invalidates downstream steps for this encounter.
            encounters: s.encounters.map((e) => (e.id === img.encounterId && e.status !== 'acquisition' ? { ...e, status: 'acquisition' as const, updatedAt: nowIso() } : e)),
          }))
          log('image_added', 'image', image.id, `${img.laterality} · ${img.origin} · ${img.fileName}`)
          return image
        },
        removeImage: (id) => {
          const encId = get().images.find((i) => i.id === id)?.encounterId
          set((s) => ({
            images: s.images.map((i) => (i.id === id ? { ...i, status: 'removed' as const } : i)),
            encounters: s.encounters.map((e) => (e.id === encId && e.status !== 'acquisition' ? { ...e, status: 'acquisition' as const, updatedAt: nowIso() } : e)),
          }))
          log('image_removed', 'image', id)
        },

        saveQuality: (q) => {
          const result: QualityResult = { ...q, id: uid('qa') }
          set((s) => ({ quality: [result, ...s.quality] }))
          log('quality_assessed', 'image', q.imageId, q.outcome)
          return result
        },
        overrideQuality: (qualityId, reason) => {
          set((s) => ({
            quality: s.quality.map((q) =>
              q.id === qualityId && q.outcome === 'borderline' ? { ...q, override: { by: actor(), at: nowIso(), reason } } : q,
            ),
          }))
          log('borderline_accepted', 'quality', qualityId, reason)
        },

        addJob: (job) => {
          set((s) => ({ jobs: [job, ...s.jobs.filter((j) => j.id !== job.id)] }))
          log('analysis_started', 'encounter', job.encounterId, `job ${job.id} · attempt ${job.attempt}`)
        },
        applySnapshot: ({ job, classifications, artifacts }) =>
          set((s) => {
            // Results are keyed by immutable image + job IDs; anything for an image
            // no longer in this job is ignored so retries cannot cross-attach.
            const valid = (x: { imageId: string; jobId: string }) => x.jobId === job.id && job.imageIds.includes(x.imageId)
            const cls = classifications.filter(valid)
            const arts = artifacts.filter(valid)
            const clsIds = new Set(cls.map((c) => c.id))
            const artIds = new Set(arts.map((a) => a.id))
            return {
              jobs: s.jobs.map((j) => (j.id === job.id ? { ...j, modules: job.modules } : j)),
              classifications: [...cls, ...s.classifications.filter((c) => !clsIds.has(c.id))],
              artifacts: [...arts, ...s.artifacts.filter((a) => !artIds.has(a.id))],
            }
          }),

        saveReview: (r) => {
          const existing = get().reviews.find((x) => x.encounterId === r.encounterId)
          const review: ClinicalReview = { ...r, id: existing?.id ?? uid('rev'), savedAt: nowIso() }
          set((s) => ({ reviews: [review, ...s.reviews.filter((x) => x.encounterId !== r.encounterId)] }))
          log('review_saved', 'encounter', r.encounterId)
          return review
        },

        finalizeReport: (encounterId, reason) => {
          const s = get()
          const encounter = s.encounters.find((e) => e.id === encounterId)
          const review = s.reviews.find((r) => r.encounterId === encounterId)
          if (!encounter || !review) return null
          const prior = s.reports.filter((r) => r.encounterId === encounterId)
          const report: Report = {
            id: uid('rep'),
            encounterId,
            revision: prior.length + 1,
            status: 'final',
            finalizedBy: actor(),
            finalizedAt: nowIso(),
            revisionReason: prior.length ? reason : undefined,
            mode: encounter.mode,
            snapshot: buildSnapshot(s, encounterId, review),
          }
          set((st) => ({
            reports: [report, ...st.reports.map((r) => (r.encounterId === encounterId && r.status === 'final' ? { ...r, status: 'superseded' as const } : r))],
            encounters: st.encounters.map((e) => (e.id === encounterId ? { ...e, status: 'reviewed', updatedAt: nowIso() } : e)),
          }))
          log(prior.length ? 'report_revised' : 'report_finalised', 'encounter', encounterId, `revision ${report.revision}${reason ? ` · ${reason}` : ''}`)
          return report
        },

        replaceAll: (data) => set((s) => ({ ...s, ...data })),
        resetDemo: () => set((s) => ({ ...empty, session: s.session })),
      }
    },
    {
      name: 'glucoiris-demo-db',
      // v2: one retinal fundus image per screening — older two-eye demo data is reseeded.
      version: 2,
      migrate: (persisted, version) => {
        const old = persisted as Partial<DbState>
        return (version < 2 ? { ...empty, session: old.session ?? null } : old) as Store
      },
      storage: createJSONStorage(() => localStorage),
    },
  ),
)

// ---------------------------------------------------------------------------
// Selectors (pure functions over state)
// ---------------------------------------------------------------------------

/** Active images for an encounter (one retinal fundus image; older records ordered by slot). */
export const activeImages = (s: DbState, encounterId: string) =>
  s.images
    .filter((i) => i.encounterId === encounterId && i.status === 'active')
    .sort((a, b) => (a.laterality === b.laterality ? 0 : a.laterality === 'right' ? -1 : 1))

export const latestQuality = (s: DbState, imageId: string) =>
  s.quality.filter((q) => q.imageId === imageId).sort((a, b) => b.assessedAt.localeCompare(a.assessedAt))[0]

export const latestJob = (s: DbState, encounterId: string) =>
  s.jobs.filter((j) => j.encounterId === encounterId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]

export const latestReport = (s: DbState, encounterId: string) =>
  s.reports.filter((r) => r.encounterId === encounterId).sort((a, b) => b.revision - a.revision)[0]

export const encountersFor = (s: DbState, patientId: string) =>
  s.encounters.filter((e) => e.patientId === patientId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))

export function buildSnapshot(s: DbState, encounterId: string, review: ClinicalReview): ReportSnapshot {
  const encounter = s.encounters.find((e) => e.id === encounterId)!
  const patient = s.patients.find((p) => p.id === encounter.patientId)!
  const images = activeImages(s, encounterId)
  const job = latestJob(s, encounterId)
  return {
    patient,
    encounter,
    images,
    quality: images.map((i) => latestQuality(s, i.id)).filter((q): q is QualityResult => !!q),
    classifications: job ? s.classifications.filter((c) => c.jobId === job.id) : [],
    artifacts: job ? s.artifacts.filter((a) => a.jobId === job.id) : [],
    modules: job?.modules ?? {},
    review,
  }
}

/** Eligible for analysis: acceptable, or borderline explicitly accepted by a clinician. */
export const isAnalysable = (q?: QualityResult) => !!q && (q.outcome === 'acceptable' || (q.outcome === 'borderline' && !!q.override))

export function patientStatus(s: DbState, patientId: string): { label: string; tone: 'neutral' | 'info' | 'warn' | 'bad' | 'ok' } {
  const encs = encountersFor(s, patientId)
  if (!encs.length) return { label: 'No screenings yet', tone: 'neutral' }
  const last = encs[0]
  if (last.status === 'awaiting_review') return { label: 'Awaiting review', tone: 'info' }
  if (last.status === 'acquisition' || last.status === 'quality' || last.status === 'analysis') return { label: 'Screening in progress', tone: 'warn' }
  const rep = latestReport(s, last.id)
  const fu = rep?.snapshot.review.followUp
  if (fu === 'refer_urgent') return { label: 'Urgent referral', tone: 'bad' }
  if (fu === 'refer_routine' || fu === 'further_assessment') return { label: 'Referred', tone: 'warn' }
  if (fu === 'recapture') return { label: 'Recapture needed', tone: 'warn' }
  return { label: 'Reviewed', tone: 'ok' }
}
