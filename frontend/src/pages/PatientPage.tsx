import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeftRight, ChevronRight, FileText, PlusCircle } from 'lucide-react'
import type { Encounter, Grade, Laterality } from '../types/domain'
import { activeImages, encountersFor, latestJob, latestReport, patientStatus, useStore, type DbState } from '../store/store'
import { GradeTimeline, type GradePoint } from '../features/patients/GradeTimeline'
import { EyeImg } from '../features/screening/common'
import { Badge, ButtonLink, Card, CardHeader, EmptyState, GradeChip, Notice, PageHeader, Select, SimulatedTag, type Tone } from '../components/ui'
import { ageFrom, FOLLOW_UP_LABEL, formatDate, GRADE_LONG, IMAGE_SLOT, IMAGE_SLOTS } from '../lib/util'
import { encounterPath, ENCOUNTER_STATUS_LABEL } from '../lib/routes'
import { DIABETES_LABEL, SEX_LABEL } from '../features/reports/reportModel'
import { tr, useT } from '../lib/i18n'

/** What we can say about one eye at one visit, preferring the signed clinician grade. */
function eyeOutcome(s: DbState, enc: Encounter, eye: Laterality) {
  const rep = latestReport(s, enc.id)
  const img = (rep ? rep.snapshot.images : activeImages(s, enc.id)).find((i) => i.laterality === eye)
  const job = latestJob(s, enc.id)
  const cls = img && job ? s.classifications.find((c) => c.imageId === img.id && c.jobId === job.id) : undefined
  const clin = rep?.snapshot.review.eyes[eye].clinicianGrade ?? null
  return { rep, img, cls, clin, notScreened: enc.notScreened[eye] }
}

export default function PatientPage() {
  const { id } = useParams()
  const state = useStore()
  const patient = state.patients.find((p) => p.id === id)
  const encs = patient ? encountersFor(state, patient.id) : []
  const cmpEye: Laterality = IMAGE_SLOT
  const withImages = encs.filter((e) => eyeOutcome(state, e, cmpEye).img)
  const [a, setA] = useState<string>('')
  const [b, setB] = useState<string>('')
  const t = useT()

  const points = useMemo(() => {
    const out: GradePoint[] = []
    for (const e of encs) {
      for (const eye of IMAGE_SLOTS) {
        const o = eyeOutcome(state, e, eye)
        if (typeof o.clin === 'number') out.push({ date: e.createdAt, eye, grade: o.clin, source: 'clinician', label: `${tr('Clinician')}: ${tr(GRADE_LONG[o.clin as Grade])}` })
        else if (o.cls?.determinable)
          out.push({ date: e.createdAt, eye, grade: o.cls.predictedGrade, source: 'model', label: `${tr('Model')}${o.cls.provenance === 'simulated' ? ` (${tr('simulated')})` : ''}: ${tr(GRADE_LONG[o.cls.predictedGrade])} — ${tr('awaiting review')}` })
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encs, state, t])

  if (!patient) return <EmptyState title={t('Patient not found')} action={<ButtonLink to="/dashboard">{t('Back to dashboard')}</ButtonLink>} />
  const status = patientStatus(state, patient.id)

  const older = withImages.find((e) => e.id === a) ?? withImages[1]
  const newer = withImages.find((e) => e.id === b) ?? withImages[0]

  return (
    <>
      <PageHeader
        eyebrow={<span className="flex items-center gap-2">{t('Patient')} {patient.mode === 'demo' && <Badge tone="demo">{t('Synthetic')}</Badge>}</span>}
        title={patient.name}
        description={<span><span className="font-mono">{patient.clinicPatientId}</span> · {t('{age} years', { age: ageFrom(patient.dateOfBirth, patient.age) ?? '—' })} · {t('registered {date}', { date: formatDate(patient.createdAt) })}</span>}
        actions={
          <ButtonLink to={`/screenings/new?patient=${patient.id}`} variant="primary">
            <PlusCircle size={16} /> {t('New screening')}
          </ButtonLink>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title={t('Profile')} action={<Badge tone={status.tone as Tone}>{t(status.label)}</Badge>} />
            <dl className="space-y-2.5 p-5 text-sm">
              {[
                [t('Date of birth'), patient.dateOfBirth ? formatDate(patient.dateOfBirth) : t('Not recorded')],
                [t('Sex'), patient.sex ? t(SEX_LABEL[patient.sex] ?? patient.sex) : t('Not recorded')],
                [t('Diabetes'), `${t(DIABETES_LABEL[patient.diabetesType ?? 'unknown'])}${patient.diabetesSinceYear ? ` · ${t('since {year}', { year: patient.diabetesSinceYear })} (${t('{age} y', { age: new Date().getFullYear() - patient.diabetesSinceYear })})` : ''}`],
                [t('HbA1c'), patient.hba1c ? `${patient.hba1c.value}% · ${formatDate(patient.hba1c.measuredOn)}` : t('Not recorded')],
                [t('Symptoms'), patient.symptoms ?? '—'],
                [t('Notes'), patient.notes ?? '—'],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-[110px_1fr] gap-3">
                  <dt className="text-haze">{k}</dt>
                  <dd className="text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHeader icon={<FileText size={16} />} title={t('Reports')} />
            {state.reports.filter((r) => r.snapshot.patient.id === patient.id).length === 0 ? (
              <p className="px-5 py-4 text-xs text-haze">{t('No finalised reports yet.')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {state.reports
                  .filter((r) => r.snapshot.patient.id === patient.id)
                  .sort((x, y) => y.finalizedAt.localeCompare(x.finalizedAt))
                  .map((r) => (
                    <li key={r.id}>
                      <Link to={`/screenings/${r.encounterId}/report`} className="flex items-center justify-between gap-2 px-5 py-3 text-sm transition-colors hover:bg-panel-2">
                        <span>
                          {formatDate(r.snapshot.encounter.createdAt)} <span className="text-xs text-haze">· {t('rev {n}', { n: r.revision })}</span>
                        </span>
                        <Badge tone={r.status === 'final' ? 'ok' : 'neutral'}>{t(r.status)}</Badge>
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title={t('Grade over time')} subtitle={t('Clinician-signed grades are solid; model-only points are hollow and unconfirmed.')} />
            <div className="p-5">
              {points.length ? <GradeTimeline points={points} /> : <EmptyState title={t('No graded visits yet')} />}
              <p className="mt-3 text-[12.5px] leading-relaxed text-haze">
                {t('A change in predicted grade alone is not confirmed disease progression.')} {patient.mode === 'demo' && t('Demo history uses images from different, unrelated dataset subjects.')}
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title={t('Encounter timeline')} subtitle={t(encs.length === 1 ? '{n} screening' : '{n} screenings', { n: encs.length })} />
            {encs.length === 0 ? (
              <EmptyState title={t('No screenings yet')} body={t('Start the first screening for this patient.')} action={<ButtonLink to={`/screenings/new?patient=${patient.id}`} variant="primary">{t('Start screening')}</ButtonLink>} />
            ) : (
              <ol className="relative space-y-0 px-5 py-4">
                {encs.map((e, i) => {
                  const rep = latestReport(state, e.id)
                  return (
                    <li key={e.id} className="relative pb-5 pl-7 last:pb-0">
                      {i < encs.length - 1 && <span className="absolute left-[7px] top-4 h-full w-px bg-line-strong" aria-hidden />}
                      <span className="absolute left-0 top-1.5 h-[15px] w-[15px] rounded-full border-2 border-electric bg-abyss" aria-hidden />
                      <Link to={encounterPath(e)} className="block rounded-xl border border-line bg-panel-2/50 p-4 transition-colors hover:border-cyan/30 hover:bg-panel-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-medium">{formatDate(e.createdAt, true)}</div>
                          <div className="flex items-center gap-2">
                            {rep ? <Badge tone="ok">{t('Final · rev {n}', { n: rep.revision })}</Badge> : <Badge tone="warn">{t(ENCOUNTER_STATUS_LABEL[e.status])}</Badge>}
                            <ChevronRight size={15} className="text-haze" />
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2">
                          {IMAGE_SLOTS.map((eye) => {
                            const o = eyeOutcome(state, e, eye)
                            return (
                              <div key={eye} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                                <span className="text-xs text-haze">{t('Grade')}</span>
                                {o.notScreened || !o.img ? (
                                  <Badge>{t('Not screened')}</Badge>
                                ) : o.clin !== null ? (
                                  <GradeChip grade={o.clin} size="sm" />
                                ) : o.cls ? (
                                  <span className="flex items-center gap-1.5">
                                    {o.cls.provenance === 'simulated' && <SimulatedTag label="Model · sim" />}
                                    {o.cls.determinable ? <GradeChip grade={o.cls.predictedGrade} size="sm" /> : <Badge tone="warn">{t('Undetermined')}</Badge>}
                                  </span>
                                ) : (
                                  <Badge>{t('No result')}</Badge>
                                )}
                              </div>
                            )
                          })}
                        </div>
                        {rep?.snapshot.review.followUp && <div className="mt-2 text-xs text-haze">{t('Follow-up')}: {t(FOLLOW_UP_LABEL[rep.snapshot.review.followUp])}</div>}
                        {(() => {
                          const c = state.classifications.find((x) => x.jobId === latestJob(state, e.id)?.id)
                          return c ? <div className="mt-1 font-mono text-[12px] text-haze/70">{c.modelId} · {c.modelVersion}</div> : null
                        })()}
                      </Link>
                    </li>
                  )
                })}
              </ol>
            )}
          </Card>

          <Card>
            <CardHeader icon={<ArrowLeftRight size={16} />} title={t('Compare visits')} subtitle={t('Two retinal fundus images, side by side')} />
            {withImages.length < 2 ? (
              <div className="p-5">
                <p className="text-xs text-haze">{t('At least two visits with a retinal fundus image are needed to compare.')}</p>
              </div>
            ) : (
              <div className="space-y-4 p-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select value={older?.id ?? ''} onChange={(e) => setA(e.target.value)} aria-label={t('Earlier visit')}>
                    {withImages.map((e) => (
                      <option key={e.id} value={e.id}>{formatDate(e.createdAt)}</option>
                    ))}
                  </Select>
                  <Select value={newer?.id ?? ''} onChange={(e) => setB(e.target.value)} aria-label={t('Later visit')}>
                    {withImages.map((e) => (
                      <option key={e.id} value={e.id}>{formatDate(e.createdAt)}</option>
                    ))}
                  </Select>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {[older, newer].map((e, i) => {
                    if (!e) return null
                    const o = eyeOutcome(state, e, cmpEye)
                    return (
                      <figure key={`${e.id}-${i}`} className="space-y-2">
                        {o.img && <EyeImg image={o.img} className="aspect-[4/3] w-full rounded-xl border border-line" />}
                        <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="text-haze">{formatDate(e.createdAt)} · {o.img?.fileName}</span>
                          {o.clin !== null ? <GradeChip grade={o.clin} size="sm" /> : o.cls ? <span className="flex gap-1"><SimulatedTag label="Model" /><GradeChip grade={o.cls.predictedGrade} size="sm" /></span> : <Badge>{t('No grade')}</Badge>}
                        </figcaption>
                        {o.cls && <div className="font-mono text-[12px] text-haze/70">{o.cls.modelVersion}</div>}
                      </figure>
                    )
                  })}
                </div>
                <Notice tone="info">{t('Differences between visits must be interpreted by a clinician. Image acquisition differences (device, field, exposure) can change model output without disease change.')}</Notice>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
