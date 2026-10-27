import { describe, expect, it, vi } from 'vitest'
import { migrateLegacyStorageKeys } from '@/lib/legacy-storage'

describe('migrateLegacyStorageKeys', () => {
  it('moves 9drive keys, with either separator, to the multidrive prefix', () => {
    localStorage.setItem('9drive.accessToken', 'token')
    localStorage.setItem('9drive:view', 'grid')

    migrateLegacyStorageKeys()

    expect(localStorage.getItem('multidrive.accessToken')).toBe('token')
    expect(localStorage.getItem('multidrive:view')).toBe('grid')
    expect(localStorage.getItem('9drive.accessToken')).toBeNull()
    expect(localStorage.getItem('9drive:view')).toBeNull()
  })

  it('never overwrites a value already stored under the new key', () => {
    localStorage.setItem('9drive.language', 'es')
    localStorage.setItem('multidrive.language', 'en')

    migrateLegacyStorageKeys()

    expect(localStorage.getItem('multidrive.language')).toBe('en')
    expect(localStorage.getItem('9drive.language')).toBeNull()
  })

  it('leaves unrelated keys alone, including ones that merely contain 9drive', () => {
    localStorage.setItem('other.key', '1')
    localStorage.setItem('my9drive.key', '2')

    migrateLegacyStorageKeys()

    expect(localStorage.getItem('other.key')).toBe('1')
    expect(localStorage.getItem('my9drive.key')).toBe('2')
  })

  it('does not throw when storage is blocked', () => {
    vi.stubGlobal('localStorage', new Proxy({}, { ownKeys: () => { throw new Error('blocked') } }))
    try {
      expect(() => migrateLegacyStorageKeys()).not.toThrow()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
