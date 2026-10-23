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

  // A file the user trashed in the app is still in OneDrive and stays in the trash until it is restored there. Only a file this
  // sync itself marked as deleted (deletedBySync) because it had disappeared comes back when it reappears.
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
    const reappeared = existing.status !== 'active' && existing.deletedBySync
    const changed = reappeared || existing.name !== item.name || existing.mimeType !== mimeType || existing.sizeBytes !== sizeBytes || (existing.takenAt?.getTime() ?? null) !== (takenAt?.getTime() ?? null)
    if (changed) {
      await prisma.file.update({ where: { id: existing.id }, data: { name: item.name, mimeType, sizeBytes, takenAt, ...(reappeared ? { status: 'active', deletedAt: null, deletedBySync: false } : {}) } })
      updated += 1
    }
  }

  const missing = existingFiles.filter((file) => file.status === 'active' && !remoteIds.has(file.providerFileId)).map((file) => file.id)
  if (missing.length > 0) {
    deleted = (await prisma.file.updateMany({ where: { id: { in: missing }, userId }, data: { status: 'deleted', deletedAt: new Date(), deletedBySync: true } })).count
  }

  await syncMicrosoftQuota(account.id).catch(() => undefined)
  return { accountId: account.id, created, updated, deleted }
}

// OneDrive rejects these characters and a few reserved names, so file names are cleaned before they are sent.
export function sanitizeMicrosoftName(name: string) {
  const cleaned = name.replace(/["*:<>?/\\|]/g, '_').replace(/^\s+/, '').replace(/[. ]+$/, '').slice(0, 255)
  if (!cleaned) return 'file'
  return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i.test(cleaned) ? `_${cleaned}` : cleaned
}

export type MicrosoftUploadedItem = { id: string; name: string; size?: number; file?: { mimeType?: string } }

const simpleUploadLimit = 4 * 1024 * 1024
// Graph requires every chunk but the last to be a multiple of 320 KiB; 10 MiB is 32 of them.
const uploadChunkSize = 10 * 1024 * 1024
const chunkTimeoutMs = 120_000

// Same name in the same folder: Graph renames the new file instead of replacing the old one.
const conflictRename = '@microsoft.graph.conflictBehavior'

export async function createMicrosoftUploadSession(accessToken: string, parentId: string, fileName: string) {
  const session = await graphJson<{ uploadUrl?: string }>(accessToken, `/me/drive/items/${parentId}:/${encodeURIComponent(fileName)}:/createUploadSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: { [conflictRename]: 'rename', name: fileName } }),
  })
  if (!session.uploadUrl) throw new HttpError(502, 'MICROSOFT_API_ERROR', 'OneDrive did not return an upload session.')
  return session.uploadUrl
}

// The upload URL is pre-authenticated: it must be called without the Authorization header and never logged.
export async function queryMicrosoftUploadOffset(uploadUrl: string) {
  const response = await fetch(uploadUrl, { signal: AbortSignal.timeout(requestTimeoutMs) })
  if (!response.ok) return null
  const data = await response.json().catch(() => ({})) as { nextExpectedRanges?: string[] }
  const start = data.nextExpectedRanges?.[0]?.split('-')[0]
  return start && /^\d+$/.test(start) ? BigInt(start) : 0n
}

export async function cancelMicrosoftUploadSession(uploadUrl: string) {
  await fetch(uploadUrl, { method: 'DELETE', signal: AbortSignal.timeout(requestTimeoutMs) }).catch(() => undefined)
}

export async function uploadMicrosoftBuffer(accessToken: string, parentId: string, fileName: string, buffer: Buffer): Promise<MicrosoftUploadedItem> {
  const name = sanitizeMicrosoftName(fileName)
  if (buffer.length <= simpleUploadLimit) {
    const response = await graphFetch(accessToken, `/me/drive/items/${parentId}:/${encodeURIComponent(name)}:/content?${conflictRename}=rename`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Blob([new Uint8Array(buffer)]),
    })
    return response.json() as Promise<MicrosoftUploadedItem>
  }

  const uploadUrl = await createMicrosoftUploadSession(accessToken, parentId, name)
  try {
    for (let start = 0; start < buffer.length; start += uploadChunkSize) {
      const end = Math.min(start + uploadChunkSize, buffer.length)
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Length': String(end - start), 'Content-Range': `bytes ${start}-${end - 1}/${buffer.length}` },
        body: new Blob([new Uint8Array(buffer.subarray(start, end))]),
        signal: AbortSignal.timeout(chunkTimeoutMs),
      })
      if (response.status === 200 || response.status === 201) return await response.json() as MicrosoftUploadedItem
      if (response.status !== 202) throw new GraphError(response.status, 'uploadFailed')
    }
    throw new GraphError(502, 'uploadIncomplete')
  } catch (error) {
    await cancelMicrosoftUploadSession(uploadUrl)
    throw error
  }
}

// Graph answers with a redirect to a pre-authenticated download URL. fetch drops the Authorization header on that
// cross-origin hop and keeps Range, which is what is wanted. No timeout: the body can legitimately take a long time.
export async function fetchMicrosoftFileContent(account: ConnectedAccount, itemId: string, range?: string, signal?: AbortSignal) {
  const accessToken = await getMicrosoftAccessToken(account)
  return fetch(`${graphBase}/me/drive/items/${encodeURIComponent(itemId)}/content`, {
    headers: { Authorization: `Bearer ${accessToken}`, ...(range ? { Range: range } : {}) },
    signal,
  })
}

export async function deleteMicrosoftItem(account: ConnectedAccount, itemId: string) {
  const accessToken = await getMicrosoftAccessToken(account)
  await graphFetch(accessToken, `/me/drive/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' }).catch((error) => {
    // Already gone: the goal of the delete is met.
    if (!(error instanceof GraphError && error.status === 404)) throw error
  })
}

export async function renameMicrosoftItem(account: ConnectedAccount, itemId: string, name: string) {
  const accessToken = await getMicrosoftAccessToken(account)
  const item = await graphJson<{ name: string }>(accessToken, `/me/drive/items/${encodeURIComponent(itemId)}?$select=name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: sanitizeMicrosoftName(name) }),
  }).catch((error) => {
    if (error instanceof GraphError && error.status === 409) throw new HttpError(409, 'FILE_NAME_CONFLICT', 'A file with that name already exists in OneDrive.')
    throw error
  })
  return item.name
}

// Thumbnail of an item, scaled to fit inside a size x size box. Graph redirects to a pre-authenticated URL that only this
// server follows. Returns null when the item has no thumbnail (not an image, still being processed, or gone).
export async function fetchMicrosoftThumbnail(account: ConnectedAccount, itemId: string, size: number) {
  const accessToken = await getMicrosoftAccessToken(account)
  const base = `/me/drive/items/${encodeURIComponent(itemId)}/thumbnails/0`
  for (const variant of [`c${size}x${size}`, 'large']) {
    try {
      return await graphFetch(accessToken, `${base}/${variant}/content`, { signal: AbortSignal.timeout(15_000) })
    } catch (error) {
      if (!(error instanceof GraphError) || ![400, 404].includes(error.status)) throw error
    }
  }
  return null
}
