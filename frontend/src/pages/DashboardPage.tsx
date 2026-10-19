import { useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { ChevronRight, ClipboardCheck, PlusCircle, Search, UserPlus } from 'lucide-react'
import { useStore, encountersFor, latestJob, patientStatus } from '../store/store'
import { ButtonLink, Input, type Tone } from '../components/ui'
import { ageFrom, cx, formatDate } from '../lib/util'
import { useT } from '../lib/i18n'

type Filter = 'all' | 'review' | 'referred' | 'progress' | 'none'

const DOT: Record<Tone, string> = {
  neutral: 'bg-haze',
  info: 'bg-cyan',
  warn: 'bg-warn',
  bad: 'bg-bad',
  ok: 'bg-ok',
  demo: 'bg-cyan',
}

function StatusDot({ tone, label }: { tone: Tone; label: string }) {
  const t = useT()
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-xs text-haze">
      <span className={cx('h-2 w-2 rounded-full', DOT[tone])} aria-hidden />
      {t(label)}
    </span>
  )
}

function Panel({ title, icon, count, children }: { title: string; icon: ReactNode; count?: number; children: ReactNode }) {
  return (
    <section className="card rounded-2xl" aria-labelledby="queue-title">
      <div className="flex items-center justify-between px-5 pb-2 pt-5">
        <h2 id="queue-title" className="flex items-center gap-2.5 text-lg font-semibold text-ink">
          <span className="text-cyan" aria-hidden>{icon}</span>
          {title}
        </h2>
        {count !== undefined && <span className="rounded-full bg-electric/15 px-3 py-0.5 text-sm font-semibold text-cyan">{count}</span>}
      </div>
      {children}
    </section>
  )
}

function Row({ to, title, meta, right }: { to: string; title: string; meta: string; right?: ReactNode }) {
  return (
    <Link to={to} className="mx-2 flex items-center gap-3 rounded-xl px-4 py-3 transition-colors hover:bg-panel-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-medium text-ink">{title}</div>
        <div className="truncate text-sm text-haze">{meta}</div>
      </div>
      {right}
      <ChevronRight size={18} className="shrink-0 text-haze" aria-hidden />
    </Link>
  )
}

export default function DashboardPage() {
  const state = useStore()
  const [params] = useSearchParams()
  const queueOnly = params.get('view') === 'queue'
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const t = useT()

  const rows = useMemo(
    () =>
      state.patients.map((p) => {
        const encs = encountersFor(state, p.id)
        return { p, encs, last: encs[0], status: patientStatus(state, p.id) }
      }),
    [state],
  )

  const queue = state.encounters.filter((e) => e.status === 'awaiting_review').sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  const filtered = rows
    .filter((r) => {
      const term = q.trim().toLowerCase()
      if (term && !r.p.name.toLowerCase().includes(term) && !r.p.clinicPatientId.toLowerCase().includes(term)) return false
      if (filter === 'review') return r.status.label === 'Awaiting review'
      if (filter === 'referred') return r.status.tone === 'bad' || r.status.label === 'Referred'
      if (filter === 'progress') return r.status.label === 'Screening in progress' || r.status.label === 'Recapture needed'
      if (filter === 'none') return !r.encs.length
      return true
    })
    .sort((a, b) => (b.last?.createdAt ?? b.p.createdAt).localeCompare(a.last?.createdAt ?? a.p.createdAt))

  const patientName = (id: string) => state.patients.find((p) => p.id === id)?.name ?? t('Unknown patient')

  const queueList = (
    <Panel title={t('Review queue')} icon={<ClipboardCheck size={20} />} count={queue.length}>
      {queue.length === 0 ? (
        <p className="px-5 pb-6 pt-2 text-base text-haze">{t('Nothing awaiting review.')}</p>
      ) : (
        <div className="pb-3">
          {queue.map((e) => {
            const job = latestJob(state, e.id)
            const cls = state.classifications.filter((c) => c.jobId === job?.id)
            const flagged = cls.filter((c) => c.referableFlag).length
            const failed = job ? Object.values(job.modules).some((m) => Object.values(m).some((s) => s.status === 'failed')) : false
            return (
              <Row
                key={e.id}
                to={`/screenings/${e.id}/review`}
                title={patientName(e.patientId)}
                meta={formatDate(e.createdAt)}
                right={
                  flagged > 0 || failed ? (
                    <StatusDot tone={failed ? 'bad' : 'warn'} label={failed ? t('Check') : flagged > 1 ? t('{n} flags', { n: flagged }) : t('{n} flag', { n: flagged })} />
                  ) : undefined
                }
              />
            )
          })}
        </div>
      )}
    </Panel>
  )

  if (queueOnly) {
    return (
      <div>
        <h1 className="mb-6 text-3xl font-semibold tracking-tight">{t('Review queue')}</h1>
        <div className="max-w-2xl">{queueList}</div>
      </div>
    )
  }

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: t('All') },
    { key: 'review', label: t('To review') },
    { key: 'referred', label: t('Referred') },
    { key: 'progress', label: t('In progress') },
    { key: 'none', label: t('New') },
  ]

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">{t('Dashboard')}</h1>
        <ButtonLink to="/screenings/new" variant="primary" size="lg">
          <PlusCircle size={20} aria-hidden /> {t('New screening')}
        </ButtonLink>
      </div>

      <div className="grid gap-8 xl:grid-cols-[1fr_360px]">
        <section className="min-w-0" aria-label={t('Patients')}>
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search size={20} className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-haze" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search by name or ID')} className="h-12 rounded-xl pl-12" aria-label={t('Search patients')} />
            </div>
          </div>

          <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label={t('Filter patients')}>
            {filters.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={cx(
                  'rounded-full border px-4 py-2 text-sm font-medium transition-colors',
                  filter === f.key ? 'border-electric bg-electric text-white' : 'border-line-strong bg-panel-2 text-ink backdrop-blur-md hover:bg-panel-3',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
            <Link
              to="/screenings/new?register=1"
              className="card flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-2xl border-dashed text-base font-medium text-cyan"
            >
              <UserPlus size={26} aria-hidden />
              {t('New patient')}
            </Link>
            {filtered.map(({ p, last, status }, i) => (
              <motion.div key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.03 }}>
                <Link to={`/patients/${p.id}`} className="card flex h-full min-h-[140px] flex-col justify-between rounded-2xl p-5">
                  <div>
                    <div className="truncate text-lg font-semibold text-ink">{p.name}</div>
                    <div className="mt-0.5 text-sm text-haze">
                      {p.clinicPatientId} · {t('{age} y', { age: ageFrom(p.dateOfBirth, p.age) ?? '—' })}
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-2">
                    <StatusDot tone={status.tone as Tone} label={status.label} />
                    <span className="text-sm text-haze">{last ? formatDate(last.createdAt) : ''}</span>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
          {filtered.length === 0 && <p className="mt-6 text-center text-base text-haze">{t('No matching patients.')}</p>}
        </section>

        <aside className="space-y-6" aria-label={t('Review queue')}>
          {queueList}
        </aside>
      </div>
    </div>
  )
}
