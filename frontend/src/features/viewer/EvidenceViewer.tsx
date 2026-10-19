import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { Columns2, Maximize, Minus, Plus, Square } from 'lucide-react'
import type { EvidenceArtifact, EyeImage, ModuleKey, ModuleState } from '../../types/domain'
import { useImageUrl } from '../screening/common'
import { enhancedUrl, ENHANCEMENT_METHOD } from '../../lib/enhance'
import { overlayUrl } from '../../lib/overlays'
import { cx } from '../../lib/util'
import { ModuleStatusBadge, SimulatedTag } from '../../components/ui'

type OverlayKey = 'gradcam_b4' | 'attribution' | 'vessels' | 'lesions'
const OVERLAY_MODULE: Record<OverlayKey, ModuleKey> = { gradcam_b4: 'dr_binary', attribution: 'attribution', vessels: 'vessels', lesions: 'lesions' }
const OVERLAY_TYPE: Record<OverlayKey, EvidenceArtifact['type']> = { gradcam_b4: 'gradcam_b4', attribution: 'attribution', vessels: 'vessel_mask', lesions: 'lesion_mask' }
const OVERLAY_LABEL: Record<OverlayKey, string> = { gradcam_b4: 'Grad-CAM (EfficientNet-B4)', attribution: 'Model attribution', vessels: 'Vessel mask', lesions: 'Lesion segmentation' }
const OVERLAY_MEANING: Record<OverlayKey, string> = {
  gradcam_b4: 'Regions that most increased the DR score. Not verified lesions or causal proof.',
  attribution: 'Regions associated with the classifier output. Not verified lesions or causal proof.',
  vessels: 'Retinal vessel mask. Not a DR diagnosis on its own.',
  lesions: 'Predicted pixel-level lesion classes. Not the classifier’s reasoning.',
}

/** Overlays are only drawn when their frame matches the source frame (spec §8). */
function aligned(a: EvidenceArtifact, img: EyeImage) {
  const src = img.width / img.height
  const art = a.mapping.artifactWidth / a.mapping.artifactHeight
  return a.mapping.transform === 'resize' && Math.abs(src - art) / src < 0.01
}

function useAsync<T>(fn: (() => Promise<T>) | null, deps: unknown[]) {
  const [v, setV] = useState<T | null>(null)
  useEffect(() => {
    let alive = true
    setV(null)
    fn?.().then((x) => alive && setV(x)).catch(() => alive && setV(null))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return v
}

export function EvidenceViewer({ image, artifacts, modules }: { image: EyeImage; artifacts: EvidenceArtifact[]; modules?: Record<ModuleKey, ModuleState> }) {
  const { url } = useImageUrl(image.source)
  const [base, setBase] = useState<'original' | 'enhanced'>('original')
  const [split, setSplit] = useState(false)
  const [on, setOn] = useState<Record<OverlayKey, boolean>>({ gradcam_b4: true, attribution: false, vessels: false, lesions: false })
  const [opacity, setOpacity] = useState<Record<OverlayKey, number>>({ gradcam_b4: 0.6, attribution: 0.6, vessels: 0.75, lesions: 0.8 })
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const [showBoxes, setShowBoxes] = useState(true)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)

  const enhanced = useAsync(base === 'enhanced' && url ? () => enhancedUrl(url) : null, [base, url])
  const art = (k: OverlayKey) => artifacts.find((a) => a.type === OVERLAY_TYPE[k])
  const urls = {
    gradcam_b4: useAsync(art('gradcam_b4') ? () => overlayUrl(art('gradcam_b4')!) : null, [art('gradcam_b4')?.id]),
    attribution: useAsync(art('attribution') ? () => overlayUrl(art('attribution')!) : null, [art('attribution')?.id]),
    vessels: useAsync(art('vessels') ? () => overlayUrl(art('vessels')!) : null, [art('vessels')?.id]),
    lesions: useAsync(art('lesions') ? () => overlayUrl(art('lesions')!) : null, [art('lesions')?.id]),
  }

  useEffect(() => setView({ scale: 1, x: 0, y: 0 }), [image.id])

  const zoomBy = (f: number) => setView((v) => {
    const scale = Math.min(8, Math.max(1, v.scale * f))
    return scale === 1 ? { scale, x: 0, y: 0 } : { ...v, scale }
  })
  // Native non-passive listener so wheel-zoom does not scroll the page.
  const frames = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = frames.current
    if (!el) return
    const onWheel = (e: globalThis.WheelEvent) => {
      // Plain wheel scrolls the page; Ctrl/⌘ + wheel (and trackpad pinch) zooms.
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  const onDown = (e: PointerEvent) => {
    if (view.scale === 1) return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
  }
  const onMove = (e: PointerEvent) => {
    if (!drag.current) return
    setView((v) => ({ ...v, x: drag.current!.vx + (e.clientX - drag.current!.x) / v.scale, y: drag.current!.vy + (e.clientY - drag.current!.y) / v.scale }))
  }
  const onKey = (e: KeyboardEvent) => {
    const step = 30 / view.scale
    if (e.key === '+' || e.key === '=') zoomBy(1.25)
    else if (e.key === '-') zoomBy(0.8)
    else if (e.key === '0') setView({ scale: 1, x: 0, y: 0 })
    else if (e.key === 'ArrowLeft') setView((v) => ({ ...v, x: v.x + step }))
    else if (e.key === 'ArrowRight') setView((v) => ({ ...v, x: v.x - step }))
    else if (e.key === 'ArrowUp') setView((v) => ({ ...v, y: v.y + step }))
    else if (e.key === 'ArrowDown') setView((v) => ({ ...v, y: v.y - step }))
    else return
    e.preventDefault()
  }

  const baseUrl = base === 'enhanced' ? enhanced : url
  const activeOverlays = (Object.keys(on) as OverlayKey[]).filter((k) => on[k] && urls[k] && art(k) && aligned(art(k)!, image))
  const lesionArt = art('lesions')
  const boxes = lesionArt?.boxes ?? []
  const boxesVisible = showBoxes && boxes.length > 0

  const frame = (withOverlays: boolean, label: string) => (
    <div
      className="relative mx-auto w-full overflow-hidden rounded-xl border border-line bg-black outline-none focus-visible:ring-2 focus-visible:ring-neon"
      // Cap the width so the whole frame fits the viewport height in the full-height review step.
      style={{ aspectRatio: `${image.width} / ${image.height}`, maxWidth: `max(280px, calc((100dvh - 420px) * ${(image.width / image.height).toFixed(4)}))` }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={() => (drag.current = null)}
      onKeyDown={onKey}
      tabIndex={0}
      role="img"
      aria-label={`${label}. Use plus and minus to zoom, arrow keys to pan.`}
    >
      <div
        className={cx('absolute inset-0 origin-center', view.scale > 1 ? 'cursor-grab active:cursor-grabbing' : '')}
        style={{ transform: `scale(${view.scale}) translate(${view.x}px, ${view.y}px)` }}
      >
        {baseUrl ? <img src={baseUrl} alt="" draggable={false} className="absolute inset-0 h-full w-full select-none object-fill" /> : <div className="skeleton absolute inset-0" />}
        {withOverlays &&
          activeOverlays.map((k) => (
            <img
              key={k}
              src={urls[k]!}
              alt=""
              draggable={false}
              className={cx('pointer-events-none absolute inset-0 h-full w-full select-none object-fill transition-opacity duration-300')}
              style={{ opacity: opacity[k] }}
            />
          ))}
        {withOverlays && boxesVisible && (
          <svg viewBox={`0 0 ${image.width} ${image.height}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
            {boxes.map((b, i) => {
              const pad = image.width / 400
              return (
                <rect
                  key={i}
                  x={b.x - pad}
                  y={b.y - pad}
                  width={b.w + 2 * pad}
                  height={b.h + 2 * pad}
                  fill="none"
                  stroke={b.color}
                  strokeWidth={image.width / 700}
                  vectorEffect="non-scaling-stroke"
                  style={{ strokeWidth: 1.5 }}
                />
              )
            })}
          </svg>
        )}
      </div>
      <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-void/70 px-2 py-1 font-mono text-[12px] uppercase tracking-wider text-ink/85 backdrop-blur">{label}</div>
      {view.scale > 1 && <div className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-void/70 px-2 py-1 font-mono text-[12px] text-ink/85">{view.scale.toFixed(1)}×</div>}
    </div>
  )

  const overlayRow = (k: OverlayKey): ReactNode => {
    const a = art(k)
    const m = modules?.[OVERLAY_MODULE[k]]
    const ok = !!a && aligned(a, image)
    return (
      <li key={k} className="space-y-2 px-3.5 py-3">
        <div className="flex items-center justify-between gap-2">
          <label className={cx('flex items-center gap-2 text-sm', ok ? 'cursor-pointer text-ink' : 'text-haze')}>
            <input type="checkbox" disabled={!ok} checked={on[k] && ok} onChange={(e) => setOn((o) => ({ ...o, [k]: e.target.checked }))} className="h-4 w-4 accent-[#245CEB]" />
            {OVERLAY_LABEL[k]}
          </label>
          <div className="flex items-center gap-1.5">
            {a?.provenance === 'simulated' && <SimulatedTag />}
            {a?.provenance === 'reference_annotation' && <SimulatedTag label="Reference" />}
            {m ? <ModuleStatusBadge status={m.status} /> : null}
          </div>
        </div>
        {a && !ok && <p className="text-xs text-bad">Overlay frame does not match the source image — hidden to avoid misalignment.</p>}
        {ok ? (
          <>
            <p className="text-[12.5px] leading-relaxed text-haze">{a!.method}. {OVERLAY_MEANING[k]}</p>
            {on[k] && (
              <>
                <label className="flex items-center gap-3 text-[12.5px] text-haze">
                  Opacity
                  <input type="range" min={0.1} max={1} step={0.05} value={opacity[k]} onChange={(e) => setOpacity((o) => ({ ...o, [k]: Number(e.target.value) }))} className="flex-1" aria-label={`${OVERLAY_LABEL[k]} opacity`} />
                  <span className="w-8 text-right font-mono">{Math.round(opacity[k] * 100)}%</span>
                </label>
                <div className="flex flex-wrap gap-3">
                  {k === 'gradcam_b4' ? (
                    <div className="flex w-full items-center gap-2 text-[12px] text-haze">
                      Low
                      <span className="h-2 flex-1 rounded-full" style={{ background: 'linear-gradient(90deg,#00008f,#0000ff,#00ffff,#ffff00,#ff0000,#8f0000)' }} />
                      High
                    </div>
                  ) : k === 'attribution' ? (
                    <div className="flex w-full items-center gap-2 text-[12px] text-haze">
                      Low
                      <span className="h-2 flex-1 rounded-full" style={{ background: 'linear-gradient(90deg,#1428a0,#245CEB,#00a6ff,#B9D4FF)' }} />
                      High
                    </div>
                  ) : (
                    a!.legend.map((l) => (
                      <span key={l.label} className="flex items-center gap-1.5 text-[12px] text-haze">
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} /> {l.label}
                      </span>
                    ))
                  )}
                </div>
              </>
            )}
          </>
        ) : (
          !a && <p className="text-[12.5px] leading-relaxed text-haze">{m?.message ?? 'Not produced for this image.'}</p>
        )}
      </li>
    )
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="Base image">
            {(['original', 'enhanced'] as const).map((b) => (
              <button key={b} onClick={() => setBase(b)} aria-pressed={base === b} className={cx('rounded-md px-3 py-1.5 text-xs capitalize transition-colors', base === b ? 'bg-electric/20 text-ink' : 'text-haze hover:text-ink')}>
                {b}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setSplit((s) => !s)} aria-pressed={split} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-haze hover:text-ink" title="Side-by-side">
              {split ? <Square size={13} /> : <Columns2 size={13} />} {split ? 'Single' : 'Side by side'}
            </button>
            <button onClick={() => zoomBy(1 / 1.25)} className="rounded-lg border border-line p-1.5 text-haze hover:text-ink" aria-label="Zoom out"><Minus size={14} /></button>
            <button onClick={() => zoomBy(1.25)} className="rounded-lg border border-line p-1.5 text-haze hover:text-ink" aria-label="Zoom in"><Plus size={14} /></button>
            <button onClick={() => setView({ scale: 1, x: 0, y: 0 })} className="rounded-lg border border-line p-1.5 text-haze hover:text-ink" aria-label="Reset view"><Maximize size={14} /></button>
          </div>
        </div>
        <div ref={frames} className={cx('grid gap-3', split && 'md:grid-cols-2')}>
          {split && frame(false, base === 'enhanced' ? 'Enhanced · no overlays' : 'Original · no overlays')}
          {frame(true, `${base}${activeOverlays.length ? ` + ${activeOverlays.map((k) => `${art(k)?.provenance === 'simulated' ? 'simulated ' : art(k)?.provenance === 'reference_annotation' ? 'reference ' : ''}${OVERLAY_LABEL[k].toLowerCase()}`).join(' + ')}` : ''}`)}
        </div>
        <p className="text-[12.5px] text-haze">
          Ctrl/⌘ + scroll or +/− to zoom · drag or arrow keys to pan{base === 'enhanced' ? ` · ${ENHANCEMENT_METHOD}. Not a model input.` : ''}
        </p>
      </div>
      <div>
        <div className="mb-2 text-xs font-medium text-ink">Evidence layers</div>
        <ul className="divide-y divide-line rounded-xl border border-line bg-panel-2/40">
          {(['gradcam_b4', 'vessels', 'lesions'] as OverlayKey[]).map(overlayRow)}
          <li className="space-y-2 px-3.5 py-3">
            <label className={cx('flex items-center gap-2 text-sm', boxes.length ? 'cursor-pointer text-ink' : 'text-haze')}>
              <input type="checkbox" disabled={!boxes.length} checked={boxesVisible} onChange={(e) => setShowBoxes(e.target.checked)} className="h-4 w-4 accent-[#245CEB]" />
              Lesion bounding boxes
            </label>
            {boxes.length ? (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-haze">
                {Object.entries(boxes.reduce<Record<string, { n: number; color: string }>>((acc, b) => ({ ...acc, [b.label]: { n: (acc[b.label]?.n ?? 0) + 1, color: b.color } }), {})).map(([label, v]) => (
                  <span key={label} className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm border-2" style={{ borderColor: v.color }} /> {label} · {v.n}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[12.5px] text-haze">{lesionArt ? 'No lesion regions above threshold.' : 'Requires the lesion segmentation model.'}</p>
            )}
          </li>
        </ul>
        <p className="mt-2 text-[12.5px] leading-relaxed text-haze/80">Attribution and segmentation are kept as separate layers. Where they disagree, that disagreement is part of the evidence.</p>
      </div>
    </div>
  )
}
