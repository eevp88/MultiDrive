import { Languages } from 'lucide-react'
import { useI18n, type Language } from '@/i18n/I18nProvider'
import { cn } from '@/lib/utils'

const options: Array<{ value: Language; label: string }> = [
  { value: 'en', label: 'EN' },
  { value: 'es', label: 'ES' },
]

export function LanguageSwitcher({ className }: { className?: string }) {
  const { language, setLanguage, t } = useI18n()
  return (
    <div className={cn('inline-flex items-center gap-1 rounded-xl border border-slate-200 p-1 text-xs font-bold', className)} role="group" aria-label={t('language.label')}>
      <Languages className="ml-1 h-4 w-4 text-slate-400" aria-hidden="true" />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={language === option.value}
          onClick={() => setLanguage(option.value)}
          className={cn('rounded-lg px-2 py-1 transition', language === option.value ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100')}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
