import type {
  ClinicalReview,
  ClinicianGrade,
  Encounter,
  EyeImage,
  FollowUp,
  Laterality,
  Patient,
  QualityResult,
  Report,
} from '../types/domain'
import { fixtureById } from './fixtures'
import { intakeFixture } from '../services/imageIntake'
import { runQuality } from '../services/qualityService'
import { DemoScreeningApi } from '../services/screeningApi'
import { uid } from '../lib/util'
import { isAnalysable, type DbState } from '../store/store'

/**
 * Synthetic demo patients. Names and histories are invented. Their "history"
 * reuses dataset images from different, unrelated subjects — so changes between
 * visits are NOT real disease progression in one person.
 */
interface EncounterPlan {
  date: string
  eyes: Partial<Record<Laterality, string>>
  notScreened?: Partial<Record<Laterality, string>>
  state: 'final' | 'awaiting_review' | 'quality'
  review?: { grades: Partial<Record<Laterality, ClinicianGrade>>; followUp: FollowUp; notes: string; dme?: Partial<Record<Laterality, ClinicalReview['eyes']['left']['dme']>> }
}

interface PatientPlan {
  patient: Omit<Patient, 'id' | 'createdAt' | 'mode'>
  encounters: EncounterPlan[]
}

const PLANS: PatientPlan[] = [
  {
    patient: { clinicPatientId: 'GI-1042', name: 'Asha Raman', dateOfBirth: '1968-02-14', sex: 'female', diabetesType: 'type2', diabetesSinceYear: 2012, hba1c: { value: 8.4, measuredOn: '2026-09-02' }, symptoms: 'Occasional blurred near vision', notes: 'On metformin and gliclazide.' },
    encounters: [
      { date: '2025-04-10T09:20:00Z', eyes: { right: 'idrid-118' }, state: 'final', review: { grades: { right: 0 }, followUp: 'routine_12m', notes: 'No retinopathy seen.' } },
      { date: '2026-03-18T10:05:00Z', eyes: { right: 'idrid-105' }, state: 'final', review: { grades: { right: 1 }, followUp: 'repeat_6m', notes: 'Scattered microaneurysms. Optimise glycaemic control; repeat in 6 months.' } },
      { date: '2026-10-09T08:40:00Z', eyes: { right: 'idrid-029' }, state: 'awaiting_review' },
    ],
  },
  {
    patient: { clinicPatientId: 'GI-0877', name: 'Daniel Okafor', dateOfBirth: '1962-07-03', sex: 'male', diabetesType: 'type2', diabetesSinceYear: 2008, hba1c: { value: 9.1, measuredOn: '2026-08-21' }, symptoms: 'Floaters for two weeks' },
    encounters: [
      { date: '2025-08-22T11:15:00Z', eyes: { right: 'idrid-001' }, state: 'final', review: { grades: { right: 3 }, followUp: 'refer_urgent', notes: 'Severe NPDR with suspected macular oedema. Urgent ophthalmology referral made.', dme: { right: 'suspected' } } },
      { date: '2026-10-11T14:30:00Z', eyes: { right: 'idrid-008' }, state: 'awaiting_review' },
    ],
  },
  {
    patient: { clinicPatientId: 'GI-1311', name: 'Meera Pillai', dateOfBirth: '1985-11-29', sex: 'female', diabetesType: 'type1', diabetesSinceYear: 2001, hba1c: { value: 7.2, measuredOn: '2026-07-15' } },
    encounters: [{ date: '2026-10-12T09:10:00Z', eyes: { right: 'idrid-012' }, state: 'awaiting_review' }],
  },
  {
    patient: { clinicPatientId: 'GI-1520', name: 'Tomás Herrera', dateOfBirth: '1974-05-08', sex: 'male', diabetesType: 'type2', diabetesSinceYear: 2019, hba1c: { value: 7.9, measuredOn: '2026-09-28' }, notes: 'Small pupils; dilation may be needed.' },
    encounters: [{ date: '2026-10-13T08:05:00Z', eyes: { right: 'degraded-blur' }, state: 'quality' }],
  },
  {
    patient: { clinicPatientId: 'GI-0634', name: 'Samuel Mensah', dateOfBirth: '1956-01-19', sex: 'male', diabetesType: 'type2', diabetesSinceYear: 2004, hba1c: { value: 6.9, measuredOn: '2026-05-30' } },
    encounters: [
      { date: '2026-06-04T13:45:00Z', eyes: { right: 'drive-23' }, state: 'final', review: { grades: { right: 0 }, followUp: 'routine_12m', notes: 'No retinopathy seen. Image resolution below recommended; accepted as borderline.' } },
    ],
  },
  {
    patient: { clinicPatientId: 'GI-1588', name: 'Grace Liu', dateOfBirth: '1979-09-12', sex: 'female', diabetesType: 'gestational', diabetesSinceYear: 2024, notes: 'Newly registered — no screenings yet.' },
    encounters: [],
  },
]

const CLINICIAN = 'Dr. Demo Clinician'
const OPERATOR = 'Demo Operator'

export async function buildSeed(): Promise<Partial<DbState>> {
  const api = new DemoScreeningApi()
  const out: Required<Pick<DbState, 'patients' | 'encounters' | 'images' | 'quality' | 'jobs' | 'classifications' | 'artifacts' | 'reviews' | 'reports' | 'audit'>> = {
    patients: [], encounters: [], images: [], quality: [], jobs: [], classifications: [], artifacts: [], reviews: [], reports: [], audit: [],
  }

  for (const plan of PLANS) {
    const firstDate = plan.encounters[0]?.date ?? '2026-10-01T09:00:00Z'
    const patient: Patient = { ...plan.patient, id: uid('pat'), createdAt: firstDate, mode: 'demo' }
    out.patients.push(patient)

    for (const ep of plan.encounters) {
      const planned = (Object.keys(ep.eyes) as Laterality[])
      const enc: Encounter = {
        id: uid('enc'),
        patientId: patient.id,
        operator: OPERATOR,
        consent: { obtained: true, method: 'verbal', recordedBy: OPERATOR, recordedAt: ep.date },
        eyesPlanned: [...planned, ...((Object.keys(ep.notScreened ?? {}) as Laterality[]))],
        notScreened: ep.notScreened ?? {},
        status: ep.state === 'final' ? 'reviewed' : ep.state,
        createdAt: ep.date,
        updatedAt: ep.date,
        mode: 'demo',
        idempotencyKey: uid('idem'),
      }
      out.encounters.push(enc)

      const images: EyeImage[] = []
      const quality: QualityResult[] = []
      for (const eye of planned) {
        const fx = fixtureById(ep.eyes[eye]!)!
        const img: EyeImage = { ...(await intakeFixture(fx, enc.id, eye, ep.date)), id: uid('img'), status: 'active' }
        images.push(img)
        const q = await runQuality(img.id, fx.image)
        const accepted = ep.state !== 'quality' && q.outcome === 'borderline'
        quality.push({
          ...q,
          id: uid('qa'),
          assessedAt: ep.date,
          ...(accepted ? { override: { by: CLINICIAN, at: ep.date, reason: 'Borderline (resolution) accepted; recapture not possible on this visit.' } } : {}),
        })
      }
      out.images.push(...images)
      out.quality.push(...quality)

      if (ep.state === 'quality') continue

      const analysable = images.filter((i) => isAnalysable(quality.find((q) => q.imageId === i.id)))
      const job = await api.startAnalysis({ encounterId: enc.id, images: analysable, idempotencyKey: uid('idem'), attempt: 1 })
      job.createdAt = new Date(new Date(ep.date).getTime() + 60_000).toISOString()
      const snap = await api.getJob(job, analysable)
      out.jobs.push(snap.job)
      out.classifications.push(...snap.classifications)
      out.artifacts.push(...snap.artifacts)

      if (ep.state === 'final' && ep.review) {
        const eyeInterp = (eye: Laterality) => {
          const g = ep.review!.grades[eye] ?? null
          const cls = snap.classifications.find((c) => images.find((i) => i.id === c.imageId)?.laterality === eye)
          return {
            clinicianGrade: g,
            agreesWithModel: cls && typeof g === 'number' ? cls.predictedGrade === g : null,
            dme: ep.review!.dme?.[eye] ?? (g === 'not_screened' ? 'not_assessed' : 'none'),
            findings: '',
          } as ClinicalReview['eyes']['left']
        }
        const reviewedAt = new Date(new Date(ep.date).getTime() + 3600_000 * 26).toISOString()
        const review: ClinicalReview = {
          id: uid('rev'),
          encounterId: enc.id,
          reviewer: CLINICIAN,
          eyes: { right: eyeInterp('right'), left: eyeInterp('left') },
          followUp: ep.review.followUp,
          notes: ep.review.notes,
          savedAt: reviewedAt,
        }
        out.reviews.push(review)
        const report: Report = {
          id: uid('rep'),
          encounterId: enc.id,
          revision: 1,
          status: 'final',
          finalizedBy: CLINICIAN,
          finalizedAt: reviewedAt,
          mode: 'demo',
          snapshot: { patient, encounter: enc, images, quality, classifications: snap.classifications, artifacts: snap.artifacts, modules: snap.job.modules, review },
        }
        out.reports.push(report)
      }
    }
  }

  out.audit.push({ id: uid('aud'), at: new Date().toISOString(), actor: 'system', action: 'demo_seeded', entity: 'system', entityId: '-', detail: `${out.patients.length} synthetic patients` })
  return { ...out, seeded: true }
}
