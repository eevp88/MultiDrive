import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password.js'

describe('passwords', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true)
    expect(await verifyPassword(hash, 'correct horse battery stapl')).toBe(false)
  })

  it('never stores the password and salts every hash', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')])
    expect(a).not.toContain('same-password')
    expect(a).not.toBe(b)
    expect(a.startsWith('$argon2')).toBe(true)
  })
})
