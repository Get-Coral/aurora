import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { localeMessages, supportedLocales } from './messages'
import type { Locale } from './types'

function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'en'

  const stored = window.localStorage.getItem('aurora-locale')
  if (stored && supportedLocales.includes(stored as Locale)) return stored as Locale

  const browserLocale = navigator.language.toLowerCase()
  const matched = supportedLocales.find((locale) => browserLocale.startsWith(locale))
  return matched ?? 'en'
}

interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string, params?: Record<string, string | number | undefined>) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en')

  useEffect(() => {
    setLocaleState(detectLocale())
  }, [])

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = locale
    if (typeof window !== 'undefined') window.localStorage.setItem('aurora-locale', locale)
  }, [locale])

  const value = useMemo<I18nContextValue>(() => {
    function t(key: string, params?: Record<string, string | number | undefined>) {
      const dictionary = localeMessages[locale] ?? localeMessages.en
      const entry = dictionary[key] ?? localeMessages.en[key] ?? key
      return typeof entry === 'function' ? entry(params) : entry
    }

    return { locale, setLocale: setLocaleState, t }
  }, [locale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside I18nProvider')
  return context
}

export { supportedLocales }
export type { Locale } from './types'
