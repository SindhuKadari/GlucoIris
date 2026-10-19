import { forwardRef, useEffect, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, MinusCircle, X, XCircle } from 'lucide-react'
import type { ClinicianGrade, Grade, ModuleStatus, QualityOutcome } from '../types/domain'
import { cx, GRADE_COLOR, GRADE_LABEL, MODULE_STATUS_LABEL } from '../lib/util'
import { useT } from '../lib/i18n'

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
const variants: Record<Variant, string> = {
  primary: 'bg-electric text-white shadow-sm hover:brightness-110 disabled:bg-panel-3 disabled:text-haze disabled:shadow-none disabled:hover:brightness-100',
  secondary: 'border border-line-strong bg-panel-2 text-ink backdrop-blur-md hover:border-electric/60 hover:bg-panel-3',
  ghost: 'text-haze hover:bg-panel-2 hover:text-ink',
  danger: 'border border-bad/40 bg-bad/10 text-bad hover:bg-bad/20',
}
const sizes = { sm: 'h-8 px-3 text-xs gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-6 text-base font-semibold gap-2' }

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: keyof typeof sizes
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-medium transition-[color,background-color,border-color,filter] duration-200 disabled:cursor-not-allowed disabled:opacity-70',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 size={14} className="animate-spin" aria-hidden />}
      {children}
    </button>
  )
})

export function ButtonLink({ to, variant = 'secondary', size = 'md', className, children }: { to: string; variant?: Variant; size?: keyof typeof sizes; className?: string; children: ReactNode }) {
  return (
    <Link to={to} className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-medium transition-colors duration-200', variants[variant], sizes[size], className)}>
      {children}
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export function Card({ children, className, as: Tag = 'section' }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' }) {
  return <Tag className={cx('glass rounded-2xl', className)}>{children}</Tag>
}

export function CardHeader({ title, subtitle, action, icon }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="mt-0.5 text-cyan">{icon}</div>}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-haze">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 font-mono text-[12.5px] uppercase tracking-[0.16em] text-cyan/80">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-ink md:text-[28px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-haze">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-haze/60">{icon}</div>}
      <div className="text-sm font-medium text-ink">{title}</div>
      {body && <p className="mt-1 max-w-sm text-xs text-haze">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Notice({ tone = 'info', title, children, className }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; title?: ReactNode; children?: ReactNode; className?: string }) {
  const tones = {
    info: 'border-electric/30 bg-electric/10 text-ink',
    warn: 'border-warn/35 bg-warn/10 text-ink',
    bad: 'border-bad/40 bg-bad/10 text-ink',
    ok: 'border-ok/35 bg-ok/10 text-ink',
  }
  const icons = {
    info: <CircleDashed size={16} className="text-cyan" />,
    warn: <AlertTriangle size={16} className="text-warn" />,
    bad: <XCircle size={16} className="text-bad" />,
    ok: <CheckCircle2 size={16} className="text-ok" />,
  }
  return (
    <div role={tone === 'bad' ? 'alert' : 'note'} className={cx('flex gap-3 rounded-2xl border px-4 py-3 text-sm backdrop-blur-xl', tones[tone], className)}>
      <div className="mt-0.5 shrink-0">{icons[tone]}</div>
      <div className="min-w-0">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={cx('text-[14.5px] leading-relaxed text-haze', !!title && 'mt-0.5')}>{children}</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export type Tone = 'neutral' | 'info' | 'warn' | 'bad' | 'ok' | 'demo'
const toneCls: Record<Tone, string> = {
  neutral: 'border-line-strong bg-panel-2 text-haze',
  info: 'border-electric/40 bg-electric/10 text-cyan',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  bad: 'border-bad/45 bg-bad/10 text-bad',
  ok: 'border-ok/40 bg-ok/10 text-ok',
  demo: 'border-cyan/30 bg-cyan/10 text-cyan',
}

export function Badge({ tone = 'neutral', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12.5px] font-medium', toneCls[tone], className)}>
      {children}
    </span>
  )
}

export function SimulatedTag({ label = 'Simulated' }: { label?: string }) {
  const t = useT()
  return (
    <span className="inline-flex items-center rounded border border-cyan/40 bg-cyan/10 px-1.5 py-px font-mono text-[11.5px] font-medium uppercase tracking-[0.12em] text-cyan">
      {t(label)}
    </span>
  )
}

export function GradeChip({ grade, size = 'md' }: { grade: ClinicianGrade | null; size?: 'sm' | 'md' }) {
  const t = useT()
  if (grade === null) return <Badge>{t('Not recorded')}</Badge>
  if (grade === 'ungradeable') return <Badge tone="warn">{t('Unable to screen')}</Badge>
  if (grade === 'not_screened') return <Badge>{t('Not screened')}</Badge>
  const g = grade as Grade
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line-strong bg-panel-2 font-medium text-ink', size === 'sm' ? 'px-2 py-0.5 text-[12.5px]' : 'px-2.5 py-1 text-xs')}>
      <span className="h-2 w-2 rounded-full" style={{ background: GRADE_COLOR[g] }} aria-hidden />
      <span className="font-mono text-haze">G{g}</span> {t(GRADE_LABEL[g])}
    </span>
  )
}

export function QualityBadge({ outcome, overridden }: { outcome?: QualityOutcome; overridden?: boolean }) {
  const t = useT()
  if (!outcome) return <Badge>{t('Not assessed')}</Badge>
  if (outcome === 'acceptable') return <Badge tone="ok"><CheckCircle2 size={11} /> {t('Acceptable')}</Badge>
  if (outcome === 'borderline') return <Badge tone="warn"><AlertTriangle size={11} /> {t('Borderline')}{overridden ? ` · ${t('accepted')}` : ''}</Badge>
  if (outcome === 'ungradeable') return <Badge tone="bad"><XCircle size={11} /> {t('Ungradeable')}</Badge>
  return <Badge><MinusCircle size={11} /> {t('Unavailable')}</Badge>
}

export function ModuleStatusBadge({ status }: { status: ModuleStatus }) {
  const t = useT()
  const map: Record<ModuleStatus, { tone: Tone; icon: ReactNode }> = {
    unavailable: { tone: 'neutral', icon: <MinusCircle size={11} /> },
    queued: { tone: 'neutral', icon: <CircleDashed size={11} /> },
    processing: { tone: 'info', icon: <Loader2 size={11} className="animate-spin" /> },
    completed: { tone: 'ok', icon: <CheckCircle2 size={11} /> },
    failed: { tone: 'bad', icon: <XCircle size={11} /> },
  }
  return (
    <Badge tone={map[status].tone}>
      {map[status].icon}
      {t(MODULE_STATUS_LABEL[status])}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

const inputCls =
  'w-full rounded-lg border border-line-strong bg-panel-2 px-3 py-2.5 text-sm text-ink placeholder:text-haze/50 transition-colors focus:border-electric focus:outline-none focus:ring-2 focus:ring-electric/25 disabled:opacity-60 aria-[invalid=true]:border-bad/70'

export function Field({ label, hint, error, children, required, htmlFor }: { label: string; hint?: string; error?: string; children: ReactNode; required?: boolean; htmlFor?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-ink/90">
        {label}
        {required && <span className="ml-0.5 text-cyan" aria-hidden>*</span>}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs text-bad" role="alert">{error}</p> : hint ? <p className="mt-1 text-xs text-haze">{hint}</p> : null}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(inputCls, className)} {...rest} />
})

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(inputCls, 'appearance-none bg-[length:12px] bg-[right_12px_center] bg-no-repeat pr-8', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239BAAC2' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...rest}>
      {children}
    </select>
  )
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(inputCls, 'min-h-[88px] resize-y', className)} {...rest} />
}

export function useFieldId(prefix: string) {
  return `${prefix}-${useId().replace(/:/g, '')}`
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export function Dialog({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const t = useT()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-void/75 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-lg rounded-t-2xl border border-line-strong bg-panel shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-haze hover:bg-panel-2 hover:text-ink" aria-label={t('Close dialog')}>
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="glass rounded-xl px-4 py-3.5">
      <div className="text-xs text-haze">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-[12.5px] text-haze/80">{hint}</div>}
    </div>
  )
}

export function ProgressBar({ value, tone = 'info' }: { value: number; tone?: 'info' | 'ok' | 'bad' }) {
  const c = tone === 'ok' ? 'bg-ok' : tone === 'bad' ? 'bg-bad' : 'bg-electric'
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-3" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full transition-[width] duration-300', c)} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  )
}
