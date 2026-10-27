import { describe, expect, it } from 'vitest'
import { decryptText, encryptText, hashToken, randomToken } from './crypto.js'

describe('encryptText / decryptText', () => {
  it('round-trips text, including non-ASCII', () => {
    for (const value of ['hello', 'ñandú 日本語 🚀', 'a'.repeat(10_000)]) {
      expect(decryptText(encryptText(value))).toBe(value)
    }
  })

  // Known limitation, pinned so a change is noticed: the data part of an empty value is empty and decryptText treats it as
  // malformed. No caller encrypts an empty value (they store tokens, client ids and secrets).
  it('does not round-trip an empty string', () => {
    expect(() => decryptText(encryptText(''))).toThrow('Invalid encrypted payload')
  })

  it('uses a fresh IV, so equal inputs never produce equal ciphertexts', () => {
    expect(encryptText('same')).not.toBe(encryptText('same'))
  })

  it('stores iv:tag:data and does not contain the plaintext', () => {
    const sealed = encryptText('super-secret-refresh-token')
    expect(sealed.split(':')).toHaveLength(3)
    expect(sealed).not.toContain('super-secret-refresh-token')
  })

  it('rejects a tampered payload (GCM authentication)', () => {
    const [iv, tag, data] = encryptText('refresh-token').split(':')
    const flipped = Buffer.from(data, 'base64')
    flipped[0] ^= 0xff
    expect(() => decryptText(`${iv}:${tag}:${flipped.toString('base64')}`)).toThrow()
  })

  it('rejects a payload with the wrong shape', () => {
    expect(() => decryptText('only-one-part')).toThrow('Invalid encrypted payload')
    expect(() => decryptText('a:b')).toThrow('Invalid encrypted payload')
  })
})

describe('randomToken / hashToken', () => {
  it('produces url-safe, unique tokens', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => randomToken()))
    expect(tokens.size).toBe(50)
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('honours the requested size', () => {
    expect(Buffer.from(randomToken(16), 'base64url')).toHaveLength(16)
    expect(Buffer.from(randomToken(), 'base64url')).toHaveLength(32)
  })

  it('hashes deterministically to a 64-character hex digest', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'))
    expect(hashToken('abc')).not.toBe(hashToken('abd'))
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
