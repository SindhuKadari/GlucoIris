import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Cpu, RefreshCw } from 'lucide-react'
import { MODULE_KEYS } from '../types/domain'
import { activeImages, isAnalysable, latestJob, latestQuality, useStore } from '../store/store'
import { screeningApi } from '../services/screeningApi'
import { serviceHealth, type ServiceHealth } from '../services/modelService'
import { EncounterNotFound, EyeImg, ScreeningFrame, ScreeningHeader, StepBar, useEncounterContext } from '../features/screening/common'
import { Badge, Button, Card, CardHeader, ModuleStatusBadge, Notice, ProgressBar, SimulatedTag } from '../components/ui'
import { MODULE_LABEL } from '../lib/util'
import { ResultPanel } from '../features/review/ResultPanel'
import { useT } from '../lib/i18n'

export default function AnalysisPage() {
  const { encounter, patient } = useEncounterContext()
  const state = useStore()
  const navigate = useNavigate()
  const t = useT()
  const location = useLocation()
  const [health, setHealth] = useState<ServiceHealth | null | undefined>(undefined)
  useEffect(() => {
    serviceHealth(true).then(setHealth)
  }, [])
  const [error, setError] = useState<string | null>(null)
  const starting = useRef(false)

  const images = encounter ? activeImages(state, encounter.id) : []
  const eligible = images.filter((i) => isAnalysable(latestQuality(state, i.id)))
  const eligibleKey = eligible.map((i) => i.id).sort().join(',')
  const job = encounter ? latestJob(state, encounter.id) : undefined
  const jobMatches = !!job && [...job.imageIds].sort().join(',') === eligibleKey

  const start = useCallback(
    async (attempt: number) => {
      if (!encounter || starting.current) return
      starting.current = true
      setError(null)
      try {
        const idempotencyKey = `${encounter.id}:${eligibleKey}:${attempt}`
        const existing = useStore.getState().jobs.find((j) => j.idempotencyKey === idempotencyKey)
        if (!existing) {
          const created = await screeningApi.startAnalysis({ encounterId: encounter.id, images: eligible, idempotencyKey, attempt })
          useStore.getState().addJob(created)
        }
      } catch (e) {
        setError(t('Analysis could not be started: {error}', { error: (e as Error).message }))
      } finally {
        starting.current = false
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [encounter?.id, eligibleKey],
  )

  // Start a job for the current eligible images if none exists.
  useEffect(() => {
    if (encounter && eligible.length && !jobMatches) start(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounter?.id, eligibleKey, jobMatches])

  // Does the current job already carry real model output (EfficientNet-B4 Grad-CAM)?
  const hasModelOutput = !!job && Object.values(job.modules).some((m) => m.dr_binary?.status === 'completed')
  const rerun = () => {
    if (!encounter) return
    if (encounter.status !== 'analysis') useStore.getState().setEncounterStatus(encounter.id, 'analysis')
    useStore.getState().log('rerun_with_models', 'encounter', encounter.id)
    setDone(false)
    start((job?.attempt ?? 0) + 1)
  }

  // Arriving from "Run AI models" on the review page: start a model run once.
  const rerunRequested = useRef(false)
  useEffect(() => {
    if (rerunRequested.current || !health || !jobMatches) return
    if ((location.state as { rerun?: boolean } | null)?.rerun && !hasModelOutput) {
      rerunRequested.current = true
      navigate(location.pathname, { replace: true, state: null })
      rerun()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health, jobMatches, hasModelOutput])

  // Poll the job until every module settles.
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!job || !jobMatches || !encounter) return
    let alive = true
    let timer = 0
    const poll = async () => {
      try {
        const snap = await screeningApi.getJob(job, useStore.getState().images)
        if (!alive) return
        useStore.getState().applySnapshot(snap)
        setDone(snap.done)
        if (snap.done) {
          const enc = useStore.getState().encounters.find((e) => e.id === encounter.id)
          if (enc?.status === 'analysis') useStore.getState().setEncounterStatus(encounter.id, 'awaiting_review')
          return
        }
      } catch (e) {
        if (!alive) return
        setError(t('Lost contact with the analysis service: {error}. Results already received are kept.', { error: (e as Error).message }))
      }
      timer = window.setTimeout(poll, 350)
    }
    poll()
    return () => {
      alive = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, jobMatches])

  if (!encounter || !patient) return <EncounterNotFound />

  const failed = job ? Object.values(job.modules).some((m) => Object.values(m).some((s) => s.status === 'failed')) : false

  const openReview = () => {
    if (encounter.status === 'analysis') state.setEncounterStatus(encounter.id, 'awaiting_review')
    navigate(`/screenings/${encounter.id}/review`)
  }

  return (
    <ScreeningFrame
      header={<ScreeningHeader encounter={encounter} patient={patient} current="analysis" />}
      bar={
        <StepBar
          back={{ to: `/screenings/${encounter.id}/quality`, label: t('Back to quality') }}
          status={done || !eligible.length ? t('Classification finished. Continue to review the Grad-CAM evidence.') : t('Running EfficientNet-B4… you can leave this page; the job continues.')}
        >
          {failed && done && (
            <Button size="lg" onClick={() => start((job?.attempt ?? 1) + 1)}>
              <RefreshCw size={16} /> <span className="hidden md:inline">{t('Retry failed')}</span>
            </Button>
          )}
          <Button variant="primary" size="lg" disabled={!done && eligible.length > 0} onClick={openReview}>
            <span className="md:hidden">{t('Continue')}</span><span className="hidden md:inline">{t('Continue to review')}</span> <ArrowRight size={18} />
          </Button>
        </StepBar>
      }
    >
      <div className="space-y-4">
        {error && (
          <Notice tone="bad" title={t('Analysis error')}>
            {error}
            <Button size="sm" className="mt-2" onClick={() => start((job?.attempt ?? 0) + 1)}>
              <RefreshCw size={13} /> Retry
            </Button>
          </Notice>
        )}
        {!eligible.length ? (
          <Notice tone="warn" title={t('No images are eligible for analysis')}>
            {t('Images must pass the quality gate (or be accepted as borderline) before classification.')}
          </Notice>
        ) : (
          <div className="space-y-5">
            {eligible.map((img) => {
              const modules = job && jobMatches ? job.modules[img.id] : undefined
              const settled = !!modules && Object.values(modules).every((m) => m.status !== 'processing' && m.status !== 'queued')
              const cls = job ? state.classifications.find((c) => c.imageId === img.id && c.jobId === job.id) : undefined
              const b4 = job ? state.artifacts.find((a) => a.imageId === img.id && a.jobId === job.id && a.type === 'gradcam_b4')?.result : undefined
              return (
                <Card key={img.id}>
                  <CardHeader
                    icon={<Cpu size={16} />}
                    title={t('Analysis')}
                    action={health ? <Badge tone="ok" title={job ? t('Job {id} · attempt {n}', { id: job.id.slice(-8), n: job.attempt }) : undefined}>{t('Model inference')}</Badge> : img.origin === 'fixture' ? <SimulatedTag label="Demo fixture" /> : <Badge>{t('Uploaded image')}</Badge>}
                  />
                  <div className="grid gap-5 p-4 md:grid-cols-[minmax(0,280px)_1fr]">
                    <EyeImg image={img} className="aspect-[4/3] w-full self-start rounded-xl border border-line" />
                    {settled ? (
                      <ResultPanel wide eye={img.laterality} encounter={encounter} image={img} quality={latestQuality(state, img.id)} classification={cls} modules={modules} b4={b4} />
                    ) : (
                    <ul className="divide-y divide-line rounded-xl border border-line">
                      {MODULE_KEYS.map((k) => {
                        const m = modules?.[k]
                        return (
                          <li key={k} className="space-y-1.5 px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm text-ink">{t(MODULE_LABEL[k])}</span>
                              <div className="flex items-center gap-1.5">
                                {m?.provenance === 'simulated' && <SimulatedTag />}
                                {m?.provenance === 'reference_annotation' && <SimulatedTag label="Reference annotation" />}
                                {m ? <ModuleStatusBadge status={m.status} /> : <Badge>{t('Waiting')}</Badge>}
                              </div>
                            </div>
                            {m?.status === 'processing' && <ProgressBar value={m.progress} />}
                            {m?.message && <p className="text-xs text-haze">{t(m.message)}</p>}
                            {m?.status === 'completed' && m.version && <p className="font-mono text-[12px] text-haze/70">{m.version}</p>}
                          </li>
                        )
                      })}
                    </ul>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </ScreeningFrame>
  )
}

