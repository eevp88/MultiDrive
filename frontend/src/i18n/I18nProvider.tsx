import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError } from '@/lib/api'
import { en, type MessageKey, type Messages } from './en'
import { es } from './es'

export type Language = 'en' | 'es'

const STORAGE_KEY = '9drive.language'
const dictionaries: Record<Language, Messages> = { en, es }

type Variables = Record<string, string | number>
type I18nValue = {
  language: Language
  setLanguage: (language: Language) => void
  t: (key: MessageKey, variables?: Variables) => string
  translateError: (error: unknown, fallbackKey: MessageKey) => string
}

const I18nContext = createContext<I18nValue | null>(null)

function detectInitialLanguage(): Language {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'en' || stored === 'es') return stored
  return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(detectInitialLanguage)

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const setLanguage = useCallback((next: Language) => {
    localStorage.setItem(STORAGE_KEY, next)
    setLanguageState(next)
  }, [])

  const t = useCallback((key: MessageKey, variables?: Variables) => {
    const message = dictionaries[language][key] ?? en[key]
    if (!variables) return message
    return message.replace(/\{(\w+)\}/g, (match, name: string) => (name in variables ? String(variables[name]) : match))
  }, [language])

  const translateError = useCallback((error: unknown, fallbackKey: MessageKey) => {
    if (error instanceof ApiError && error.code) {
      const key = `error.${error.code}` as MessageKey
      if (key in en) return t(key)
    }
    return error instanceof Error && error.message ? error.message : t(fallbackKey)
  }, [t])

  const value = useMemo(() => ({ language, setLanguage, t, translateError }), [language, setLanguage, t, translateError])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside I18nProvider')
  return context
}
