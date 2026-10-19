import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ClipboardCheck, LayoutGrid, LogOut, Menu, Moon, PlusCircle, RotateCcw, ScrollText, Sun, X } from 'lucide-react'
import { useStore } from '../store/store'
import { buildSeed } from '../demo/seed'
import { cx } from '../lib/util'
import { useTheme } from '../lib/theme'
import { Button, Dialog } from './ui'
import { FiberCanvas } from '../features/landing/FiberCanvas'
import { LanguageToggle } from './LanguageToggle'
import { useT } from '../lib/i18n'

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutGrid },
  { to: '/screenings/new', label: 'New screening', icon: PlusCircle },
  { to: '/dashboard?view=queue', label: 'Review queue', icon: ClipboardCheck },
  { to: '/audit', label: 'Audit trail', icon: ScrollText },
]

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.9" />
      <circle cx="32" cy="32" r="16" fill="none" stroke="#245CEB" strokeWidth="9" strokeDasharray="1.6 1.5" />
      <circle cx="32" cy="32" r="7" fill="#03050A" stroke="#B9D4FF" strokeWidth="1.6" />
    </svg>
  )
}

export function DemoBanner() {
  const mode = useStore((s) => s.session?.mode ?? 'demo')
  const t = useT()
  if (mode !== 'demo') return null
  return (
    <div className="flex items-center justify-center gap-2 border-b border-cyan/20 bg-cyan/[0.06] px-4 py-1.5 text-center font-mono text-[13px] uppercase tracking-[0.14em] text-cyan">
      <span className="h-1.5 w-1.5 rounded-full bg-cyan" aria-hidden />
      {t('Demonstration mode · synthetic patients · simulated results · not for clinical use')}
    </div>
  )
}

export default function AppShell() {
  const session = useStore((s) => s.session)
  const seeded = useStore((s) => s.seeded)
  const signOut = useStore((s) => s.signOut)
  const replaceAll = useStore((s) => s.replaceAll)
  const resetDemo = useStore((s) => s.resetDemo)
  const touchSession = useStore((s) => s.touchSession)
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [seedError, setSeedError] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const { theme, toggle: toggleTheme } = useTheme()
  const t = useT()
  const mainRef = useRef<HTMLElement>(null)
  // Screening steps carry a fixed bottom action bar; the steps themselves fit the viewport.
  const hasStepBar = location.pathname.startsWith('/screenings/')
  const fitViewport = hasStepBar && !location.pathname.endsWith('/new')

  const expired = session ? new Date(session.expiresAt).getTime() < Date.now() : false

  useEffect(() => {
    if (!session) navigate('/login', { replace: true, state: { from: location.pathname } })
  }, [session, navigate, location.pathname])

  useEffect(() => {
    if (session && !expired) touchSession()
    setMenuOpen(false)
    mainRef.current?.scrollTo(0, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  useEffect(() => {
    if (!session || seeded || seeding) return
    setSeeding(true)
    buildSeed()
      .then((data) => replaceAll(data))
      .catch((e) => setSeedError((e as Error).message))
      .finally(() => setSeeding(false))
  }, [session, seeded, seeding, replaceAll])

  if (!session) return null

  if (expired) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-abyss p-6">
        <div className="max-w-sm rounded-2xl border border-line bg-panel p-6 text-center">
          <h1 className="text-lg font-semibold">{t('Session expired')}</h1>
          <p className="mt-2 text-sm text-haze">{t('For safety, sessions end after 8 hours of inactivity. Sign in again to continue — saved drafts are kept.')}</p>
          <Button variant="primary" className="mt-5 w-full" onClick={() => { signOut(); navigate('/login') }}>
            {t('Sign in again')}
          </Button>
        </div>
      </div>
    )
  }

  const nav = (vertical: boolean) => (
    <nav className={cx('flex gap-1', vertical ? 'flex-col' : 'items-center')} aria-label={t('Workspace')}>
      {NAV.map(({ to, label, icon: Icon }) => {
        const [path, query] = to.split('?')
        const active = location.pathname === path && (query ? location.search.includes(query) : !location.search.includes('view=queue'))
        return (
          <NavLink
            key={to}
            to={to}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-[17px] font-medium transition-colors duration-300',
              active ? 'bg-electric/15 font-semibold text-ink ring-1 ring-electric/30' : 'text-haze hover:bg-panel-2 hover:text-ink',
            )}
          >
            <Icon size={20} strokeWidth={2} className={active ? 'text-electric' : ''} />
            {t(label)}
          </NavLink>
        )
      })}
    </nav>
  )

  const themeToggle = (
    <Button
      size="sm"
      variant="secondary"
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? t('Switch to light mode') : t('Switch to dark mode')}
      title={theme === 'dark' ? t('Light mode') : t('Dark mode')}
      className="h-10 w-10 rounded-full px-0"
    >
      {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
    </Button>
  )

  const footer = (
    <div className="space-y-3 border-t border-line pt-4">
      <div className="px-1">
        <div className="text-sm font-medium text-ink">{session.clinician.displayName}</div>
        <div className="text-xs text-haze">{session.clinician.organisation}</div>
      </div>
      <div className="flex gap-2">
        <Button size="md" variant="ghost" onClick={() => setConfirmReset(true)} title={t('Reset demo data')}>
          <RotateCcw size={16} /> {t('Reset demo')}
        </Button>
        <Button size="md" variant="ghost" onClick={() => { signOut(); navigate('/') }}>
          <LogOut size={16} /> {t('Sign out')}
        </Button>
      </div>
      <LanguageToggle className="w-fit" />
    </div>
  )

  return (
    <div className="workspace isolate relative flex h-dvh flex-col bg-abyss text-ink">
      <FiberCanvas fixedScene={0} fibres={700} className="-z-20" />
      <div className="fiber-veil pointer-events-none fixed inset-0 -z-10" aria-hidden />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-lg focus:bg-electric focus:px-4 focus:py-2 focus:text-white"
      >
        {t('Skip to main content')}
      </a>
      <div className="shrink-0">
        <DemoBanner />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
          <header className="z-30 shrink-0 border-b border-line bg-void/45 backdrop-blur-xl">
            <div className="mx-auto grid max-w-[1400px] grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 py-2.5 sm:px-6 lg:px-8">
              <NavLink to="/" className="flex items-center gap-2.5 justify-self-start">
                <BrandMark className="h-8 w-8 text-ink" />
                <div>
                  <div className="font-display text-[24px] sm:text-[28px] font-semibold leading-none tracking-[-0.02em]">GlucoIris</div>
                  <div className="hidden font-mono text-[12px] uppercase tracking-[0.18em] text-haze sm:block whitespace-nowrap">{t('Screening workspace')}</div>
                </div>
              </NavLink>
              <div className="hidden xl:block">{nav(false)}</div>
              <div className="flex items-center gap-3 justify-self-end">
                <div className="hidden items-center gap-1 xl:flex">
                  <Button size="md" variant="ghost" onClick={() => setConfirmReset(true)} title={t('Reset demo data')} aria-label={t('Reset demo data')}>
                    <RotateCcw size={18} /> <span className="hidden 2xl:inline">{t('Reset demo')}</span>
                  </Button>
                  <Button size="md" variant="ghost" onClick={() => { signOut(); navigate('/') }} title={t('Signed in as {name}', { name: session.clinician.displayName })} aria-label={t('Sign out')}>
                    <LogOut size={18} /> <span className="hidden 2xl:inline">{t('Sign out')}</span>
                  </Button>
                </div>
                <span className="hidden h-6 w-px bg-line-strong xl:block" aria-hidden />
                <LanguageToggle className="hidden sm:flex" />
                {themeToggle}
                <div className="xl:hidden">
                  <Button size="sm" variant="ghost" onClick={() => setMenuOpen(true)} aria-label={t('Open menu')}>
                    <Menu size={20} />
                  </Button>
                </div>
              </div>
            </div>
          </header>
          {menuOpen && (
            <div className="fixed inset-0 z-50 bg-void/80 backdrop-blur-sm xl:hidden" onClick={() => setMenuOpen(false)}>
              <div className="glass ml-auto flex h-full w-72 flex-col rounded-none p-4" onClick={(e) => e.stopPropagation()}>
                <div className="mb-4 flex justify-end">
                  <Button size="sm" variant="ghost" onClick={() => setMenuOpen(false)} aria-label={t('Close menu')}>
                    <X size={18} />
                  </Button>
                </div>
                {nav(true)}
                <div className="mt-auto">{footer}</div>
              </div>
            </div>
          )}
          <main ref={mainRef} id="main-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto focus:outline-none">
            <div className={cx('mx-auto w-full max-w-[1400px] px-4 pt-4 sm:px-6 lg:px-8 lg:pt-5', fitViewport ? 'h-full pb-[88px]' : hasStepBar ? 'pb-[96px]' : 'pb-8')}>
            {seeding || !seeded ? (
              <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-sm text-haze">
                {seedError ? (
                  <>
                    <div className="text-bad">{t('Demo data could not be prepared: {error}', { error: seedError })}</div>
                    <Button onClick={() => { setSeedError(null); replaceAll({ seeded: false }) }}>{t('Retry')}</Button>
                  </>
                ) : (
                  <>
                    <div className="h-1 w-48 overflow-hidden rounded-full skeleton" />
                    {t('Preparing synthetic demo records and running quality checks…')}
                  </>
                )}
              </div>
            ) : (
              <Outlet />
            )}
            </div>
          </main>
      </div>

      <Dialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title={t('Reset demo data?')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>{t('Cancel')}</Button>
            <Button variant="danger" onClick={() => { resetDemo(); setConfirmReset(false); navigate('/dashboard') }}>
              {t('Reset')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-haze">
          {t('This clears every synthetic patient, screening and report stored in this browser and restores the original demo set. Images you uploaded will no longer be linked.')}
        </p>
      </Dialog>
    </div>
  )
}
