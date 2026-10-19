import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Download } from 'lucide-react'
import type { ClinicalReview, EvidenceArtifact, EyeImage, Report, ReportSnapshot } from '../types/domain'
import { overlayUrl } from '../lib/overlays'
import { buildSnapshot, useStore } from '../store/store'
import { EncounterNotFound, EyeImg, ScreeningFrame, ScreeningHeader, StepBar, useEncounterContext } from '../features/screening/common'
import { downloadReportPdf } from '../features/reports/pdf'
import { CONSENT_LABEL, datasetCredits, DIABETES_LABEL, drVerdict, eyeSections, missingModules, QUALITY_LABEL, REPORT_LIMITATIONS, SEX_LABEL, type DrVerdict } from '../features/reports/reportModel'
import { useT } from '../lib/i18n'
import { Button, Notice } from '../components/ui'
import { ageFrom, cx, EYE_LABEL, FOLLOW_UP_LABEL, formatDate, GRADE_LONG, MODULE_LABEL } from '../lib/util'

const placeholderReview = (encounterId: string): ClinicalReview => ({
  id: 'draft',
  encounterId,
  reviewer: '',
  eyes: {
    right: { clinicianGrade: null, agreesWithModel: null, dme: 'not_assessed', findings: '' },
    left: { clinicianGrade: null, agreesWithModel: null, dme: 'not_assessed', findings: '' },
  },
  followUp: null,
  notes: '',
  savedAt: '',
})

export function ReportDocument({ snapshot, status, report }: { snapshot: ReportSnapshot; status: 'draft' | 'final' | 'superseded'; report?: Report }) {
  const p = snapshot.patient
  const e = snapshot.encounter
  const demo = e.mode === 'demo'
  const t = useT()
  return (
    <article className="relative overflow-hidden rounded-2xl bg-[#f7f9fc] text-[#101624] shadow-2xl">
      {(demo || status !== 'final') && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
          <span className="-rotate-[30deg] whitespace-nowrap text-4xl font-bold text-[#245CEB]/[0.07] sm:text-6xl">{demo ? t('DEMONSTRATION — NOT FOR CLINICAL USE') : t('DRAFT')}</span>
        </div>
      )}
      <header className="flex flex-wrap items-start justify-between gap-3 bg-[#080B12] px-6 py-5 text-[#f5f8ff]">
        <div>
          <div className="font-display text-xl font-medium">GlucoIris</div>
          <div className="text-xs text-[#B9D4FF]">{t('Diabetic retinopathy screening report')}</div>
        </div>
        <div className="text-right font-mono text-[12.5px] uppercase tracking-wider">
          <div className="text-[#B9D4FF]">{status === 'draft' ? t('Draft — awaiting clinician review') : status === 'superseded' ? t('Superseded · revision {n}', { n: report?.revision ?? '' }) : t('Final · revision {n}', { n: report?.revision ?? '' })}</div>
          {demo && <div className="mt-1 text-[#B9D4FF]">{t('Demonstration — not for clinical use')}</div>}
        </div>
      </header>
      <div className="relative space-y-6 px-6 py-6 text-sm">
        <section className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
          {[
            [t('Patient'), `${p.name} (${p.clinicPatientId})`],
            [t('Age / sex'), `${t('{age} y', { age: ageFrom(p.dateOfBirth, p.age) ?? '—' })} / ${p.sex ? t(SEX_LABEL[p.sex] ?? p.sex) : t('Not recorded')}`],
            [t('Diabetes'), `${p.diabetesType ? t(DIABETES_LABEL[p.diabetesType] ?? p.diabetesType) : t('Not recorded')}${p.diabetesSinceYear ? `, ${t('since {year}', { year: p.diabetesSinceYear })}` : ''}`],
            [t('HbA1c'), p.hba1c ? `${p.hba1c.value}% (${formatDate(p.hba1c.measuredOn)})` : t('Not recorded')],
            [t('Screening date'), formatDate(e.createdAt, true)],
            [t('Operator · consent'), `${e.operator} · ${t(CONSENT_LABEL[e.consent.method] ?? e.consent.method)}`],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-3">
              <span className="w-32 shrink-0 text-[#606c80]">{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </section>

        {eyeSections(snapshot).map((sec) => (
          <section key={sec.eye} className="border-t border-[#dce2ec] pt-5">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[#245CEB]">{t(EYE_LABEL[sec.eye])}</h3>
            <VerdictBanner v={drVerdict(sec)} />
            {!sec.image ? (
              <p>{t('Not screened')}. {sec.notScreenedReason && t(sec.notScreenedReason)}</p>
            ) : (
              <div className="grid gap-5 md:grid-cols-[200px_1fr]">
                <EyeImg image={sec.image} className="aspect-[4/3] w-full rounded-lg" />
                <dl className="space-y-1.5">
                  <Row k={t('Image quality')} v={`${sec.quality ? t(QUALITY_LABEL[sec.quality.outcome]) : t('Not assessed')}${sec.quality?.override ? ` (${t('borderline, accepted')})` : ''}`} />
                  {sec.quality?.outcome === 'ungradeable' ? (
                    <Row k={t('Model result')} v={t('Unable to screen: image quality inadequate')} strong />
                  ) : sec.classification ? (
                    <>
                      <Row
                        k={t('Model result')}
                        v={`${sec.classification.determinable ? t(GRADE_LONG[sec.classification.predictedGrade]) : t('Unable to determine — review required')}  [${sec.classification.provenance === 'simulated' ? t('simulated') : t('model output')}]`}
                      />
                      <Row k={t('Referable-DR score')} v={`${sec.classification.referableDrScore.toFixed(2)} (${t('threshold')} ${sec.classification.referableThreshold.toFixed(2)}) · ${sec.classification.referableFlag ? t('flagged') : t('below threshold')}`} />
                    </>
                  ) : sec.artifacts.find((a) => a.type === 'gradcam_b4')?.result ? null : (
                    <Row k={t('Model result')} v={t(sec.modules?.classification?.message ?? 'Not available')} />
                  )}
                  {(() => {
                    const r = sec.artifacts.find((a) => a.type === 'gradcam_b4')?.result
                    if (!r || sec.quality?.outcome === 'ungradeable') return null
                    return <Row k={sec.classification ? t('DR detection (B4)') : t('Model result')} v={`${t(r.label)} · P(DR) ${r.probability.toFixed(3)} (${t('threshold')} ${r.threshold.toFixed(2)}) · EfficientNet-B4  [${t('model output')}]`} strong />
                  })()}
                  {sec.interpretation.findings && <Row k={t('Findings')} v={sec.interpretation.findings} />}
                  {(() => {
                    const les = sec.artifacts.find((a) => a.type === 'lesion_mask')
                    if (!les) return null
                    const counts = (les.boxes ?? []).reduce<Record<string, number>>((acc, b) => ({ ...acc, [b.label]: (acc[b.label] ?? 0) + 1 }), {})
                    return <Row k={t('Lesion regions')} v={Object.keys(counts).length ? Object.entries(counts).map(([k, v]) => `${t(k)}: ${v}`).join(' · ') : t('None above threshold')} />
                  })()}
                  {missingModules(sec).length > 0 && <Row k={t('Evidence unavailable')} v={missingModules(sec).map((m) => t(MODULE_LABEL[m.module])).join(', ')} muted />}
                </dl>
              </div>
            )}
            {sec.image && sec.artifacts.length > 0 && <EvidenceGallery image={sec.image} artifacts={sec.artifacts} t={t} />}
          </section>
        ))}

        <section className="border-t border-[#dce2ec] pt-5">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[#245CEB]">{t('Clinical plan and sign-off')}</h3>
          <dl className="space-y-1.5">
            <Row k={t('Follow-up')} v={snapshot.review.followUp ? t(FOLLOW_UP_LABEL[snapshot.review.followUp]) : t('Not recorded')} strong />
            {snapshot.review.notes && <Row k={t('Notes')} v={snapshot.review.notes} />}
            <Row k={t('Reviewer')} v={status === 'draft' ? t('Not yet signed') : `${report?.finalizedBy} · ${formatDate(report?.finalizedAt, true)}`} />
            {report?.revisionReason && <Row k={t('Revision reason')} v={report.revisionReason} />}
          </dl>
        </section>

        <section className="border-t border-[#dce2ec] pt-4 text-[12.5px] leading-relaxed text-[#606c80]">
          {REPORT_LIMITATIONS.map((l) => (
            <p key={l}>• {t(l)}</p>
          ))}
          {datasetCredits(snapshot).map((c) => (
            <p key={c}>{t('Image source')}: {c}</p>
          ))}
        </section>
      </div>
    </article>
  )
}

const VERDICT_STYLE: Record<DrVerdict['status'], string> = {
  dr: 'border-[#d92d4a] bg-[#fdecef] text-[#8f1028]',
  no_dr: 'border-[#15803d] bg-[#e9f7ee] text-[#0f5a2b]',
  undetermined: 'border-[#b45309] bg-[#fdf3e6] text-[#7a3a06]',
  not_screened: 'border-[#9aa6b8] bg-[#eef1f6] text-[#3b4658]',
}

/** The headline answer of the report: DR or not, in large type and colour (always paired with text). */
function VerdictBanner({ v }: { v: DrVerdict }) {
  return (
    <div className={cx('mb-5 rounded-xl border-l-[6px] border px-5 py-4', VERDICT_STYLE[v.status])} role="status">
      <div className="text-xl font-bold uppercase tracking-wide">{v.headline}</div>
      <div className="mt-1 text-[13px] opacity-90">{v.detail}</div>
    </div>
  )
}

/** Report evidence: each overlay composited on the original, plus the boxed final output. */
function EvidenceGallery({ image, artifacts, t }: { image: EyeImage; artifacts: EvidenceArtifact[]; t: ReturnType<typeof useT> }) {
  const tag = (a: EvidenceArtifact) => t(a.provenance === 'simulated' ? 'simulated' : a.provenance === 'reference_annotation' ? 'reference' : 'model')
  const items: { key: string; label: string; overlay?: EvidenceArtifact; src?: string; opacity: number }[] = []
  const find = (t: EvidenceArtifact['type']) => artifacts.find((a) => a.type === t)
  const b4 = find('gradcam_b4'), vit = find('attribution'), ves = find('vessel_mask'), les = find('lesion_mask')
  if (b4?.blendImageUrl) items.push({ key: 'b4', label: `Grad-CAM · EfficientNet-B4 (${b4.result ? t(b4.result.label) : ''}, P(DR) ${b4.result?.probability.toFixed(2) ?? '—'})`, src: b4.blendImageUrl, opacity: 1 })
  else if (b4) items.push({ key: 'b4', label: 'Grad-CAM · EfficientNet-B4', overlay: b4, opacity: 0.6 })
  if (b4?.boxesImageUrl) items.push({ key: 'b4box', label: `${t('Grad-CAM regions')} · EfficientNet-B4 (${b4.camRegions?.length ?? 0})`, src: b4.boxesImageUrl, opacity: 1 })
  if (vit?.blendImageUrl) items.push({ key: 'vit', label: `Grad-CAM · ViT (${t('five-class grade')})`, src: vit.blendImageUrl, opacity: 1 })
  if (vit?.boxesImageUrl) items.push({ key: 'vitbox', label: `${t('Grad-CAM regions')} · ViT (${vit.camRegions?.length ?? 0})`, src: vit.boxesImageUrl, opacity: 1 })
  if (ves) items.push({ key: 'ves', label: `${t('Vessel mask')} · ${tag(ves)}`, overlay: ves, opacity: 0.8 })
  if (les) items.push({ key: 'les', label: `${t('Lesion segmentation')} · ${tag(les)}`, overlay: les, opacity: 0.85 })
  if (les?.boxesImageUrl) items.push({ key: 'box', label: `${t('Lesion bounding boxes')} (${les.boxes?.length ?? 0})`, src: les.boxesImageUrl, opacity: 1 })
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((it) => (
        <figure key={it.key} className="space-y-1">
          <div className="relative overflow-hidden rounded-lg bg-black" style={{ aspectRatio: `${image.width} / ${image.height}` }}>
            {it.src ? (
              <img src={it.src} alt={it.label} className="absolute inset-0 h-full w-full object-fill" />
            ) : (
              <>
                <EyeImg image={image} className="absolute inset-0 h-full w-full object-fill" />
                <OverlayImg artifact={it.overlay!} opacity={it.opacity} />
              </>
            )}
          </div>
          <figcaption className="text-[11px] text-[#606c80]">{it.label}</figcaption>
        </figure>
      ))}
    </div>
  )
}

function OverlayImg({ artifact, opacity }: { artifact: EvidenceArtifact; opacity: number }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    overlayUrl(artifact).then((u) => alive && setUrl(u)).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [artifact])
  return url ? <img src={url} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-fill" style={{ opacity }} /> : null
}

function Row({ k, v, strong, muted }: { k: string; v: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex gap-3">
      <dt className="w-36 shrink-0 text-[#606c80]">{k}</dt>
      <dd className={cx(strong && 'font-semibold', muted && 'text-[#606c80]')}>{v}</dd>
    </div>
  )
}

export default function ReportPage() {
  const { encounter, patient } = useEncounterContext()
  const state = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const t = useT()
  if (!encounter || !patient) return <EncounterNotFound />

  const reports = state.reports.filter((r) => r.encounterId === encounter.id).sort((a, b) => b.revision - a.revision)
  const current = reports[0]
  const review = state.reviews.find((r) => r.encounterId === encounter.id)
  const draftSnapshot = buildSnapshot(state, encounter.id, review ?? placeholderReview(encounter.id))
  const status: 'draft' | 'final' | 'superseded' = current ? current.status : 'draft'
  const snapshot = current?.snapshot ?? draftSnapshot

  const download = async () => {
    setBusy(true)
    setError(null)
    try {
      await downloadReportPdf(snapshot, { status, report: current })
      state.log('report_downloaded', 'encounter', encounter.id, current ? `revision ${current.revision}` : 'draft')
    } catch (e) {
      setError(t('PDF could not be generated: {error}', { error: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScreeningFrame
      header={<ScreeningHeader encounter={encounter} patient={patient} current="report" />}
      bar={
        <StepBar
          back={{ to: `/screenings/${encounter.id}/review`, label: current ? t('Revise review') : t('Continue review') }}
          status={current ? t('Final · revision {n} signed by {name}.', { n: current.revision, name: current.finalizedBy }) : t('Draft — awaiting clinician review. A draft PDF is watermarked accordingly.')}
        >
          <Button size="lg" variant={current ? 'secondary' : 'primary'} onClick={download} loading={busy}>
            <Download size={17} /> <span className="hidden sm:inline">{t('Download PDF')}</span>
          </Button>
          {current && (
            <Button variant="primary" size="lg" onClick={() => navigate('/dashboard')}>
              {t('Finish')} <ArrowRight size={18} />
            </Button>
          )}
        </StepBar>
      }
    >
      <div className="flex flex-col gap-4 xl:h-full">
        {error && <Notice tone="bad" className="shrink-0">{error}</Notice>}
        <div className="min-w-0 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:rounded-2xl">
          <ReportDocument snapshot={snapshot} status={status} report={current} />
        </div>
      </div>
    </ScreeningFrame>
  )
}
