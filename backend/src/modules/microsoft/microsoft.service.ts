import type { ConnectedAccount, ProviderConfig } from '@prisma/client'
import { prisma } from '../../config/prisma.js'
import { decryptText, encryptText } from '../../utils/crypto.js'
import { HttpError } from '../../utils/http-error.js'

export const microsoftAuthBase = 'https://login.microsoftonline.com/consumers/oauth2/v2.0'
export const graphBase = 'https://graph.microsoft.com/v1.0'
export const microsoftScopes = ['Files.ReadWrite', 'offline_access', 'User.Read']
const appFolderName = 'MultiDrive'
const requestTimeoutMs = 30_000

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string }

export class GraphError extends Error {
  constructor(public status: number, public code: string) {
    super(`Graph request failed (${status} ${code})`)
    this.name = 'GraphError'
  }
}

export function microsoftAuthUrl(config: ProviderConfig, state: string) {
  const params = new URLSearchParams({
    client_id: decryptText(config.clientIdEncrypted),
    response_type: 'code',
    redirect_uri: config.redirectUri,
    response_mode: 'query',
    scope: microsoftScopes.join(' '),
    state,
    prompt: 'select_account',
  })
  return `${microsoftAuthBase}/authorize?${params}`
}

async function requestToken(config: ProviderConfig, params: Record<string, string>): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: decryptText(config.clientIdEncrypted),
    client_secret: decryptText(config.clientSecretEncrypted),
    scope: microsoftScopes.join(' '),
    ...params,
  })
  const response = await fetch(`${microsoftAuthBase}/token`, { method: 'POST', body, signal: AbortSignal.timeout(requestTimeoutMs) })
  const data = await response.json().catch(() => ({})) as TokenResponse
  if (!response.ok || !data.access_token) {
    // invalid_grant means the refresh token was revoked or expired: the user has to connect again.
    if (data.error === 'invalid_grant') throw new HttpError(409, 'ACCOUNT_RECONNECT_REQUIRED', 'Microsoft account tokens are no longer valid.')
    throw new HttpError(502, 'MICROSOFT_API_ERROR', 'Microsoft rejected the sign-in request.')
  }
  return data
}

export function exchangeMicrosoftCode(config: ProviderConfig, code: string) {
  return requestToken(config, { grant_type: 'authorization_code', code, redirect_uri: config.redirectUri })
}

// Returns a valid access token, refreshing it first when it is about to expire.
// Microsoft rotates the refresh token on every refresh, so the new one must be stored.
export async function getMicrosoftAccessToken(account: ConnectedAccount) {
  if (!account.accessTokenEncrypted || !account.refreshTokenEncrypted || !account.tokenExpiresAt) throw new HttpError(409, 'ACCOUNT_RECONNECT_REQUIRED', 'Microsoft account tokens are missing.')
  if (!account.providerConfigId) throw new HttpError(409, 'ACCOUNT_RECONNECT_REQUIRED', 'Microsoft provider config is missing.')
  if (account.tokenExpiresAt.getTime() >= Date.now() + 60_000) return decryptText(account.accessTokenEncrypted)

  const config = await prisma.providerConfig.findUniqueOrThrow({ where: { id: account.providerConfigId } })
  const tokens = await requestToken(config, { grant_type: 'refresh_token', refresh_token: decryptText(account.refreshTokenEncrypted) })
  await prisma.connectedAccount.update({
    where: { id: account.id },
    data: {
      accessTokenEncrypted: encryptText(tokens.access_token!),
      refreshTokenEncrypted: tokens.refresh_token ? encryptText(tokens.refresh_token) : account.refreshTokenEncrypted,
      tokenExpiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
    },
  })
  return tokens.access_token!
}

export async function graphFetch(accessToken: string, path: string, init: RequestInit = {}) {
  const url = path.startsWith('https://') ? path : `${graphBase}${path}`
  const response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${accessToken}` }, signal: init.signal ?? AbortSignal.timeout(requestTimeoutMs) })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: { code?: string } }
    throw new GraphError(response.status, body.error?.code ?? 'unknown')
  }
  return response
}

async function graphJson<T>(accessToken: string, path: string, init?: RequestInit) {
  return (await graphFetch(accessToken, path, init)).json() as Promise<T>
}

export async function syncMicrosoftQuota(accountId: string) {
  const account = await prisma.connectedAccount.findUniqueOrThrow({ where: { id: accountId } })
  const accessToken = await getMicrosoftAccessToken(account)
  const drive = await graphJson<{ quota?: { total?: number; used?: number; deleted?: number } }>(accessToken, '/me/drive?$select=quota')
  const total = drive.quota?.total ? BigInt(drive.quota.total) : null
  const used = BigInt(drive.quota?.used ?? 0)
  const data = {
    totalBytes: total,
    usedBytes: used,
    availableBytes: total === null ? null : total - used,
    trashBytes: drive.quota?.deleted ? BigInt(drive.quota.deleted) : null,
    lastSyncedAt: new Date(),
  }
  return prisma.storageAccount.upsert({ where: { connectedAccountId: accountId }, create: { connectedAccountId: accountId, ...data }, update: data })
}

export async function ensureMicrosoftAppFolder(accessToken: string) {
  const path = `/me/drive/root:/${appFolderName}?$select=id,folder`
  const existing = await graphJson<{ id: string }>(accessToken, path).catch((error) => {
    if (error instanceof GraphError && error.status === 404) return null
    throw error
  })
  if (existing) return existing.id
  const created = await graphJson<{ id: string }>(accessToken, '/me/drive/root/children', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: appFolderName, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
  }).catch(async (error) => {
    // Another request created it first.
    if (error instanceof GraphError && error.status === 409) return graphJson<{ id: string }>(accessToken, path)
    throw error
  })
  return created.id
}

type GraphItem = { id: string; name: string; size?: number; file?: { mimeType?: string }; photo?: { takenDateTime?: string } }

// Capture time as reported by Graph (ISO 8601). Anything impossible is treated as unknown.
export function parseGraphTime(value: string | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1900 || date.getTime() > Date.now() + 86_400_000) return null
  return date
}

export type MicrosoftSyncResult = { accountId: string; created: number; updated: number; deleted: number }

// Mirrors the files that sit directly in the `MultiDrive` folder. Virtual folders live only in the database,
// so a file's folder is never changed here.
export async function syncMicrosoftAppFolderFiles(accountId: string, userId: string): Promise<MicrosoftSyncResult> {
  const account = await prisma.connectedAccount.findFirstOrThrow({ where: { id: accountId, userId, provider: 'onedrive', status: 'connected' } })
  const accessToken = await getMicrosoftAccessToken(account)
  const folderId = await ensureMicrosoftAppFolder(accessToken)

  const items: GraphItem[] = []
  let next: string | undefined = `/me/drive/items/${folderId}/children?$select=id,name,size,file,photo&$top=200`
  while (next) {
    const page: { value: GraphItem[]; '@odata.nextLink'?: string } = await graphJson(accessToken, next)
    items.push(...page.value.filter((item) => item.file))
    next = page['@odata.nextLink']
  }

  const existingFiles = await prisma.file.findMany({ where: { userId, connectedAccountId: account.id, provider: 'onedrive' } })
  const existingByProviderId = new Map(existingFiles.map((file) => [file.providerFileId, file]))
  const remoteIds = new Set(items.map((item) => item.id))
  let created = 0
  let updated = 0
  let deleted = 0

  for (const item of items) {
    const mimeType = item.file?.mimeType ?? 'application/octet-stream'
    const sizeBytes = BigInt(item.size ?? 0)
    const takenAt = parseGraphTime(item.photo?.takenDateTime)
    const existing = existingByProviderId.get(item.id)
    if (!existing) {
      await prisma.file.create({ data: { userId, connectedAccountId: account.id, provider: 'onedrive', providerFileId: item.id, name: item.name, mimeType, sizeBytes, takenAt, status: 'active' } })
      created += 1
      continue
    }
    const changed = existing.name !== item.name || existing.mimeType !== mimeType || existing.sizeBytes !== sizeBytes || existing.status !== 'active' || existing.deletedAt !== null || (existing.takenAt?.getTime() ?? null) !== (takenAt?.getTime() ?? null)
    if (changed) {
      await prisma.file.update({ where: { id: existing.id }, data: { name: item.name, mimeType, sizeBytes, takenAt, status: 'active', deletedAt: null } })
      updated += 1
    }
  }

  const missing = existingFiles.filter((file) => file.status === 'active' && !remoteIds.has(file.providerFileId)).map((file) => file.id)
  if (missing.length > 0) {
    deleted = (await prisma.file.updateMany({ where: { id: { in: missing }, userId }, data: { status: 'deleted', deletedAt: new Date() } })).count
  }

  await syncMicrosoftQuota(account.id).catch(() => undefined)
  return { accountId: account.id, created, updated, deleted }
}
