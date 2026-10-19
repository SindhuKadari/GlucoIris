import { useState } from 'react'
import type { Grade, Laterality } from '../../types/domain'
import { formatDate, GRADE_LABEL } from '../../lib/util'
import { useT } from '../../lib/i18n'

export interface GradePoint {
  date: string
  eye: Laterality
  grade: Grade
  source: 'clinician' | 'model'
  label: string
}

// Validated pair (dark surface #0B1120): OD blue, OS ochre; marker shape is the secondary cue.
const SERIES: Record<Laterality, { color: string; name: string }> = {
  right: { color: '#4A83ED', name: 'DR grade' },
  left: { color: '#F7FAFF', name: 'DR grade (second image)' },
}

/** Grade over visits, one line per eye. Clinician grades are solid; model-only points hollow. */
export function GradeTimeline({ points }: { points: GradePoint[] }) {
  const [hover, setHover] = useState<GradePoint | null>(null)
  const t = useT()
  const dates = [...new Set(points.map((p) => p.date))].sort()
  if (dates.length < 1) return null
  const W = 640, H = 220, L = 118, R = 24, T = 16, B = 36
  // Time-proportional x axis so uneven visit intervals read honestly.
  const t0 = new Date(dates[0]).getTime()
  const t1 = new Date(dates[dates.length - 1]).getTime()
  const x = (d: string) => (t1 === t0 ? (L + W - R) / 2 : L + ((W - L - R) * (new Date(d).getTime() - t0)) / (t1 - t0))
  const y = (g: number) => T + ((H - T - B) * (4 - g)) / 4
  const series = (['right', 'left'] as Laterality[]).filter((l) => points.some((p) => p.eye === l))

  return (
    <div className="relative">
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-haze" aria-hidden>
        {series.map((l) => (
          <span key={l} className="flex items-center gap-1.5">
            <svg width="12" height="12">
              {l === 'right' ? <circle cx="6" cy="6" r="4.5" fill={SERIES[l].color} /> : <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" fill={SERIES[l].color} />}
            </svg>
            {t(SERIES[l].name)}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <svg width="12" height="12"><circle cx="6" cy="6" r="4" fill="none" style={{ stroke: 'var(--color-haze)' }} strokeWidth="1.5" /></svg>
          Model only (not clinician-confirmed)
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={t('DR grade by visit')}>
        {[0, 1, 2, 3, 4].map((g) => (
          <g key={g}>
            <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} style={{ stroke: 'var(--color-line)' }} />
            <text x={L - 10} y={y(g) + 4} textAnchor="end" fontSize="12.5" style={{ fill: 'var(--color-haze)' }}>
              {GRADE_LABEL[g as Grade]}
            </text>
          </g>
        ))}
        {dates.map((d, i) => (
          <text key={d} x={x(d)} y={H - 12} textAnchor={dates.length > 1 && i === dates.length - 1 ? 'end' : dates.length > 1 && i === 0 ? 'start' : 'middle'} fontSize="12.5" style={{ fill: 'var(--color-haze)' }}>
            {formatDate(d)}
          </text>
        ))}
        {series.map((l) => {
          const pts = points.filter((p) => p.eye === l).sort((a, b) => a.date.localeCompare(b.date))
          const c = SERIES[l].color
          const off = series.length < 2 ? 0 : l === 'right' ? -3 : 3
          return (
            <g key={l}>
              {pts.length > 1 && <polyline points={pts.map((p) => `${x(p.date)},${y(p.grade) + off}`).join(' ')} fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round" opacity="0.85" />}
              {pts.map((p) => {
                const cx = x(p.date), cy = y(p.grade) + off
                const solid = p.source === 'clinician'
                const common = { style: { fill: solid ? c : 'var(--color-panel)', stroke: solid ? 'var(--color-panel)' : c }, strokeWidth: 2 }
                return (
                  <g key={p.date + l} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(p)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${t(SERIES[l].name)} ${formatDate(p.date)}: ${p.label}`}>
                    <circle cx={cx} cy={cy} r="12" fill="transparent" />
                    {l === 'right' ? <circle cx={cx} cy={cy} r="5" {...common} /> : <rect x={cx - 5} y={cy - 5} width="10" height="10" rx="2" {...common} />}
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute right-2 top-8 rounded-lg border border-line-strong bg-panel-2 px-3 py-2 text-xs shadow-xl">
          <div className="text-ink">{t(SERIES[hover.eye].name)} · {formatDate(hover.date)}</div>
          <div className="mt-0.5 text-haze">{hover.label}</div>
        </div>
      )}
    </div>
  )
}
