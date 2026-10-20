import { Router } from 'express'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { encryptText, hashToken, randomToken } from '../../utils/crypto.js'
import { HttpError, describeError } from '../../utils/http-error.js'
import { exchangeMicrosoftCode, graphFetch, microsoftAuthUrl, syncMicrosoftQuota } from './microsoft.service.js'

export const microsoftConnectRouter = Router()

async function createMicrosoftConnectUrl(req: AuthRequest) {
  const config = await prisma.providerConfig.findFirst({ where: { userId: null, provider: 'onedrive', status: 'active' }, orderBy: { createdAt: 'desc' } })
  if (!config) throw new HttpError(409, 'MICROSOFT_NOT_CONFIGURED', 'OneDrive is not configured on this server.')
  const state = randomToken()
  await prisma.oauthState.create({ data: { userId: req.user!.id, providerConfigId: config.id, flow: 'connect', stateHash: hashToken(state), expiresAt: new Date(Date.now() + 10 * 60_000) } })
  return microsoftAuthUrl(config, state)
}

microsoftConnectRouter.get('/connect-url', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    return res.json({ url: await createMicrosoftConnectUrl(req) })
  } catch (error) {
    return next(error)
  }
})

microsoftConnectRouter.get('/connect', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    return res.redirect(await createMicrosoftConnectUrl(req))
  } catch (error) {
    return next(error)
  }
})

// The browser lands here after Microsoft's consent screen, so every outcome is a redirect to the frontend.
microsoftConnectRouter.get('/callback', async (req, res) => {
  const done = (status: 'success' | 'error') => res.redirect(`${env.FRONTEND_URL}/google-connected?status=${status}&provider=onedrive`)
  try {
    const query = z.object({ code: z.string(), state: z.string() }).parse(req.query)
    const oauthState = await prisma.oauthState.findUnique({ where: { stateHash: hashToken(query.state) }, include: { providerConfig: true } })
    if (!oauthState || oauthState.usedAt || oauthState.expiresAt < new Date() || oauthState.flow !== 'connect' || !oauthState.userId || oauthState.providerConfig.provider !== 'onedrive') return done('error')

    const tokens = await exchangeMicrosoftCode(oauthState.providerConfig, query.code)
    const profile = await (await graphFetch(tokens.access_token!, '/me?$select=id,displayName,mail,userPrincipalName')).json() as { id?: string; displayName?: string; mail?: string | null; userPrincipalName?: string }
    const email = profile.mail ?? profile.userPrincipalName
    if (!profile.id || !email) return done('error')

    const where = { userId_provider_providerAccountId: { userId: oauthState.userId, provider: 'onedrive', providerAccountId: profile.id } }
    const existing = await prisma.connectedAccount.findUnique({ where })
    const refreshTokenEncrypted = tokens.refresh_token ? encryptText(tokens.refresh_token) : existing?.refreshTokenEncrypted
    if (!refreshTokenEncrypted) return done('error')

    const data = {
      providerConfigId: oauthState.providerConfigId,
      email,
      displayName: profile.displayName,
      accessTokenEncrypted: encryptText(tokens.access_token!),
      refreshTokenEncrypted,
      tokenExpiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
      scopes: oauthState.providerConfig.scopes as string[],
      status: 'connected',
    }
    const account = await prisma.connectedAccount.upsert({ where, create: { userId: oauthState.userId, provider: 'onedrive', providerAccountId: profile.id, ...data }, update: data })
    await prisma.oauthState.update({ where: { id: oauthState.id }, data: { usedAt: new Date() } })
    // The account is connected either way; the quota is refreshed again on the next listing.
    await syncMicrosoftQuota(account.id).catch(() => undefined)
    return done('success')
  } catch (error) {
    console.error('OneDrive OAuth callback failed:', describeError(error))
    return done('error')
  }
})
