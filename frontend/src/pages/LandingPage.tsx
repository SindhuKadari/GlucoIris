import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUpRight, Moon, Sun } from 'lucide-react'
import { FiberCanvas } from '../features/landing/FiberCanvas'
import { Reveal } from '../components/Reveal'
import { cx } from '../lib/util'
import { useTheme } from '../lib/theme'
import { useT } from '../lib/i18n'
import { LanguageToggle } from '../components/LanguageToggle'

const SECTIONS = [
  { id: 'screen', label: 'screen' },
  { id: 'evidence', label: 'evidence' },
  { id: 'workflow', label: 'workflow' },
  { id: 'access', label: 'access' },
]

const sectionCls = 'relative flex min-h-screen flex-col px-5 pb-12 pt-28 supports-[height:100svh]:min-h-[100svh] sm:px-8 md:px-12 md:pb-16'
const headline = 'font-display font-light uppercase leading-[0.98] tracking-[0.01em] text-ink text-[clamp(2.6rem,6.4vw,5.75rem)] [text-shadow:0_0_30px_rgba(41,121,255,0.35)]'
const mono = 'font-mono text-[10px] uppercase tracking-[0.2em] text-haze sm:text-[11px]'
const pill =
  'inline-flex items-center justify-center gap-2 rounded-full border border-ink/35 bg-void/30 px-7 py-3 font-mono text-[11px] uppercase tracking-[0.22em] text-ink backdrop-blur-md transition-colors duration-300 hover:border-cyan hover:bg-electric/15 hover:text-ink'

function SectionTag({ letter, index }: { letter: string; index: number }) {
  // Section counters are decorative and stay as-is in every language.
  return (
    <div className="flex items-center justify-between font-mono text-[11px] tracking-[0.2em] text-ink/80">
      <span>( {letter} )</span>
      <span className="text-haze">[ {String(index).padStart(3, '0')} / 004 ]</span>
    </div>
  )
}

function Em({ children }: { children: ReactNode }) {
  return <em className="font-display font-light normal-case italic">{children}</em>
}

export default function LandingPage() {
  const [active, setActive] = useState('screen')
  const [atEnd, setAtEnd] = useState(false)
  const heroTitle = useRef<HTMLHeadingElement>(null)
  const { theme, toggle: toggleTheme } = useTheme()
  const t = useT()

  // The GlucoIris hero heading fills with neon blue as the hero scrolls; reduced motion shows it fully lit.
  useEffect(() => {
    const el = heroTitle.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.style.setProperty('--hl', '1')
      return
    }
    let raf = 0
    const update = () => {
      raf = 0
      const p = Math.min(1, Math.max(0, 0.15 + window.scrollY / (window.innerHeight * 0.55)))
      el.style.setProperty('--hl', p.toFixed(3))
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setActive(e.target.id)),
      { threshold: 0.55 },
    )
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id)
      if (el) io.observe(el)
    })
    const onScroll = () => setAtEnd(window.innerHeight + window.scrollY > document.documentElement.scrollHeight - 40)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      io.disconnect()
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  return (
    <div className="landing relative bg-void text-ink">
      <FiberCanvas />

      {/* Fixed chrome: brand left, sections centred, login + theme toggle right */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-line bg-void/45 backdrop-blur-md">
        <Reveal className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-2.5 sm:px-8 md:grid md:grid-cols-[1fr_auto_1fr] md:px-12">
          <div className="order-1 flex items-baseline gap-3">
            <Link to="/" className="font-display text-xl font-medium tracking-wide text-ink sm:text-2xl" aria-label="GlucoIris home">
              (GLUCOIRIS)
            </Link>
            <span className="hidden font-mono text-[12px] tracking-[0.18em] text-haze/70 lg:inline">[ v.0.1 · prototype ]</span>
          </div>
          <div className="order-2 -mr-2 ml-auto flex items-center gap-2 md:order-3 md:mr-0 md:justify-self-end">
            <Link
              to="/login"
              className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-base font-medium lowercase tracking-wide text-cyan transition-colors duration-300 hover:text-ink"
            >
              {t('login / sign up')} <ArrowUpRight size={15} strokeWidth={1.75} />
            </Link>
            <LanguageToggle tone="landing" className="hidden sm:flex" />
            <button
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? t('Switch to light mode') : t('Switch to dark mode')}
              title={theme === 'dark' ? t('Light mode') : t('Dark mode')}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-ink/20 bg-void/40 text-ink transition-colors duration-300 hover:border-cyan hover:text-cyan"
            >
              {theme === 'dark' ? <Sun size={18} strokeWidth={1.75} /> : <Moon size={18} strokeWidth={1.75} />}
            </button>
          </div>
          <nav aria-label={t('Sections')} className="order-3 -mx-2 flex w-full items-center gap-1 overflow-x-auto md:order-2 md:mx-0 md:w-auto md:justify-center">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => go(s.id)}
                aria-current={active === s.id ? 'true' : undefined}
                className={cx(
                  'shrink-0 rounded-full px-3 py-2 text-base font-medium lowercase tracking-wide transition-colors duration-300 sm:px-4 sm:text-[17px]',
                  active === s.id ? 'bg-electric/15 text-ink' : 'text-haze hover:text-ink',
                )}
              >
                {t(s.label)}
              </button>
            ))}
          </nav>
        </Reveal>
      </header>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 hidden items-end md:flex justify-between px-5 pb-5 sm:px-8 md:px-12">
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-haze/70 sm:text-[10px]">{t('Research prototype · Not for clinical use')}</span>
        <ArrowDown size={16} strokeWidth={1.5} className={cx('absolute left-1/2 -translate-x-1/2 text-haze transition-opacity duration-500 motion-safe:animate-bounce', atEnd && 'opacity-0')} aria-hidden />
        <span />
      </div>

      <main className="relative z-10">
        {/* A — strands */}
        <section id="screen" className={sectionCls} aria-labelledby="h-screen">
          <div className="flex flex-1 flex-col justify-end gap-10 md:flex-row md:items-end md:justify-between">
            <div>
              <Reveal delay={120}>
                <div className="font-hero text-[clamp(1.5rem,3vw,2.5rem)] font-bold italic tracking-[0.2em] text-ink [text-shadow:0_0_26px_rgba(41,121,255,0.55)]">
                  {t('CLINICAL ACCESS')}
                </div>
              </Reveal>
              <Reveal delay={200}>
                <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.22em] text-cyan/90 sm:text-xs">{t('Retinal Screening with Visible Evidence')}</p>
              </Reveal>
              <h1 id="h-screen" ref={heroTitle} className="mt-8 font-display font-light italic uppercase leading-[0.98] tracking-[0.01em] text-[clamp(2.6rem,8.5vw,7rem)]">
                <Reveal as="span" delay={300} className="hero-hl block w-fit pr-[0.12em]">
                  GlucoIris
                </Reveal>
              </h1>
              <Reveal delay={500}>
                <p className="mt-5 font-display text-xl font-light tracking-wide text-ink/85 [text-shadow:0_1px_14px_rgba(3,5,10,0.95)] sm:text-2xl">
                  {t('Review the Evidence')}
                </p>
              </Reveal>
            </div>
            <Reveal delay={520} className="w-full max-w-sm md:mb-3">
              <SectionTag letter="A" index={1} />
              <p className="mt-6 text-sm leading-relaxed text-ink/80 [text-shadow:0_1px_14px_rgba(3,5,10,0.95)]">
                {t('GlucoIris brings patient history, fundus capture, image-quality checks and AI-assisted diabetic retinopathy grading into one workflow — so every result reaches a clinician with the evidence needed to review it.')}
              </p>
              <Link to="/login" className={cx(pill, 'mt-7 w-full')}>
                {t('Begin screening')}
              </Link>
            </Reveal>
          </div>
        </section>

        {/* B — iris */}
        <section id="evidence" className={sectionCls} aria-labelledby="h-evidence">
          <div className="flex flex-1 flex-col justify-center">
            <div className="flex items-center justify-between gap-8">
              <h2 id="h-evidence" className={headline}>
                <Reveal as="span" delay={120} className="block">
                  {t('See')} <Em>{t('what the')}</Em>
                </Reveal>
                <Reveal as="span" delay={240} className="block">{t('Model sees')}</Reveal>
              </h2>
              <Reveal delay={300} className="hidden w-full max-w-[17rem] md:block">
                <SectionTag letter="B" index={2} />
              </Reveal>
            </div>
          </div>
          <div className="mt-10 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <Reveal delay={360} className="max-w-xs">
              <p className="text-sm leading-relaxed text-ink/80 [text-shadow:0_1px_14px_rgba(3,5,10,0.95)]">
                {t('Original image, viewer-only enhancement, attribution maps and segmentation overlays stay visually separate — so agreement and disagreement between them remain visible to the reviewer.')}
              </p>
            </Reveal>
            <div className="md:hidden">
              <SectionTag letter="B" index={2} />
            </div>
          </div>
        </section>

        {/* C — burst */}
        <section id="workflow" className={sectionCls} aria-labelledby="h-workflow">
          <div className="flex flex-1 flex-col justify-end gap-12 lg:flex-row lg:items-end lg:justify-between">
            <h2 id="h-workflow" className={headline}>
              <Reveal as="span" delay={120} className="block">
                {t('From')} <Em>{t('capture')}</Em>
              </Reveal>
              <Reveal as="span" delay={230} className="block pl-[0.9em]">
                // {t('To report')}
              </Reveal>
            </h2>
            <Reveal delay={300} className="w-full max-w-md">
              <SectionTag letter="C" index={3} />
              <ol className="mt-5 rounded-2xl border border-cyan/15 bg-abyss/55 px-5 backdrop-blur-md">
                {[
                  ['Register', 'Patient, diabetes history and recorded consent.'],
                  ['Capture', 'One retinal fundus image per screening — upload, camera or sample.'],
                  ['Quality gate', 'Ungradeable images are blocked with specific recapture guidance.'],
                  ['Analyse', 'Per-module job status. Failures shown, never hidden.'],
                  ['Review', 'Model scores kept separate from the clinician’s signed interpretation.'],
                  ['Report', 'Versioned PDF with provenance, retrievable from history.'],
                ].map(([title, d], i) => (
                  <li key={title} className="flex gap-5 border-b border-cyan/10 py-3.5 last:border-0">
                    <span className="pt-0.5 font-mono text-[11px] tracking-[0.15em] text-cyan/70">{String(i + 1).padStart(2, '0')}</span>
                    <div>
                      <div className="text-sm font-medium text-ink">{t(title)}</div>
                      <div className="mt-0.5 text-[13px] leading-relaxed text-haze">{t(d)}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </Reveal>
          </div>
        </section>

        {/* D — retina */}
        <section id="access" className={sectionCls} aria-labelledby="h-access">
          <div className="flex flex-1 flex-col justify-end gap-12 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 id="h-access" className={headline}>
                <Reveal as="span" delay={120} className="block">
                  {t('Honest')} <Em>{t('by')}</Em>
                </Reveal>
                <Reveal as="span" delay={230} className="block pl-[0.9em]">
                  // {t('Design')}
                </Reveal>
              </h2>
            </div>
            <Reveal delay={300} className="w-full max-w-md">
              <SectionTag letter="D" index={4} />
              <div className="mt-5 rounded-2xl border border-cyan/15 bg-abyss/60 p-5 backdrop-blur-md">
                <p className="text-sm leading-relaxed text-ink/85">
                  {t('GlucoIris supports clinical review. It does not diagnose, prescribe or replace a comprehensive eye examination.')}
                </p>
                <div className={cx(mono, 'mt-5')}>{t('Classifier baseline · reported, not reproduced here')}</div>
                <dl className="mt-3 grid grid-cols-3 gap-3">
                  {[
                    ['Referable sens.', '87.4%'],
                    ['Referable spec.', '95.1%'],
                    ['QWK', '0.890'],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-line bg-void/40 px-3 py-2.5">
                      <dt className="text-[11px] text-haze">{t(k)}</dt>
                      <dd className="mt-1 font-display text-xl text-ink">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-4 text-[12px] leading-relaxed text-haze">
                  {t('Five-class ViT on APTOS 2019 (550 test images), from the project handover. Below the proposed >90% sensitivity target. Demo mode shows simulated results, clearly labelled.')}
                </p>
              </div>
            </Reveal>
          </div>
        </section>
      </main>
    </div>
  )
}
