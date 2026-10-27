import jwt from 'jsonwebtoken'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signAccessToken, verifyAccessToken } from './jwt.js'

describe('access tokens', () => {
  afterEach(() => vi.useRealTimers())

  it('round-trips the user and session ids', () => {
    const payload = verifyAccessToken(signAccessToken({ sub: 'user-1', sid: 'session-1' }))
    expect(payload.sub).toBe('user-1')
    expect(payload.sid).toBe('session-1')
  })

  it('rejects a token signed with another secret', () => {
    const forged = jwt.sign({ sub: 'user-1', sid: 'session-1' }, 'another-secret-another-secret-another')
    expect(() => verifyAccessToken(forged)).toThrow()
  })

  it('rejects a tampered payload', () => {
    const [header, , signature] = signAccessToken({ sub: 'user-1', sid: 's' }).split('.')
    const evil = Buffer.from(JSON.stringify({ sub: 'admin', sid: 's' })).toString('base64url')
    expect(() => verifyAccessToken(`${header}.${evil}.${signature}`)).toThrow()
  })

  it('rejects an unsigned token (alg none)', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const body = Buffer.from(JSON.stringify({ sub: 'admin', sid: 's' })).toString('base64url')
    expect(() => verifyAccessToken(`${header}.${body}.`)).toThrow()
  })

  it('expires after ACCESS_TOKEN_TTL_SECONDS', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const token = signAccessToken({ sub: 'u', sid: 's' })
    vi.setSystemTime(new Date('2026-01-01T00:14:59Z'))
    expect(() => verifyAccessToken(token)).not.toThrow()
    vi.setSystemTime(new Date('2026-01-01T00:15:01Z'))
    expect(() => verifyAccessToken(token)).toThrow()
  })

  it('rejects garbage', () => {
    expect(() => verifyAccessToken('not-a-token')).toThrow()
    expect(() => verifyAccessToken('')).toThrow()
  })
})
