import { Languages } from 'lucide-react'
import { LANGS, useLang, useT } from '../lib/i18n'
import { cx } from '../lib/util'

/** Three-way language switch (English / తెలుగు / हिन्दी). The choice is remembered per browser. */
export function LanguageToggle({ className, tone = 'workspace' }: { className?: string; tone?: 'workspace' | 'landing' }) {
  const lang = useLang((s) => s.lang)
  const setLang = useLang((s) => s.setLang)
  const t = useT()
  return (
    <div role="group" aria-label={t('Language')} className={cx('flex items-center gap-0.5 rounded-full border p-0.5 backdrop-blur-md', tone === 'landing' ? 'border-ink/20 bg-void/40' : 'border-line-strong bg-panel-2', className)}>
      <Languages size={17} className="mx-1.5 text-haze" aria-hidden />
      {LANGS.map((l) => (
        <button
          key={l.code}
          onClick={() => setLang(l.code)}
          aria-pressed={lang === l.code}
          title={l.label}
          lang={l.code}
          className={cx(
            'min-w-[38px] rounded-full px-3 py-1.5 text-[15px] font-semibold transition-colors',
            lang === l.code ? 'bg-electric text-white' : 'text-haze hover:text-ink',
          )}
        >
          {l.short}
        </button>
      ))}
    </div>
  )
}
