import { useCallback } from 'react'
import { create } from 'zustand'
import { HI } from './i18n/hi'
import { TE } from './i18n/te'

/**
 * Three-language UI (English, Telugu, Hindi). The English text itself is the lookup key:
 * `t('Review queue')`. Any string without a translation falls back to English, so a missing
 * entry never breaks the UI. `{name}` placeholders are filled from `vars`.
 */
export type Lang = 'en' | 'te' | 'hi'

export const LANGS: { code: Lang; label: string; short: string; locale: string }[] = [
  { code: 'en', label: 'English', short: 'EN', locale: 'en-GB' },
  { code: 'te', label: 'తెలుగు', short: 'తె', locale: 'te-IN' },
  { code: 'hi', label: 'हिन्दी', short: 'हि', locale: 'hi-IN' },
]

const DICT: Record<Exclude<Lang, 'en'>, Record<string, string>> = { te: TE, hi: HI }
const KEY = 'glucoiris-lang'

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'en' || saved === 'te' || saved === 'hi') return saved
  } catch {
    /* storage unavailable: English */
  }
  return 'en'
}

export const useLang = create<{ lang: Lang; setLang: (l: Lang) => void }>((set) => ({
  lang: initialLang(),
  setLang: (lang) => {
    try {
      localStorage.setItem(KEY, lang)
    } catch {
      /* ignore */
    }
    document.documentElement.lang = lang
    set({ lang })
  },
}))

if (typeof document !== 'undefined') document.documentElement.lang = useLang.getState().lang

export type Vars = Record<string, string | number>

export function translate(lang: Lang, text: string, vars?: Vars): string {
  const s = lang === 'en' ? text : (DICT[lang][text] ?? text)
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s
}

/** Current language outside React (PDF generation, date formatting, report model). */
export const getLang = (): Lang => useLang.getState().lang
export const tr = (text: string, vars?: Vars) => translate(getLang(), text, vars)
export const localeOf = (lang: Lang = getLang()) => LANGS.find((l) => l.code === lang)!.locale

/** React hook: re-renders the component when the language changes. */
export function useT() {
  const lang = useLang((s) => s.lang)
  return useCallback((text: string, vars?: Vars) => translate(lang, text, vars), [lang])
}
