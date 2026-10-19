import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Check, ImageOff } from 'lucide-react'
import type { Encounter, EyeImage, ImageSource, Patient } from '../../types/domain'
import { useStore } from '../../store/store'
import { resolveSourceUrl } from '../../lib/images'
import { ageFrom, cx, formatDate } from '../../lib/util'
import { Badge, ButtonLink, EmptyState } from '../../components/ui'
import { useT } from '../../lib/i18n'

export function useImageUrl(source?: ImageSource | null) {
  const [url, setUrl] = useState<string | null>(source?.kind === 'fixture' ? source.url : null)
  const [missing, setMissing] = useState(false)
  const key = source ? (source.kind === 'fixture' ? source.url : source.blobKey) : ''
  useEffect(() => {
    let alive = true
    if (!source) return
    resolveSourceUrl(source).then((u) => {
      if (!alive) return
      setUrl(u)
      setMissing(!u)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return { url, missing }
}

export function EyeImg({ image, className, alt }: { image: EyeImage; className?: string; alt?: string }) {
  const { url, missing } = useImageUrl(image.source)
  const t = useT()
  if (missing)
    return (
      <div className={cx('flex flex-col items-center justify-center gap-1 bg-panel-3 text-xs text-haze', className)}>
        <ImageOff size={18} /> {t('Image not available in this browser')}
      </div>
    )
  if (!url) return <div className={cx('skeleton', className)} />
  return <img src={url} alt={alt ?? `${image.laterality} eye fundus image`} className={cx('bg-black object-contain', className)} />
}

export function useEncounterContext(): { encounter?: Encounter; patient?: Patient } {
  const { id } = useParams()
  const encounter = useStore((s) => s.encounters.find((e) => e.id === id))
  const patient = useStore((s) => s.patients.find((p) => p.id === encounter?.patientId))
  return { encounter, patient }
}

export function EncounterNotFound() {
  const t = useT()
  return (
    <EmptyState
      title={t('Screening not found')}
      body={t('It may have been removed when demo data was reset, or the link is incorrect.')}
      action={<ButtonLink to="/dashboard">{t('Back to dashboard')}</ButtonLink>}
    />
  )
}

const STEPS = [
  { key: 'acquisition', label: 'Acquire' },
  { key: 'quality', label: 'Quality' },
  { key: 'analysis', label: 'Analyse' },
  { key: 'review', label: 'Review' },
  { key: 'report', label: 'Report' },
] as const

const reached: Record<Encounter['status'], number> = { acquisition: 0, quality: 1, analysis: 2, awaiting_review: 3, reviewed: 4 }

export function ScreeningHeader({ encounter, patient, current, actions }: { encounter: Encounter; patient: Patient; current: (typeof STEPS)[number]['key']; actions?: ReactNode }) {
  const maxIdx = reached[encounter.status]
  const curIdx = STEPS.findIndex((s) => s.key === current)
  const t = useT()
  return (
    <div className="mb-4 flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[12px] uppercase tracking-[0.14em] text-haze">
          {t('Screening')} · {formatDate(encounter.createdAt, true)}
          {encounter.mode === 'demo' && <Badge tone="demo">{t('Demo')}</Badge>}
        </div>
        <h1 className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-xl font-semibold tracking-tight">
          <Link to={`/patients/${patient.id}`} className="hover:text-electric hover:underline">{patient.name}</Link>
          <span className="text-sm font-normal text-haze">
            <span className="font-mono">{patient.clinicPatientId}</span> · {t('{age} y', { age: ageFrom(patient.dateOfBirth, patient.age) ?? '—' })} · {t('Operator {name}', { name: encounter.operator })}
          </span>
        </h1>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      <ol className="grid grid-cols-5 gap-1.5 lg:w-[620px] lg:shrink-0" aria-label={t('Screening steps')}>
        {STEPS.map((s, i) => {
          const done = i < maxIdx || (i === 4 && encounter.status === 'reviewed')
          const enabled = i <= maxIdx
          const here = i === curIdx
          const body = (
            <span
              className={cx(
                'flex w-full min-w-0 flex-col items-center justify-center gap-1 rounded-xl border px-1.5 py-2 text-xs font-medium transition-colors sm:flex-row sm:gap-2 sm:rounded-full sm:px-3',
                here ? 'border-electric bg-electric text-white shadow-sm' : done ? 'border-line-strong bg-panel-2 text-ink backdrop-blur-md hover:border-electric/60' : enabled ? 'border-line-strong bg-panel-2 text-haze backdrop-blur-md hover:border-electric/60' : 'border-line bg-panel-2 text-haze/60 backdrop-blur-md',
              )}
            >
              <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px]', here ? 'bg-white text-electric' : done ? 'bg-ok text-white' : 'bg-panel-3 text-haze')}>
                {done && !here ? <Check size={12} strokeWidth={3} aria-hidden /> : i + 1}
              </span>
              <span className="text-center leading-tight sm:truncate">{t(s.label)}</span>
            </span>
          )
          return (
            <li key={s.key} className="min-w-0" aria-current={here ? 'step' : undefined}>
              {enabled && !here ? <Link to={`/screenings/${encounter.id}/${s.key}`} className="block" title={t('Go to {step}', { step: t(s.label) })}>{body}</Link> : body}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/**
 * Full-height screening step: header + stepper on top, the step body filling the rest of the
 * viewport (it scrolls internally only if it cannot fit), and the fixed StepBar underneath.
 */
export function ScreeningFrame({ header, children, bar }: { header: ReactNode; children: ReactNode; bar: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {bar}
    </div>
  )
}

/** Navigation bar pinned to the bottom of the viewport: Back on the left, the next action always on the right. */
export function StepBar({ back, status, children }: { back?: { to: string; label: string }; status?: ReactNode; children?: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-void/50 shadow-[0_-12px_32px_-20px_rgb(0_0_0/0.45)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
        {back ? (
          <ButtonLink to={back.to} size="lg" variant="secondary" className="px-4">
            <ArrowLeft size={18} aria-hidden /> <span className="hidden sm:inline">{back.label}</span>
            <span className="sr-only sm:hidden">{back.label}</span>
          </ButtonLink>
        ) : null}
        <div className="line-clamp-2 min-w-0 flex-1 text-xs text-haze sm:text-sm" aria-live="polite">{status}</div>
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
    </div>
  )
}
