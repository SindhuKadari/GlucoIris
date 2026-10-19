import { useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker, useNavigate } from 'react-router-dom'
import { Camera, Cpu, FileCheck2, Save } from 'lucide-react'
import { serviceHealth } from '../services/modelService'
import type { ClinicalReview, EyeInterpretation, FollowUp, Laterality } from '../types/domain'
import { activeImages, latestJob, latestQuality, latestReport, useStore } from '../store/store'
import { EncounterNotFound, ScreeningFrame, ScreeningHeader, StepBar, useEncounterContext } from '../features/screening/common'
import { GradCamPanel } from '../features/viewer/GradCamPanel'
import { LesionPanel } from '../features/viewer/LesionPanel'
import { useT } from '../lib/i18n'
import { Badge, Button, Dialog, Field, Notice, Textarea } from '../components/ui'
import { cx, EYE_LABEL, EYE_SHORT, formatDate, GRADE_LABEL, IMAGE_SLOT, IMAGE_SLOTS } from '../lib/util'

export default function ReviewPage() {
  const { encounter, patient } = useEncounterContext()
  const state = useStore()
  const navigate = useNavigate()
  const t = useT()
  const [eye, setEye] = useState<Laterality>(IMAGE_SLOT)
  const [modelsOnline, setModelsOnline] = useState(false)
  useEffect(() => {
    serviceHealth(true).then((h) => setModelsOnline(h?.modules.dr_binary.status === 'available'))
  }, [])
  // One retinal fundus image per screening; older two-image records still render.
  const EYES: Laterality[] = encounter?.eyesPlanned.length ? encounter.eyesPlanned : IMAGE_SLOTS

  const images = encounter ? activeImages(state, encounter.id) : []
  const job = encounter ? latestJob(state, encounter.id) : undefined
  const existing = state.reviews.find((r) => r.encounterId === encounter?.id)
  const report = encounter ? latestReport(state, encounter.id) : undefined

  const imageFor = (l: Laterality) => images.find((i) => i.laterality === l)
  const qualityFor = (l: Laterality) => (imageFor(l) ? latestQuality(state, imageFor(l)!.id) : undefined)

  const defaults = useMemo((): ClinicalReview['eyes'] => {
    const make = (l: Laterality): EyeInterpretation => {
      if (encounter?.notScreened[l] || !imageFor(l)) return { clinicianGrade: 'not_screened', agreesWithModel: null, dme: 'not_assessed', findings: '' }
      if (qualityFor(l)?.outcome === 'ungradeable') return { clinicianGrade: 'ungradeable', agreesWithModel: null, dme: 'not_assessed', findings: '' }
      return { clinicianGrade: null, agreesWithModel: null, dme: 'not_assessed', findings: '' }
    }
    return { right: make('right'), left: make('left') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounter?.id])

  const [eyes] = useState<ClinicalReview['eyes']>(existing?.eyes ?? defaults)
  const [followUp, setFollowUp] = useState<FollowUp | ''>(existing?.followUp ?? '')
  // Notes are no longer edited on this page; any saved earlier are kept as they are.
  const [notes] = useState(existing?.notes ?? '')
  const [dirty, setDirty] = useState(false)
  const [finalOpen, setFinalOpen] = useState(false)
  const [attest, setAttest] = useState(false)
  const [revReason, setRevReason] = useState('')
  const [savedAt, setSavedAt] = useState<string | null>(existing?.savedAt ?? null)

  useEffect(() => {
    const first = EYES.find((l) => imageFor(l))
    if (first) setEye(first)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounter?.id])

  // Unsaved-changes protection (in-app navigation and tab close).
  const bypass = useRef(false)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => !bypass.current && dirty && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  if (!encounter || !patient) return <EncounterNotFound />

  const save = () => {
    const r = state.saveReview({ encounterId: encounter.id, reviewer: state.session!.clinician.displayName, eyes, followUp: followUp || null, notes })
    setSavedAt(r.savedAt)
    setDirty(false)
    return r
  }

  const finalize = () => {
    save()
    const rep = state.finalizeReport(encounter.id, revReason.trim() || undefined)
    setFinalOpen(false)
    bypass.current = true
    if (rep) navigate(`/screenings/${encounter.id}/report`)
  }

  const requestRecapture = () => {
    setFollowUp('recapture')
    setDirty(true)
    state.log('recapture_requested', 'encounter', encounter.id)
  }

  const img = imageFor(eye)
  const arts = img && job ? state.artifacts.filter((a) => a.imageId === img.id && a.jobId === job.id) : []

  const statusText = dirty
    ? t('Unsaved changes.')
    : report
      ? t('Finalised as revision {rev} by {name}. Further changes create revision {next}.', { rev: report.revision, name: report.finalizedBy, next: report.revision + 1 })
      : savedAt
        ? t('Draft saved {time} — not yet finalised.', { time: formatDate(savedAt, true) })
        : t('Draft — check the Grad-CAM evidence, then finalise the report.')

  const b4Art = arts.find((a) => a.type === 'gradcam_b4')
  const vitArt = arts.find((a) => a.type === 'attribution')
  const lesionArt = arts.find((a) => a.type === 'lesion_mask')
  const b4 = b4Art?.result
  const vit = img && job ? state.classifications.find((c) => c.imageId === img.id && c.jobId === job.id) : undefined

  return (
    <>
    <ScreeningFrame
      header={<ScreeningHeader encounter={encounter} patient={patient} current="review" />}
      bar={
        <StepBar back={{ to: `/screenings/${encounter.id}/analysis`, label: t('Back to analysis') }} status={statusText}>
          <Button size="lg" onClick={save} disabled={!dirty} title={t('Save draft')}>
            <Save size={17} aria-hidden /> <span className="hidden lg:inline">{t('Save draft')}</span>
          </Button>
          <Button size="lg" onClick={requestRecapture} title={t('Request recapture')}>
            <Camera size={17} aria-hidden /> <span className="hidden lg:inline">{t('Request recapture')}</span>
          </Button>
          <Button variant="primary" size="lg" onClick={() => setFinalOpen(true)}>
            <FileCheck2 size={18} aria-hidden /> {report ? t('Finalise revision') : t('Finalise report')}
          </Button>
        </StepBar>
      }
    >
      <div className="flex flex-col gap-4 lg:h-full">
        {modelsOnline && job && !Object.values(job.modules).some((m) => m.dr_binary?.status === 'completed') && images.some((i) => job.imageIds.includes(i.id)) && (
          <Notice tone="info" className="shrink-0" title={t('AI models are available for this screening')}>
            {t('These results came from the demo service. Run the EfficientNet-B4 classifier with Grad-CAM on this image.')}
            <Button
              size="sm"
              variant="primary"
              className="mt-3"
              onClick={() => {
                bypass.current = true
                navigate(`/screenings/${encounter.id}/analysis`, { state: { rerun: true } })
              }}
            >
              <Cpu size={14} aria-hidden /> {t('Run AI models')}
            </Button>
          </Notice>
        )}
        {EYES.length > 1 && (
          <div className="flex shrink-0 items-center gap-1" role="tablist" aria-label={t('Image')}>
            {EYES.map((l) => (
              <button
                key={l}
                role="tab"
                aria-selected={eye === l}
                onClick={() => setEye(l)}
                className={cx('flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition-colors', eye === l ? 'border-electric bg-electric/15 font-semibold text-ink' : 'border-line text-haze hover:text-ink')}
              >
                <span className="font-mono text-cyan">{EYE_SHORT[l]}</span> {t(EYE_LABEL[l].split(' (')[0])}
                {!imageFor(l) && <Badge>{t('Not screened')}</Badge>}
              </button>
            ))}
          </div>
        )}
        {img ? (
          <div className="grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-2 xl:grid-cols-3">
            <GradCamPanel
              title="Grad-CAM · EfficientNet-B4"
              badge={b4 && <Badge tone={b4.positive ? 'warn' : 'ok'}>{t(b4.label)} · P(DR) {b4.probability.toFixed(3)}</Badge>}
              image={img}
              artifact={b4Art}
              emptyMessage={t(job?.modules[img.id]?.dr_binary?.message ?? 'EfficientNet-B4 Grad-CAM is not available for this screening.')}
            />
            <GradCamPanel
              title="Grad-CAM · ViT"
              badge={vit && <Badge tone={vit.predictedGrade >= 2 ? 'warn' : 'info'}>{vit.determinable ? t(GRADE_LABEL[vit.predictedGrade]) : `${t('Uncertain')} · ${t(GRADE_LABEL[vit.predictedGrade])}`} · {Math.round(Math.max(...vit.probabilities) * 100)}%</Badge>}
              image={img}
              artifact={vitArt}
              emptyMessage={t(job?.modules[img.id]?.classification?.message ?? 'ViT Grad-CAM is not available for this screening.')}
            />
            <LesionPanel image={img} artifact={lesionArt} emptyMessage={t(job?.modules[img.id]?.lesions?.message ?? 'Lesion segmentation is not available for this screening.')} />
          </div>
        ) : (
          <div className="flex aspect-[4/3] items-center justify-center rounded-xl border border-dashed border-line text-base text-haze">{t('No retinal fundus image')}</div>
        )}
      </div>
    </ScreeningFrame>

      <Dialog
        open={finalOpen}
        onClose={() => setFinalOpen(false)}
        title={report ? t('Finalise revision {n}', { n: report.revision + 1 }) : t('Finalise report')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFinalOpen(false)}>{t('Cancel')}</Button>
            <Button variant="primary" disabled={!attest || (!!report && revReason.trim().length < 5)} onClick={finalize}>
              {t('Sign & finalise')}
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-base">
          {report && (
            <Field label={t('Reason for revision')} required htmlFor="rr">
              <Textarea id="rr" value={revReason} onChange={(e) => setRevReason(e.target.value)} placeholder={t('e.g. Corrected the image or the model result after second review.')} className="min-h-[60px]" />
            </Field>
          )}
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[#245CEB]" />
            {t('I have reviewed the image and the available results, and I approve this report.')}
          </label>
          {encounter.mode === 'demo' && <p className="text-sm text-cyan">{t('This is a demonstration report and will be watermarked “DEMONSTRATION — NOT FOR CLINICAL USE”.')}</p>}
        </div>
      </Dialog>

      <Dialog
        open={blocker.state === 'blocked'}
        onClose={() => blocker.reset?.()}
        title={t('Leave without saving?')}
        footer={
          <>
            <Button variant="ghost" onClick={() => blocker.proceed?.()}>{t('Discard changes')}</Button>
            <Button variant="primary" onClick={() => { save(); blocker.proceed?.() }}>{t('Save draft & leave')}</Button>
          </>
        }
      >
        <p className="text-base text-haze">{t('You have unsaved changes.')}</p>
      </Dialog>
    </>
  )
}
