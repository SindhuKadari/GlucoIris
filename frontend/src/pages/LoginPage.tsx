import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight, Lock } from 'lucide-react'
import { FiberCanvas } from '../features/landing/FiberCanvas'
import { Reveal } from '../components/Reveal'
import { useStore } from '../store/store'
import { DEMO_CLINICIAN, isRealAuthConfigured } from '../lib/session'
import { cx } from '../lib/util'
import { tr, useT } from '../lib/i18n'
import { LanguageToggle } from '../components/LanguageToggle'

const fieldCls =
  'w-full rounded-lg border border-ink/15 bg-void/50 px-3.5 py-3 text-sm text-ink placeholder:text-haze/50 backdrop-blur focus:border-neon focus:outline-none focus:ring-2 focus:ring-neon/25 aria-[invalid=true]:border-bad/70'

export default function LoginPage() {
  const signInDemo = useStore((s) => s.signInDemo)
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({})
  const t = useT()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next: typeof errors = {}
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = tr('Enter a valid work email address.')
    if (password.length < 8) next.password = tr('Password must be at least 8 characters.')
    if (!next.email && !next.password && !isRealAuthConfigured()) {
      next.form = tr('Clinician authentication needs the GlucoIris backend, which is not connected in this prototype. Use demo access below — it opens synthetic records only.')
    }
    setErrors(next)
  }

  const demo = () => {
    signInDemo(DEMO_CLINICIAN)
    navigate(from === '/login' ? '/dashboard' : from, { replace: true })
  }

  return (
    <div className="workspace relative min-h-screen bg-void text-ink">
      <FiberCanvas fixedScene={1} />
      <div className="relative z-10 flex min-h-screen flex-col px-5 py-6 sm:px-8 md:px-12">
        <header className="flex items-start justify-between">
          <Link to="/" className="font-display text-xl font-medium tracking-wide sm:text-2xl">(GLUCOIRIS)</Link>
          <div className="flex items-center gap-3">
            <LanguageToggle />
            <Link to="/" className="flex items-center gap-1.5 text-sm lowercase text-haze transition-colors hover:text-ink sm:text-base">
              <ArrowLeft size={15} /> {t('back')}
            </Link>
          </div>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center gap-10 py-10 lg:flex-row lg:justify-between">
          <Reveal className="hidden max-w-md lg:block">
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-haze">( {t('Clinician access')} )</div>
            <h1 className="mt-4 font-display text-5xl font-light uppercase leading-[1] [text-shadow:0_0_30px_rgba(36,92,235,0.35)]">
              {t('Review')} <em className="normal-case italic">{t('with')}</em>
              <br />
              // {t('Evidence')}
            </h1>
          </Reveal>

          <Reveal delay={150} className="w-full max-w-sm">
            <div className="rounded-2xl border border-ink/15 bg-abyss/55 p-6 shadow-[0_0_80px_rgba(36,92,235,0.12)] backdrop-blur-xl sm:p-7">
              <div className="flex items-center justify-between font-mono text-[11px] tracking-[0.2em] text-ink/80">
                <span>( {t('SIGN IN')} )</span>
                <Lock size={13} className="text-haze" />
              </div>
              <form onSubmit={submit} noValidate className="mt-6 space-y-4">
                <div>
                  <label htmlFor="email" className="mb-1.5 block text-xs text-haze">{t('Work email')}</label>
                  <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-err' : undefined} className={fieldCls} placeholder="name@clinic.org" />
                  {errors.email && <p id="email-err" className="mt-1 text-xs text-bad">{errors.email}</p>}
                </div>
                <div>
                  <label htmlFor="password" className="mb-1.5 block text-xs text-haze">{t('Password')}</label>
                  <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} aria-describedby={errors.password ? 'pw-err' : undefined} className={fieldCls} />
                  {errors.password && <p id="pw-err" className="mt-1 text-xs text-bad">{errors.password}</p>}
                </div>
                {errors.form && (
                  <p role="alert" className="rounded-lg border border-warn/35 bg-warn/[0.08] px-3 py-2.5 text-xs leading-relaxed text-ink/90">
                    {errors.form}
                  </p>
                )}
                <button type="submit" className="w-full rounded-full bg-ink py-3 text-sm font-medium text-void transition-colors duration-300 hover:bg-ink/85">
                  {t('Sign in')}
                </button>
              </form>

              <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-haze/70">
                <span className="h-px flex-1 bg-ink/10" /> {t('or')} <span className="h-px flex-1 bg-ink/10" />
              </div>

              <button
                onClick={demo}
                className={cx(
                  'group flex w-full items-center justify-center gap-2 rounded-full border border-cyan/40 bg-electric/15 py-3 font-mono text-[11px] uppercase tracking-[0.2em] text-ink transition-colors duration-300 hover:border-cyan hover:bg-electric/30',
                )}
              >
                {t('Continue with demo access')} <ArrowUpRight size={13} className="transition-transform group-hover:translate-x-0.5" />
              </button>
              <p className="mt-3 text-center text-[11px] leading-relaxed text-haze">
                {t('Demo access uses synthetic patients and simulated results stored only in this browser. Not for clinical use.')}
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </div>
  )
}
