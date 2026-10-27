import { describe, expect, it } from 'vitest'
import { clearAuthSession, getAccessToken, getRefreshToken, getStoredUser, setAccessToken, setAuthSession, updateStoredUser } from '@/lib/auth'

const user = { id: 'u1', name: 'Ada', email: 'ada@example.test', role: 'user' }

describe('auth session storage', () => {
  it('is empty before sign in', () => {
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
    expect(getStoredUser()).toBeNull()
  })

  it('stores and reads the whole session', () => {
    setAuthSession('a', 'r', user)
    expect(getAccessToken()).toBe('a')
    expect(getRefreshToken()).toBe('r')
    expect(getStoredUser()).toEqual(user)
  })

  it('replaces only the access token on refresh', () => {
    setAuthSession('a', 'r', user)
    setAccessToken('a2')
    expect(getAccessToken()).toBe('a2')
    expect(getRefreshToken()).toBe('r')
  })

  it('updates the stored user without touching the tokens', () => {
    setAuthSession('a', 'r', user)
    updateStoredUser({ ...user, name: 'Grace' })
    expect(getStoredUser()?.name).toBe('Grace')
    expect(getAccessToken()).toBe('a')
  })

  it('clears everything on sign out', () => {
    setAuthSession('a', 'r', user)
    clearAuthSession()
    expect([getAccessToken(), getRefreshToken(), getStoredUser()]).toEqual([null, null, null])
  })
})
