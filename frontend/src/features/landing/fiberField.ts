/**
 * Procedural fibre-optic scene for the landing page (original code, no video asset).
 *
 * Every fibre is a quadratic curve with a pose in each of four scenes:
 *   0 strands — bundled cables with glowing tips
 *   1 iris    — radial fibres around a dark pupil inside a spoked white ring
 *   2 burst   — fibres and spokes thrown outward into an arch
 *   3 retina  — fibres settle into a branching vessel tree around an optic disc
 * Scroll position picks a continuous scene value; poses are interpolated with a
 * per-fibre stagger, rendered additively with a cheap downsampled bloom.
 */

type Vec = [number, number]

interface Pose {
  p0: Vec
  c: Vec
  p1: Vec
  w: number
  a: number
  tip: number
}

interface Fibre {
  poses: Pose[]
  color: [number, number, number]
  delay: number
  phase: number
}

interface Spoke {
  angle: number
  phase: number
}

interface Particle {
  x: number
  y: number
  r: number
  vx: number
  vy: number
  phase: number
}

const SCENES = 4

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerpV = (a: Vec, b: Vec, t: number): Vec => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]
const smooth = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (t: number) => Math.max(0, Math.min(1, t))

function buildVesselTree(rand: () => number) {
  const segs: { p0: Vec; c: Vec; p1: Vec; w: number }[] = []
  const disc: Vec = [-0.2, 0.02]
  const grow = (start: Vec, angle: number, len: number, w: number, depth: number) => {
    if (depth > 4 || len < 0.03) return
    const bend = (rand() - 0.5) * 0.7
    const end: Vec = [start[0] + Math.cos(angle) * len, start[1] + Math.sin(angle) * len]
    const mid: Vec = [
      (start[0] + end[0]) / 2 + Math.cos(angle + Math.PI / 2) * len * bend * 0.4,
      (start[1] + end[1]) / 2 + Math.sin(angle + Math.PI / 2) * len * bend * 0.4,
    ]
    segs.push({ p0: start, c: mid, p1: end, w })
    const children = depth < 2 ? 2 : rand() < 0.75 ? 2 : 1
    for (let k = 0; k < children; k++) {
      const spread = (k === 0 ? -1 : 1) * (0.25 + rand() * 0.35)
      grow(end, angle + spread * (depth === 0 ? 0.6 : 1), len * (0.62 + rand() * 0.18), w * 0.72, depth + 1)
    }
  }
  // Four arcades leave the disc: superior/inferior temporal and nasal.
  const arcades = [-0.55, 0.55, -2.45, 2.45]
  for (const a of arcades) grow(disc, a, a > 0 && a < 1.5 ? 0.2 : a < 0 && a > -1.5 ? 0.2 : 0.13, 1, 0)
  for (let i = 0; i < 6; i++) grow(disc, -Math.PI + rand() * Math.PI * 2, 0.09 + rand() * 0.05, 0.7, 2)
  return { segs, disc }
}

export interface FiberFieldOptions {
  fibres: number
  animate: boolean
}

export class FiberField {
  private ctx: CanvasRenderingContext2D
  private bloom: HTMLCanvasElement
  private bloomCtx: CanvasRenderingContext2D
  private glow: HTMLCanvasElement
  private fibres: Fibre[] = []
  private spokes: Spoke[] = []
  private particles: Particle[] = []
  private disc: Vec = [0, 0]
  private w = 0
  private h = 0
  private dpr = 1
  private target = 0
  private scene = 0
  private pointer: Vec = [0, 0]
  private pointerSmoothed: Vec = [0, 0]
  private raf = 0
  private start = performance.now()

  constructor(private canvas: HTMLCanvasElement, private opts: FiberFieldOptions) {
    this.ctx = canvas.getContext('2d')!
    this.bloom = document.createElement('canvas')
    this.bloomCtx = this.bloom.getContext('2d')!
    this.glow = this.makeGlowSprite()
    this.build()
  }

  private makeGlowSprite() {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(245,248,255,1)')
    grad.addColorStop(0.18, 'rgba(160,215,255,0.85)')
    grad.addColorStop(0.45, 'rgba(41,121,255,0.28)')
    grad.addColorStop(1, 'rgba(41,121,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
    return c
  }

  private build() {
    const rand = rng(20261013)
    const N = this.opts.fibres
    const cables = Math.max(24, Math.round(N / 14))
    const { segs, disc } = buildVesselTree(rand)
    this.disc = disc

    // Cable geometry for scene 0: hanging strands sweeping from upper right.
    const cableDefs = Array.from({ length: cables }, (_, k) => {
      const u = k / cables
      const top: Vec = [0.05 + u * 0.75 + (rand() - 0.5) * 0.1, -0.75 - rand() * 0.2]
      const tip: Vec = [-0.55 + u * 1.25 + (rand() - 0.5) * 0.18, 0.05 + rand() * 0.55]
      const c: Vec = [lerp(top[0], tip[0], 0.5) + 0.25 + rand() * 0.15, lerp(top[1], tip[1], 0.45)]
      return { top, tip, c, thick: 0.004 + rand() * 0.008 }
    })

    for (let i = 0; i < N; i++) {
      const u = i / N
      const theta = u * Math.PI * 2 + (rand() - 0.5) * 0.05
      const cable = cableDefs[i % cables]
      const off = (rand() - 0.5) * cable.thick * 2
      const lead = i < cables

      const strand: Pose = {
        p0: [cable.top[0] + off, cable.top[1]],
        c: [cable.c[0] + off, cable.c[1]],
        p1: [cable.tip[0] + off * 0.6, cable.tip[1]],
        w: 1.1,
        a: 0.055 + rand() * 0.05,
        tip: lead ? 1 : 0,
      }

      const ripple = Math.sin(theta * 7) * 0.012 + Math.sin(theta * 13 + 1.3) * 0.008
      const r0 = 0.1 + rand() * 0.025
      const r1 = 0.215 + ripple + rand() * 0.05
      const twist = (rand() - 0.5) * 0.12
      const iris: Pose = {
        p0: [Math.cos(theta) * r0, Math.sin(theta) * r0],
        c: [Math.cos(theta + twist) * (r0 + r1) * 0.5, Math.sin(theta + twist) * (r0 + r1) * 0.5],
        p1: [Math.cos(theta + twist * 0.4) * r1, Math.sin(theta + twist * 0.4) * r1],
        w: 1 + rand() * 0.7,
        a: 0.38 + rand() * 0.3,
        tip: rand() < 0.08 ? 0.25 : 0,
      }

      // Arch: map the full circle onto the upper arc and push fibres outward.
      const arc = -Math.PI - 0.45 + u * (Math.PI + 0.9) + (rand() - 0.5) * 0.08
      const R0 = 0.24 + Math.pow(rand(), 1.6) * 0.42
      const len = 0.06 + rand() * 0.11
      const centre: Vec = [0, 0.38]
      const b0: Vec = [centre[0] + Math.cos(arc) * R0 * 1.25, centre[1] + Math.sin(arc) * R0]
      const b1: Vec = [b0[0] + Math.cos(arc) * len * 1.2, b0[1] + Math.sin(arc) * len]
      const burst: Pose = { p0: b0, c: lerpV(b0, b1, 0.5), p1: b1, w: 1 + rand() * 0.6, a: 0.45 + rand() * 0.3, tip: rand() < 0.3 ? 0.25 : 0 }

      const seg = segs[i % segs.length]
      const so = (rand() - 0.5) * 0.004 * seg.w
      const retina: Pose = {
        p0: [seg.p0[0] + so, seg.p0[1] + so],
        c: [seg.c[0] + so, seg.c[1] - so],
        p1: [seg.p1[0] - so, seg.p1[1] + so],
        w: 0.6 + seg.w * 1.1,
        a: 0.12 + seg.w * 0.18,
        tip: i < segs.length && rand() < 0.25 ? 0.35 : 0,
      }

      const tone = Math.pow(rand(), 1.8)
      const white = rand() < 0.06
      const color: [number, number, number] = white
        ? [225, 238, 255]
        : [Math.round(lerp(41, 120, tone)), Math.round(lerp(110, 220, tone)), 255]

      this.fibres.push({ poses: [strand, iris, burst, retina], color, delay: rand(), phase: rand() * Math.PI * 2 })
    }

    this.spokes = Array.from({ length: 32 }, (_, k) => ({ angle: (k / 32) * Math.PI * 2, phase: rand() }))
    const pr = rng(7)
    this.particles = Array.from({ length: 90 }, () => ({
      x: pr() * 2 - 1,
      y: pr() * 2 - 1,
      r: 0.6 + pr() * 1.8,
      vx: (pr() - 0.5) * 0.004,
      vy: -0.002 - pr() * 0.006,
      phase: pr() * Math.PI * 2,
    }))
  }

  resize(width: number, height: number) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.75)
    this.w = width
    this.h = height
    this.canvas.width = Math.round(width * this.dpr)
    this.canvas.height = Math.round(height * this.dpr)
    this.bloom.width = Math.max(1, Math.round(width / 4))
    this.bloom.height = Math.max(1, Math.round(height / 4))
    if (!this.opts.animate) this.render(performance.now())
  }

  /** Scene value in [0, 3]. */
  setProgress(scene: number) {
    this.target = Math.max(0, Math.min(SCENES - 1, scene))
    if (!this.opts.animate) {
      this.scene = this.target
      this.render(performance.now())
    }
  }

  setPointer(x: number, y: number) {
    this.pointer = [x, y]
  }

  startLoop() {
    if (!this.opts.animate) {
      this.render(performance.now())
      return
    }
    const tick = (t: number) => {
      this.scene += (this.target - this.scene) * 0.085
      if (Math.abs(this.target - this.scene) < 0.0005) this.scene = this.target
      this.pointerSmoothed = lerpV(this.pointerSmoothed, this.pointer, 0.05)
      this.render(t)
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  destroy() {
    cancelAnimationFrame(this.raf)
  }

  private render(now: number) {
    const { ctx, w, h, dpr } = this
    if (!w || !h) return
    const time = this.opts.animate ? (now - this.start) / 1000 : 0
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.globalCompositeOperation = 'source-over'

    const k = Math.min(SCENES - 2, Math.floor(this.scene))
    const f = this.scene - k

    // Background: strands scene carries a deep blue atmosphere; others near-black.
    const atmos = k === 0 ? 1 - smooth(clamp01(f * 1.4)) : k === 2 ? smooth(clamp01((f - 0.4) / 0.6)) * 0.35 : 0
    ctx.fillStyle = '#03050A'
    ctx.fillRect(0, 0, w, h)
    if (atmos > 0.01) {
      const g = ctx.createRadialGradient(w * 0.62, h * 0.35, 0, w * 0.62, h * 0.35, Math.max(w, h) * 0.85)
      g.addColorStop(0, `rgba(22,44,110,${0.85 * atmos})`)
      g.addColorStop(0.5, `rgba(10,22,60,${0.6 * atmos})`)
      g.addColorStop(1, 'rgba(3,5,10,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }

    const s = Math.min(w, h) * (w < 700 ? 1.25 : 1.05)
    const ox = w * 0.5 + this.pointerSmoothed[0] * 14
    const oy = h * 0.5 + this.pointerSmoothed[1] * 10
    const X = (v: Vec): Vec => [ox + v[0] * s, oy + v[1] * s]

    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'

    const irisSpin = time * 0.03
    const tips: { x: number; y: number; r: number; a: number }[] = []

    for (const fb of this.fibres) {
      const local = smooth(clamp01((f - fb.delay * 0.35) / 0.65))
      const A = fb.poses[k]
      const B = fb.poses[k + 1]
      let p0 = lerpV(A.p0, B.p0, local)
      let c = lerpV(A.c, B.c, local)
      let p1 = lerpV(A.p1, B.p1, local)
      const width = lerp(A.w, B.w, local)
      let alpha = lerp(A.a, B.a, local)
      const tip = lerp(A.tip, B.tip, local)

      // Idle motion: strands sway, iris slowly turns, everything breathes.
      const irisWeight = k === 0 ? local : k === 1 ? 1 - local : 0
      if (irisWeight > 0 && time) {
        const rot = irisSpin * irisWeight
        const cs = Math.cos(rot), sn = Math.sin(rot)
        const R = (v: Vec): Vec => [v[0] * cs - v[1] * sn, v[0] * sn + v[1] * cs]
        p0 = R(p0); c = R(c); p1 = R(p1)
      }
      if (time) {
        const sway = Math.sin(time * 0.6 + fb.phase) * 0.012 * (k === 0 ? 1 - local : 0.25)
        c = [c[0] + sway, c[1]]
        p1 = [p1[0] + sway * 0.6, p1[1] + Math.cos(time * 0.5 + fb.phase) * 0.004]
        alpha *= 0.85 + Math.sin(time * 1.3 + fb.phase * 3) * 0.15
      }

      const P0 = X(p0), C = X(c), P1 = X(p1)
      ctx.strokeStyle = `rgba(${fb.color[0]},${fb.color[1]},${fb.color[2]},${alpha.toFixed(3)})`
      ctx.lineWidth = width
      ctx.beginPath()
      ctx.moveTo(P0[0], P0[1])
      ctx.quadraticCurveTo(C[0], C[1], P1[0], P1[1])
      ctx.stroke()
      if (tip > 0.02) tips.push({ x: P1[0], y: P1[1], r: tip, a: Math.min(1, alpha * 4) })
    }

    // Cable bodies in the strands scene: a soft wide pass gives them volume.
    const strandWeight = k === 0 ? 1 - smooth(clamp01(f * 1.6)) : 0
    if (strandWeight > 0.01) {
      ctx.lineWidth = Math.max(4, s * 0.012)
      for (let i = 0; i < this.fibres.length; i += 14) {
        const p = this.fibres[i].poses[0]
        const P0 = X(p.p0), C = X([p.c[0] + (time ? Math.sin(time * 0.6 + this.fibres[i].phase) * 0.012 : 0), p.c[1]]), P1 = X(p.p1)
        ctx.strokeStyle = `rgba(30,80,200,${0.1 * strandWeight})`
        ctx.beginPath()
        ctx.moveTo(P0[0], P0[1])
        ctx.quadraticCurveTo(C[0], C[1], P1[0], P1[1])
        ctx.stroke()
      }
    }

    // Glowing fibre tips.
    for (const t of tips) {
      const size = s * 0.05 * t.r
      ctx.globalAlpha = t.a
      ctx.drawImage(this.glow, t.x - size / 2, t.y - size / 2, size, size)
    }
    ctx.globalAlpha = 1

    this.drawRing(X, s, k, f, time)
    this.drawDisc(X, s, k, f)
    this.drawParticles(time)

    // Cheap bloom: downsample, then add back blurred by bilinear upscaling.
    const b = this.bloomCtx
    b.globalCompositeOperation = 'copy'
    b.drawImage(this.canvas, 0, 0, this.bloom.width, this.bloom.height)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.55
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(this.bloom, 0, 0, this.canvas.width, this.canvas.height)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'

    // Vignette keeps text readable at the edges.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75)
    v.addColorStop(0, 'rgba(3,5,10,0)')
    v.addColorStop(1, 'rgba(3,5,10,0.65)')
    ctx.fillStyle = v
    ctx.fillRect(0, 0, w, h)
  }

  private drawRing(X: (v: Vec) => Vec, s: number, k: number, f: number, time: number) {
    // Ring presence: grows in during 0→1, holds at 1, explodes during 1→2.
    let presence = 0
    let burst = 0
    if (k === 0) presence = smooth(clamp01((f - 0.45) / 0.55))
    else if (k === 1) {
      presence = 1 - smooth(clamp01((f - 0.15) / 0.85)) * 0.35
      burst = smooth(clamp01(f / 0.9))
    } else if (k === 2) {
      presence = 0.65 * (1 - smooth(clamp01(f / 0.6)))
      burst = 1
    }
    if (presence < 0.01) return
    const { ctx } = this
    const R = 0.3
    const centre = X([0, 0])
    const spin = time * 0.02

    // Outer circle fades as the ring breaks apart.
    const circleA = presence * (1 - burst)
    if (circleA > 0.01) {
      ctx.strokeStyle = `rgba(235,244,255,${0.9 * circleA})`
      ctx.lineWidth = 2.2
      ctx.beginPath()
      ctx.arc(centre[0], centre[1], R * s, 0, Math.PI * 2)
      ctx.stroke()
      ctx.strokeStyle = `rgba(120,190,255,${0.25 * circleA})`
      ctx.lineWidth = 9
      ctx.stroke()
    }

    for (const sp of this.spokes) {
      const a = sp.angle + spin + burst * (sp.phase - 0.5) * 0.6
      const outR = R + burst * (0.25 + sp.phase * 0.45)
      const inR = outR - (0.07 + sp.phase * 0.02) * (1 - burst * 0.5)
      const o: Vec = [Math.cos(a) * outR, Math.sin(a) * outR]
      const ii: Vec = [Math.cos(a) * inR, Math.sin(a) * inR]
      const O = X(o), I = X(ii)
      const perp: Vec = [-Math.sin(a), Math.cos(a)]
      const half = s * 0.0065 * (1 - burst * 0.4)
      const grad = ctx.createLinearGradient(O[0], O[1], I[0], I[1])
      grad.addColorStop(0, `rgba(245,248,255,${0.95 * presence})`)
      grad.addColorStop(1, `rgba(120,190,255,0)`)
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.moveTo(O[0] + perp[0] * half, O[1] + perp[1] * half)
      ctx.lineTo(O[0] - perp[0] * half, O[1] - perp[1] * half)
      ctx.lineTo(I[0], I[1])
      ctx.closePath()
      ctx.fill()
    }
  }

  private drawDisc(X: (v: Vec) => Vec, s: number, k: number, f: number) {
    const presence = k === 2 ? smooth(clamp01((f - 0.5) / 0.5)) : 0
    if (presence < 0.01) return
    const [x, y] = X(this.disc)
    const size = s * 0.16
    this.ctx.globalAlpha = presence * 0.9
    this.ctx.drawImage(this.glow, x - size / 2, y - size / 2, size, size)
    this.ctx.globalAlpha = presence * 0.35
    const big = s * 0.9
    const [cx0, cy0] = X([0.02, 0.02])
    this.ctx.beginPath()
    this.ctx.strokeStyle = `rgba(99,217,255,${0.18 * presence})`
    this.ctx.lineWidth = 1.2
    this.ctx.arc(cx0, cy0, big * 0.5, 0, Math.PI * 2)
    this.ctx.stroke()
    this.ctx.globalAlpha = 1
  }

  private drawParticles(time: number) {
    const { ctx, w, h } = this
    for (const p of this.particles) {
      let x = p.x + p.vx * time
      let y = p.y + p.vy * time
      x = ((((x + 1) % 2) + 2) % 2) - 1
      y = ((((y + 1) % 2) + 2) % 2) - 1
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(time * 0.8 + p.phase))
      const px = (x * 0.5 + 0.5) * w
      const py = (y * 0.5 + 0.5) * h
      const size = p.r * 7
      ctx.globalAlpha = 0.5 * tw
      ctx.drawImage(this.glow, px - size / 2, py - size / 2, size, size)
    }
    ctx.globalAlpha = 1
  }
}
