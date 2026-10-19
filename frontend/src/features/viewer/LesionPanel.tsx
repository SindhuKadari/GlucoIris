import { useEffect, useMemo, useState } from 'react'
import type { EvidenceArtifact, EyeImage } from '../../types/domain'
import { useImageUrl } from '../screening/common'
import { overlayUrl } from '../../lib/overlays'
import { cx } from '../../lib/util'
import { Badge, Card, SimulatedTag } from '../../components/ui'
import { useT } from '../../lib/i18n'

/**
 * Lesion segmentation (IDRiD ResNet34 U-Net): the per-class colour mask over the original image
 * plus one bounding box per lesion region. Class chips show counts and toggle that class's boxes.
 */
export function LesionPanel({ image, artifact, emptyMessage }: { image: EyeImage; artifact?: EvidenceArtifact; emptyMessage: string }) {
  const { url } = useImageUrl(image.source)
  const [overlay, setOverlay] = useState<string | null>(null)
  const [showMask, setShowMask] = useState(true)
  const [showBoxes, setShowBoxes] = useState(true)
  const [opacity, setOpacity] = useState(0.8)
  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  const boxes = artifact?.boxes ?? []
  const t = useT()

  useEffect(() => {
    let alive = true
    setOverlay(null)
    if (artifact) overlayUrl(artifact).then((u) => alive && setOverlay(u)).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [artifact])

  const classes = useMemo(
    () => (artifact?.legend ?? []).map((l) => ({ ...l, count: boxes.filter((b) => b.label === l.label).length })),
    [artifact, boxes],
  )
  const visible = boxes.filter((b) => !hidden[b.label])
  const ratio = image.width / image.height

  return (
    <Card className="flex min-w-0 flex-col lg:min-h-0 lg:overflow-y-auto">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-base font-semibold text-ink">{t('Lesions')} · U-Net</span>
          {artifact?.provenance === 'simulated' && <SimulatedTag />}
        </div>
        {artifact && <Badge tone={boxes.length ? 'warn' : 'ok'}>{boxes.length ? t(boxes.length === 1 ? '{n} lesion region' : '{n} lesion regions', { n: boxes.length }) : t('No lesions found')}</Badge>}
      </div>
      <div className="space-y-3 p-4">
        {artifact && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <label className="flex cursor-pointer items-center gap-2 text-ink">
              <input type="checkbox" checked={showMask} onChange={(e) => setShowMask(e.target.checked)} className="h-4 w-4 accent-[#245CEB]" /> {t('Mask')}
            </label>
            <label className={cx('flex items-center gap-2', boxes.length ? 'cursor-pointer text-ink' : 'text-haze')}>
              <input type="checkbox" disabled={!boxes.length} checked={showBoxes && boxes.length > 0} onChange={(e) => setShowBoxes(e.target.checked)} className="h-4 w-4 accent-[#245CEB]" /> {t('Boxes')}
            </label>
            <label className="flex flex-1 items-center gap-2 text-[12.5px] text-haze">
              {t('Opacity')}
              <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} disabled={!showMask} className="min-w-[80px] flex-1" aria-label={t('Lesion mask opacity')} />
              <span className="w-9 text-right font-mono">{Math.round(opacity * 100)}%</span>
            </label>
          </div>
        )}

        <div
          className="relative mx-auto w-full overflow-hidden rounded-xl border border-line bg-black"
          style={{ aspectRatio: `${image.width} / ${image.height}`, maxWidth: `max(260px, calc((100dvh - 470px) * ${ratio.toFixed(4)}))` }}
        >
          {url ? <img src={url} alt={t('Retinal fundus image')} className="absolute inset-0 h-full w-full object-fill" /> : <div className="skeleton absolute inset-0" />}
          {artifact && showMask && overlay && <img src={overlay} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-fill" style={{ opacity }} />}
          {showBoxes && visible.length > 0 && (
            <svg viewBox={`0 0 ${image.width} ${image.height}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
              {visible.map((b, i) => {
                const pad = image.width / 300
                return <rect key={i} x={b.x - pad} y={b.y - pad} width={b.w + 2 * pad} height={b.h + 2 * pad} fill="none" stroke={b.color} vectorEffect="non-scaling-stroke" style={{ strokeWidth: 1.5 }} />
              })}
            </svg>
          )}
          {!artifact && <div className="absolute inset-0 flex items-center justify-center bg-black/60 p-6 text-center text-sm text-white/85">{emptyMessage}</div>}
        </div>

        {artifact && (
          <>
            <ul className="grid gap-1.5 text-[12.5px] sm:grid-cols-2" aria-label={t('Lesion classes')}>
              {classes.map((c) => (
                <li key={c.label}>
                  <button
                    onClick={() => setHidden((h) => ({ ...h, [c.label]: !h[c.label] }))}
                    aria-pressed={!hidden[c.label]}
                    title={hidden[c.label] ? t('Show these boxes') : t('Hide these boxes')}
                    className={cx('flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-left transition-opacity', hidden[c.label] && 'opacity-45')}
                  >
                    <span className="flex items-center gap-2 text-ink">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} /> {t(c.label)}
                    </span>
                    <span className="font-mono text-haze">{c.count}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-[12px] leading-relaxed text-haze/90">{artifact.method}. {t('Predicted lesion pixels per class; boxes group nearby pixels of the same class. Model output — verify against the image.')}</p>
          </>
        )}
      </div>
    </Card>
  )
}
