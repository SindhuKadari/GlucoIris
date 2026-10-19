import { useEffect, useState, type ReactNode } from 'react'
import type { EvidenceArtifact, EyeImage } from '../../types/domain'
import { useImageUrl } from '../screening/common'
import { overlayUrl } from '../../lib/overlays'
import { cx } from '../../lib/util'
import { Card, SimulatedTag } from '../../components/ui'
import { useT } from '../../lib/i18n'

/**
 * One model's Grad-CAM: the heatmap over the original image plus ranked bounding boxes
 * around the regions that carried most of the heat (computed on the inference service,
 * ml/glucoiris_ml/cam_boxes.py). Boxes mark model evidence, not verified lesions.
 */
export function GradCamPanel({ title, badge, image, artifact, emptyMessage }: { title: string; badge?: ReactNode; image: EyeImage; artifact?: EvidenceArtifact; emptyMessage: string }) {
  const { url } = useImageUrl(image.source)
  const [overlay, setOverlay] = useState<string | null>(null)
  const [showHeat, setShowHeat] = useState(true)
  const [showBoxes, setShowBoxes] = useState(true)
  const [opacity, setOpacity] = useState(0.6)
  const regions = artifact?.camRegions ?? []
  const t = useT()

  useEffect(() => {
    let alive = true
    setOverlay(null)
    if (artifact) overlayUrl(artifact).then((u) => alive && setOverlay(u)).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [artifact])

  const ratio = image.width / image.height
  return (
    <Card className="flex min-w-0 flex-col lg:min-h-0 lg:overflow-y-auto">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-base font-semibold text-ink">{title}</span>
          {artifact?.provenance === 'simulated' && <SimulatedTag />}
        </div>
        {badge}
      </div>
      <div className="space-y-3 p-4">
        {artifact ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <label className="flex cursor-pointer items-center gap-2 text-ink">
              <input type="checkbox" checked={showHeat} onChange={(e) => setShowHeat(e.target.checked)} className="h-4 w-4 accent-[#245CEB]" /> {t('Heatmap')}
            </label>
            <label className={cx('flex items-center gap-2', regions.length ? 'cursor-pointer text-ink' : 'text-haze')}>
              <input type="checkbox" disabled={!regions.length} checked={showBoxes && regions.length > 0} onChange={(e) => setShowBoxes(e.target.checked)} className="h-4 w-4 accent-[#245CEB]" /> {t('Boxes')}
            </label>
            <label className="flex flex-1 items-center gap-2 text-[12.5px] text-haze">
              {t('Opacity')}
              <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} disabled={!showHeat} className="min-w-[80px] flex-1" aria-label={t('{name} heatmap opacity', { name: title })} />
              <span className="w-9 text-right font-mono">{Math.round(opacity * 100)}%</span>
            </label>
          </div>
        ) : null}

        <div
          className="relative mx-auto w-full overflow-hidden rounded-xl border border-line bg-black"
          // Fit the frame to the viewport height so both panels show without page scrolling.
          style={{ aspectRatio: `${image.width} / ${image.height}`, maxWidth: `max(260px, calc((100dvh - 470px) * ${ratio.toFixed(4)}))` }}
        >
          {url ? <img src={url} alt={t('Retinal fundus image')} className="absolute inset-0 h-full w-full object-fill" /> : <div className="skeleton absolute inset-0" />}
          {artifact && showHeat && overlay && <img src={overlay} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-fill transition-opacity duration-300" style={{ opacity }} />}
          {showBoxes && regions.length > 0 && (
            <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
              {regions.map((r) => (
                <g key={r.rank}>
                  <rect x={r.x * 1000} y={r.y * 1000} width={r.w * 1000} height={r.h * 1000} fill="none" stroke="#000" strokeOpacity={0.6} vectorEffect="non-scaling-stroke" style={{ strokeWidth: 4 }} />
                  <rect x={r.x * 1000} y={r.y * 1000} width={r.w * 1000} height={r.h * 1000} fill="none" stroke="#fff" vectorEffect="non-scaling-stroke" style={{ strokeWidth: 2 }} />
                </g>
              ))}
            </svg>
          )}
          {showBoxes &&
            regions.map((r) => (
              <span
                key={r.rank}
                className="pointer-events-none absolute -translate-y-full rounded-sm bg-black/70 px-1 font-mono text-[11px] font-semibold text-white"
                style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%` }}
              >
                #{r.rank}
              </span>
            ))}
          {!artifact && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 p-6 text-center text-sm text-white/85">{emptyMessage}</div>
          )}
        </div>

        {artifact && (
          <>
            <div className="flex items-center gap-2 text-[12px] text-haze">
              {t('Low')}
              <span className="h-2 flex-1 rounded-full" style={{ background: 'linear-gradient(90deg,#00008f,#0000ff,#00ffff,#ffff00,#ff0000,#8f0000)' }} />
              {t('High')}
            </div>
            {regions.length > 0 ? (
              <ol className="grid gap-1.5 text-[12.5px] sm:grid-cols-2">
                {regions.map((r) => (
                  <li key={r.rank} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-panel-2 px-2.5 py-1.5">
                    <span className="font-mono font-semibold text-ink">#{r.rank}</span>
                    <span className="text-haze">
                      {t('peak {peak} · {share}% of heat', { peak: r.peak.toFixed(2), share: Math.round(r.share * 100) })}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[12.5px] text-haze">{artifact.provenance === 'simulated' ? t('Simulated map — no regions are computed for demo output.') : t('No region above half of the peak heat.')}</p>
            )}
            <p className="text-[12px] leading-relaxed text-haze/90">{artifact.method}. {t("Boxes surround areas with at least half of the peak heat; they show where the model's evidence is concentrated, not verified lesions.")}</p>
          </>
        )}
      </div>
    </Card>
  )
}
