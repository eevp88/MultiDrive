import { describe, expect, it } from 'vitest'
import { randomToken } from './crypto.js'
import { isSealedShareToken, openShareToken, sealShareToken } from './share-token.js'

describe('share tokens', () => {
  it('seals a token so it can be shown again, and the sealed value is not the raw token', () => {
    const raw = randomToken()
    const sealed = sealShareToken(raw)
    expect(sealed).not.toContain(raw)
    expect(openShareToken(sealed)).toBe(raw)
  })

  it('tells sealed values from raw ones: raw base64url tokens never contain a colon', () => {
    for (let i = 0; i < 100; i += 1) expect(isSealedShareToken(randomToken())).toBe(false)
    expect(isSealedShareToken(sealShareToken('x'))).toBe(true)
  })

  it('returns rows written before encryption as they are', () => {
    const legacy = randomToken()
    expect(openShareToken(legacy)).toBe(legacy)
  })

  it('returns null when no token was stored', () => {
    expect(openShareToken(null)).toBeNull()
    expect(openShareToken('')).toBeNull()
  })

  it('returns null, not an exception, when the value cannot be decrypted (key changed)', () => {
    expect(openShareToken('AAAA:BBBB:CCCC')).toBeNull()
  })
})
