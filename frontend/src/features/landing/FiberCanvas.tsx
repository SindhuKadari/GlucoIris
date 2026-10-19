import { useEffect, useRef } from 'react'
import { FiberField } from './fiberField'
import { cx } from '../../lib/util'

/** Fixed full-bleed procedural background driven by page scroll. */
export function FiberCanvas({ fixedScene, fibres, className }: { fixedScene?: number; fibres?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current!
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const small = window.matchMedia('(max-width: 767px), (pointer: coarse)').matches
    const field = new FiberField(canvas, { fibres: Math.min(fibres ?? 1100, small ? 520 : 1100), animate: !reduced && !small })

    const onResize = () => field.resize(window.innerWidth, window.innerHeight)
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      const p = max > 0 ? window.scrollY / max : 0
      // Reduced motion: hold the iris instead of morphing with scroll.
      field.setProgress(fixedScene ?? (reduced ? 1 : p * 3))
    }
    const onPointer = (e: PointerEvent) =>
      field.setPointer(e.clientX / window.innerWidth - 0.5, e.clientY / window.innerHeight - 0.5)

    onResize()
    onScroll()
    field.startLoop()
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pointermove', onPointer, { passive: true })
    return () => {
      field.destroy()
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pointermove', onPointer)
    }
  }, [fixedScene, fibres])

  return (
    <div className={cx('fiber-canvas pointer-events-none fixed inset-0 overflow-hidden bg-void', className ?? 'z-0')} aria-hidden>
      <canvas ref={ref} className="h-full w-full" />
    </div>
  )
}
