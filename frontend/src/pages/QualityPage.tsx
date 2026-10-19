import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCircle2, AlertTriangle, MinusCircle, RefreshCw, Sparkles, XCircle } from 'lucide-react'
import type { DimensionStatus, EyeImage, QualityResult } from '../types/domain'
import { activeImages, isAnalysable, latestQuality, useStore } from '../store/store'
import { runQuality } from '../services/qualityService'
import { resolveImageUrl } from '../lib/images'
import { enhancedUrl, ENHANCEMENT_METHOD } from '../lib/enhance'
import { QUALITY_VERSION } from '../lib/quality'
import { EncounterNotFound, EyeImg, ScreeningFrame, ScreeningHeader, StepBar, useEncounterContext } from '../features/screening/common'
import { Badge, Button, ButtonLink, Card, CardHeader, Dialog, Notice, QualityBadge, Textarea } from '../components/ui'
import { cx, EYE_LABEL, formatDate } from '../lib/util'
import { useT } from '../lib/i18n'

const dimIcon: Record<DimensionStatus, ReactElement> = {
  pass: <CheckCircle2 size={15} className="text-ok" aria-label="Pass" />,
  warn: <AlertTriangle size={15} className="text-warn" aria-label="Warning" />,
  fail: <XCircle size={15} className="text-bad" aria-label="Fail" />,
}

function QualityPanel({ image, encounterId }: { image: EyeImage; encounterId: string }) {
  const q = useStore((s) => latestQuality(s, image.id))
  const saveQuality = useStore((s) => s.saveQuality)
  const overrideQuality = useStore((s) => s.overrideQuality)
  const [running, setRunning] = useState(false)
  const [enhOpen, setEnhOpen] = useState(false)
  const [enh, setEnh] = useState<{ orig: string; enh: string } | null>(null)
  const [acceptOpen, setAcceptOpen] = useState(false)
  const [reason, setReason] = useState('')
  const started = useRef(false)
  const t = useT()

  const run = async () => {
    setRunning(true)
    const url = await resolveImageUrl(image)
    const result = url
      ? await runQuality(image.id, url)
      : { imageId: image.id, version: QUALITY_VERSION, assessedAt: new Date().toISOString(), outcome: 'unavailable' as const, dimensions: [], reasons: ['Image data is not available in this browser.'], guidance: ['Replace the image.'] }
    saveQuality(result)
    setRunning(false)
  }

  useEffect(() => {
    if (!q && !started.current) {
      started.current = true
      run()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const openEnhancement = async () => {
    setEnhOpen(true)
    const url = await resolveImageUrl(image)
    if (url) setEnh({ orig: url, enh: await enhancedUrl(url) })
  }

  return (
    <Card>
      <CardHeader
        title={t(EYE_LABEL[image.laterality])}
        subtitle={q ? t('Assessed {time}', { time: formatDate(q.assessedAt, true) }) : t('Assessing…')}
        action={running ? <Badge tone="info">{t('Assessing…')}</Badge> : <QualityBadge outcome={q?.outcome} overridden={!!q?.override} />}
      />
      <div className="grid gap-5 p-4 md:grid-cols-[minmax(0,340px)_1fr]">
        <EyeImg image={image} className="aspect-[4/3] w-full self-start rounded-xl border border-line" />
        <div className="min-w-0 space-y-3">
          {running || !q ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="skeleton h-8 rounded-lg" />
              ))}
            </div>
          ) : (
            <>
              {q.outcome === 'ungradeable' && (
                <Notice tone="bad" title={t('Unable to screen: image quality inadequate')}>
                  {t('This image is blocked from classification.')} {t(q.reasons[0] ?? '')}
                </Notice>
              )}
              {q.outcome === 'borderline' && !q.override && (
                <Notice tone="warn" title={t('Borderline quality — recapture preferred')}>
                  {q.reasons.map((r) => t(r)).join(' ')}
                </Notice>
              )}
              {q.outcome === 'borderline' && q.override && (
                <Notice tone="info" title={t('Accepted by {name}', { name: q.override.by })}>
                  {q.override.reason}
                </Notice>
              )}
              {q.outcome === 'unavailable' && (
                <Notice tone="bad" title={t('Quality service unavailable')}>
                  {t(q.reasons[0] ?? '')} {t('The image has not been approved.')}
                </Notice>
              )}
              <ul className="grid overflow-hidden rounded-xl border border-line bg-panel-2 lg:grid-cols-2">
                {q.dimensions.map((d) => (
                  <li key={d.key} className="flex items-start gap-3 border-b border-line px-3 py-2.5 lg:odd:border-r">
                    <div className="mt-0.5">{dimIcon[d.status]}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-ink">{t(d.label)}</span>
                        {d.score !== undefined && <span className="font-mono text-xs tabular-nums text-haze">{Math.round(d.score)}/100</span>}
                      </div>
                      {d.score !== undefined && (
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-panel-3" aria-hidden>
                          <div className={cx('h-full rounded-full', d.status === 'pass' ? 'bg-ok' : d.status === 'warn' ? 'bg-warn' : 'bg-bad')} style={{ width: `${d.score}%` }} />
                        </div>
                      )}
                      <div className="mt-1 text-xs text-haze">{t(d.detail)}</div>
                    </div>
                  </li>
                ))}
                {!q.dimensions.length && (
                  <li className="flex items-center gap-2 px-3 py-2.5 text-xs text-haze lg:col-span-2">
                    <MinusCircle size={14} /> {t('No dimensions assessed')}
                  </li>
                )}
              </ul>
              {q.guidance.length > 0 && (
                <div className="rounded-xl border border-line bg-panel-2 px-3.5 py-3">
                  <div className="mb-1.5 text-xs font-medium text-ink">{t('Recapture guidance')}</div>
                  <ul className="list-disc space-y-1 pl-4 text-xs text-haze">
                    {[...new Set(q.guidance)].map((g) => (
                      <li key={g}>{t(g)}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={run}>
                  <RefreshCw size={13} /> {t('Re-assess')}
                </Button>
                {q.outcome !== 'acceptable' && (
                  <ButtonLink size="sm" to={`/screenings/${encounterId}/acquisition`}>
                    {t('Replace / recapture')}
                  </ButtonLink>
                )}
                {q.outcome === 'borderline' && (
                  <Button size="sm" onClick={openEnhancement}>
                    <Sparkles size={13} /> {t('Preview enhancement')}
                  </Button>
                )}
                {q.outcome === 'borderline' && !q.override && (
                  <Button size="sm" variant="primary" onClick={() => setAcceptOpen(true)}>
                    {t('Accept for analysis')}
                  </Button>
                )}
              </div>
              <p className="text-[12.5px] leading-relaxed text-haze">
                {t('Classical quality algorithm calibrated on IDRiD/DRIVE images and synthetic degradations; not validated against human graders — treat it as guidance.')}{' '}
                <span className="font-mono">{q.version}</span>
              </p>
            </>
          )}
        </div>
      </div>

      <Dialog open={enhOpen} onClose={() => setEnhOpen(false)} title={t('Enhancement preview')}>
        <p className="mb-3 text-xs leading-relaxed text-haze">
          {ENHANCEMENT_METHOD}. {t('Enhancement helps viewing but cannot recover information that was not captured, and is not used as model input. The original is preserved.')}
        </p>
        {enh ? (
          <div className="grid grid-cols-2 gap-2">
            <figure>
              <img src={enh.orig} alt={t('Original')} className="aspect-[4/3] w-full rounded-lg bg-black object-contain" />
              <figcaption className="mt-1 text-center text-[12.5px] text-haze">{t('Original')}</figcaption>
            </figure>
            <figure>
              <img src={enh.enh} alt={t('Enhanced')} className="aspect-[4/3] w-full rounded-lg bg-black object-contain" />
              <figcaption className="mt-1 text-center text-[12.5px] text-haze">{t('Enhanced (viewer only)')}</figcaption>
            </figure>
          </div>
        ) : (
          <div className="skeleton aspect-[8/3] rounded-lg" />
        )}
      </Dialog>

      <Dialog
        open={acceptOpen}
        onClose={() => setAcceptOpen(false)}
        title={t('Accept borderline image')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAcceptOpen(false)}>{t('Cancel')}</Button>
            <Button variant="primary" disabled={reason.trim().length < 5} onClick={() => { q && overrideQuality(q.id, reason.trim()); setAcceptOpen(false) }}>
              {t('Accept & record')}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-xs text-haze">{t('Recapture is preferred. If you proceed, your reason is recorded in the audit trail and shown on the report.')}</p>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('e.g. Recapture attempted twice; patient unable to tolerate further flash.')} autoFocus />
      </Dialog>
    </Card>
  )
}

export default function QualityPage() {
  const { encounter, patient } = useEncounterContext()
  const state = useStore()
  const navigate = useNavigate()
  const t = useT()
  if (!encounter || !patient) return <EncounterNotFound />

  const images = activeImages(state, encounter.id)
  const results = images.map((i) => ({ image: i, q: latestQuality(state, i.id) as QualityResult | undefined }))
  const pending = results.filter((r) => !r.q || r.q.outcome === 'unavailable' || (r.q.outcome === 'borderline' && !r.q.override))
  const eligible = results.filter((r) => isAnalysable(r.q))
  const blocked = results.filter((r) => r.q?.outcome === 'ungradeable')

  const proceed = () => {
    if (eligible.length) {
      state.setEncounterStatus(encounter.id, 'analysis')
      navigate(`/screenings/${encounter.id}/analysis`)
    } else {
      state.setEncounterStatus(encounter.id, 'awaiting_review')
      state.log('sent_to_review_without_analysis', 'encounter', encounter.id, 'No image passed the quality gate')
      navigate(`/screenings/${encounter.id}/review`)
    }
  }

  const statusText =
    images.length === 0
      ? t('No image attached — go back to add one.')
      : pending.length > 0
        ? t('Resolve borderline or unavailable assessments before continuing.')
        : blocked.length && eligible.length
          ? t('{blocked} image(s) will not be classified; {eligible} will be analysed.', { blocked: blocked.length, eligible: eligible.length })
          : blocked.length
            ? t('No image passed the quality gate. The screening goes to review as “Unable to screen”.')
            : t('{n} image(s) passed quality and are ready for analysis.', { n: eligible.length })

  return (
    <ScreeningFrame
      header={<ScreeningHeader encounter={encounter} patient={patient} current="quality" />}
      bar={
        <StepBar back={{ to: `/screenings/${encounter.id}/acquisition`, label: t('Back to image') }} status={statusText}>
          <Button variant="primary" size="lg" disabled={pending.length > 0 || images.length === 0} onClick={proceed}>
            {eligible.length ? t('Run analysis') : t('Continue to review')} <ArrowRight size={18} />
          </Button>
        </StepBar>
      }
    >
      {images.length === 0 ? (
        <Notice tone="warn" title={t('No images attached')}>
          {t('Return to acquisition to add images.')}
        </Notice>
      ) : (
        <div className="space-y-5">
          {images.map((img) => (
            <QualityPanel key={img.id} image={img} encounterId={encounter.id} />
          ))}
        </div>
      )}
    </ScreeningFrame>
  )
}
