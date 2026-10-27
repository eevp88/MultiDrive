import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { en } from './en'
import { es } from './es'
import { I18nProvider, useI18n } from './I18nProvider'

const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('I18nProvider language detection', () => {
  it('uses the stored language first', () => {
    localStorage.setItem('multidrive.language', 'es')
    expect(renderHook(() => useI18n(), { wrapper }).result.current.language).toBe('es')
  })

  it('ignores a stored value that is not a supported language', () => {
    localStorage.setItem('multidrive.language', 'fr')
    vi.stubGlobal('navigator', { language: 'en-US' })
    expect(renderHook(() => useI18n(), { wrapper }).result.current.language).toBe('en')
  })

  it.each([['es-CL', 'es'], ['ES', 'es'], ['de-DE', 'en']])('falls back to the browser language %s -> %s', (browser, expected) => {
    vi.stubGlobal('navigator', { language: browser })
    expect(renderHook(() => useI18n(), { wrapper }).result.current.language).toBe(expected)
  })

  it('persists a language change and sets the document language', () => {
    localStorage.setItem('multidrive.language', 'en')
    const { result } = renderHook(() => useI18n(), { wrapper })

    act(() => result.current.setLanguage('es'))

    expect(localStorage.getItem('multidrive.language')).toBe('es')
    expect(document.documentElement.lang).toBe('es')
    expect(result.current.t('common.password')).toBe(es['common.password'])
  })

  it('throws a clear error when used outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => renderHook(() => useI18n())).toThrow('useI18n must be used inside I18nProvider')
  })
})

describe('t and tDynamic', () => {
  function english() {
    localStorage.setItem('multidrive.language', 'en')
    return renderHook(() => useI18n(), { wrapper }).result
  }

  it('fills {variables} and leaves unknown placeholders visible', () => {
    const result = english()
    expect(result.current.t('upload.progressCount', { done: 2, total: 5 })).toBe(en['upload.progressCount'].replace('{done}', '2').replace('{total}', '5'))
    expect(result.current.t('upload.progressCount', { done: 2 })).toContain('{total}')
  })

  it('returns the message untouched when no variables are given', () => {
    expect(english().current.t('common.email')).toBe(en['common.email'])
  })

  it('tDynamic translates a known key and falls back for an unknown one', () => {
    const result = english()
    expect(result.current.tDynamic('common.email')).toBe(en['common.email'])
    expect(result.current.tDynamic('no.such.key', 'Fallback')).toBe('Fallback')
    expect(result.current.tDynamic('no.such.key')).toBe('no.such.key')
  })
})

describe('translateError', () => {
  function english() {
    localStorage.setItem('multidrive.language', 'en')
    return renderHook(() => useI18n(), { wrapper }).result
  }

  it('prefers the translation of the server error code', () => {
    expect(english().current.translateError(new ApiError('raw server text', 'FOLDER_NOT_ON_ACCOUNT'), 'common.email')).toBe(en['error.FOLDER_NOT_ON_ACCOUNT'])
  })

  it('uses the error message when the code has no translation', () => {
    expect(english().current.translateError(new ApiError('raw server text', 'SOMETHING_NEW'), 'common.email')).toBe('raw server text')
  })

  it('uses the fallback key for something that is not an error with a message', () => {
    const result = english()
    expect(result.current.translateError('oops', 'common.email')).toBe(en['common.email'])
    expect(result.current.translateError(new Error(''), 'common.email')).toBe(en['common.email'])
  })
})
