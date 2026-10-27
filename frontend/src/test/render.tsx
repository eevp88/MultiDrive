import type { ReactElement, ReactNode } from 'react'
import { render } from '@testing-library/react'
import { I18nProvider } from '@/i18n/I18nProvider'

// English is forced so assertions read the same on every machine, whatever the browser language is.
export function renderWithI18n(ui: ReactElement) {
  localStorage.setItem('multidrive.language', 'en')
  return render(ui, { wrapper: ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider> })
}
