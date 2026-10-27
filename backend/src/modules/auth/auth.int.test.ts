import { describe, expect, it } from 'vitest'
import { prisma } from '../../config/prisma.js'
import { hashToken, randomToken } from '../../utils/crypto.js'
import { api, createUser } from '../../test/helpers.js'

describe('POST /auth/register', () => {
  it('creates the user with a hashed password and returns a working session', async () => {
    const res = await api().post('/auth/register').send({ name: 'Ada', email: 'ada@example.test', password: 'long enough pw' })

    expect(res.status).toBe(201)
    expect(res.body.user).toMatchObject({ name: 'Ada', email: 'ada@example.test' })
    const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'ada@example.test' } })
    expect(stored.passwordHash).not.toContain('long enough pw')
    expect(await prisma.userSession.count({ where: { userId: stored.id } })).toBe(1)

    const me = await api().get('/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`)
    expect(me.status).toBe(200)
    expect(me.body.user.email).toBe('ada@example.test')
  })

  it('answers 409 AUTH_EMAIL_TAKEN for a registered email and creates nothing', async () => {
    await createUser({ email: 'taken@example.test' })

    const res = await api().post('/auth/register').send({ name: 'Other', email: 'taken@example.test', password: 'long enough pw' })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('AUTH_EMAIL_TAKEN')
    expect(await prisma.user.count()).toBe(1)
  })

  it('rejects a short password and a bad email with 400 and creates nothing', async () => {
    const shortPassword = await api().post('/auth/register').send({ name: 'Ada', email: 'ada@example.test', password: 'short' })
    const badEmail = await api().post('/auth/register').send({ name: 'Ada', email: 'not-an-email', password: 'long enough pw' })

    expect(shortPassword.status).toBe(400)
    expect(badEmail.status).toBe(400)
    expect(await prisma.user.count()).toBe(0)
  })
})

describe('POST /auth/login', () => {
  it('returns tokens for the right credentials', async () => {
    await createUser({ email: 'login@example.test', password: 'the right password' })

    const res = await api().post('/auth/login').send({ email: 'login@example.test', password: 'the right password' })

    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe('login@example.test')
    expect(res.body.accessToken).toEqual(expect.any(String))
    expect(res.body.refreshToken).toEqual(expect.any(String))
  })

  it('answers the same 401 for a wrong password and an unknown email, and opens no session', async () => {
    await createUser({ email: 'login@example.test', password: 'the right password' })
    const sessionsBefore = await prisma.userSession.count()

    const wrongPassword = await api().post('/auth/login').send({ email: 'login@example.test', password: 'wrong' })
    const unknownEmail = await api().post('/auth/login').send({ email: 'nobody@example.test', password: 'whatever' })

    expect(wrongPassword.status).toBe(401)
    expect(unknownEmail.status).toBe(401)
    expect(wrongPassword.body).toEqual(unknownEmail.body)
    expect(wrongPassword.body.code).toBe('AUTH_INVALID_CREDENTIALS')
    expect(await prisma.userSession.count()).toBe(sessionsBefore)
  })
})

describe('authenticated access', () => {
  it('requires a bearer token', async () => {
    const res = await api().get('/auth/me')
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('AUTH_REQUIRED')
  })

  it('rejects a malformed token', async () => {
    const res = await api().get('/auth/me').set('Authorization', 'Bearer not-a-jwt')
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('AUTH_INVALID_TOKEN')
  })

  it('rejects a valid token whose session was revoked', async () => {
    const { auth, session } = await createUser()
    await prisma.userSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } })

    const res = await api().get('/auth/me').set(auth)

    expect(res.status).toBe(401)
    expect(res.body.code).toBe('AUTH_SESSION_EXPIRED')
  })

  it('does not expose the password hash on /auth/me', async () => {
    const { auth } = await createUser()
    const res = await api().get('/auth/me').set(auth)
    expect(res.status).toBe(200)
    expect(res.body.user).not.toHaveProperty('passwordHash')
  })
})

describe('POST /auth/refresh and /auth/logout', () => {
  it('issues a new access token for a live refresh token', async () => {
    const login = await (async () => {
      await createUser({ email: 'r@example.test', password: 'the right password' })
      return api().post('/auth/login').send({ email: 'r@example.test', password: 'the right password' })
    })()

    const res = await api().post('/auth/refresh').send({ refreshToken: login.body.refreshToken })

    expect(res.status).toBe(200)
    const me = await api().get('/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`)
    expect(me.status).toBe(200)
  })

  it('refuses an unknown refresh token with 401 AUTH_SESSION_EXPIRED', async () => {
    const res = await api().post('/auth/refresh').send({ refreshToken: 'unknown' })
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('AUTH_SESSION_EXPIRED')
  })

  it('logout revokes the session: the access and refresh tokens stop working', async () => {
    await createUser({ email: 'out@example.test', password: 'the right password' })
    const login = await api().post('/auth/login').send({ email: 'out@example.test', password: 'the right password' })
    const bearer = { Authorization: `Bearer ${login.body.accessToken}` }

    const logout = await api().post('/auth/logout').set(bearer)

    expect(logout.status).toBe(200)
    expect((await api().get('/auth/me').set(bearer)).status).toBe(401)
    expect((await api().post('/auth/refresh').send({ refreshToken: login.body.refreshToken })).status).toBe(401)
  })
})

describe('POST /auth/google/exchange', () => {
  async function handoffFor(userId: string, overrides: { expiresAt?: Date } = {}) {
    const token = randomToken()
    await prisma.authHandoff.create({ data: { userId, tokenHash: hashToken(token), expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000) } })
    return token
  }

  it('trades a handoff token for a session exactly once', async () => {
    const { user } = await createUser()
    const token = await handoffFor(user.id)

    const first = await api().post('/auth/google/exchange').send({ token })
    const second = await api().post('/auth/google/exchange').send({ token })

    expect(first.status).toBe(200)
    expect(first.body.user.id).toBe(user.id)
    expect(second.status).toBe(401)
    expect(second.body.code).toBe('AUTH_GOOGLE_HANDOFF_INVALID')
  })

  it('refuses an expired handoff token', async () => {
    const { user } = await createUser()
    const token = await handoffFor(user.id, { expiresAt: new Date(Date.now() - 1000) })

    const res = await api().post('/auth/google/exchange').send({ token })

    expect(res.status).toBe(401)
    expect(res.body.code).toBe('AUTH_GOOGLE_HANDOFF_INVALID')
  })
})
