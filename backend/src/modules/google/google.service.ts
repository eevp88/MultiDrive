import { google } from 'googleapis'
import type { ConnectedAccount, ProviderConfig } from '@prisma/client'
import { prisma } from '../../config/prisma.js'
import { decryptText, encryptText } from '../../utils/crypto.js'
import { HttpError } from '../../utils/http-error.js'
import { parseExifTime } from '../../utils/exif-time.js'

const googleDriveFolderMimeType = 'application/vnd.google-apps.folder'
const appFolderName = 'MultiDrive'
// The app used to be called 9Drive and kept its files in a Drive folder with that name.
const legacyAppFolderName = '9drive'

export function createOAuthClient(config: ProviderConfig) {
  return new google.auth.OAuth2(decryptText(config.clientIdEncrypted), decryptText(config.clientSecretEncrypted), config.redirectUri)
}

export async function getAuthedGoogleClient(account: ConnectedAccount) {
  if (!account.accessTokenEncrypted || !account.refreshTokenEncrypted || !account.tokenExpiresAt) throw new HttpError(409, 'ACCOUNT_RECONNECT_REQUIRED', 'Google account tokens are missing.')
  if (!account.providerConfigId) throw new HttpError(409, 'ACCOUNT_RECONNECT_REQUIRED', 'Google provider config is missing.')
  const config = await prisma.providerConfig.findUniqueOrThrow({ where: { id: account.providerConfigId } })
  const client = createOAuthClient(config)
  client.setCredentials({
    access_token: decryptText(account.accessTokenEncrypted),
    refresh_token: decryptText(account.refreshTokenEncrypted),
    expiry_date: account.tokenExpiresAt.getTime(),
  })

  if (account.tokenExpiresAt.getTime() < Date.now() + 60_000) {
    const result = await client.refreshAccessToken()
    const credentials = result.credentials
    if (credentials.access_token) {
      await prisma.connectedAccount.update({
        where: { id: account.id },
        data: {
          accessTokenEncrypted: encryptText(credentials.access_token),
          tokenExpiresAt: new Date(credentials.expiry_date ?? Date.now() + 3600_000),
        },
      })
      client.setCredentials(credentials)
    }
  }

  return client
}

export async function syncGoogleQuota(accountId: string) {
  const account = await prisma.connectedAccount.findUniqueOrThrow({ where: { id: accountId } })
  const auth = await getAuthedGoogleClient(account)
  const drive = google.drive({ version: 'v3', auth })
  const about = await drive.about.get({ fields: 'storageQuota,user' })
  const quota = about.data.storageQuota
  const total = quota?.limit ? BigInt(quota.limit) : null
  const used = quota?.usage ? BigInt(quota.usage) : 0n
  return prisma.storageAccount.upsert({
    where: { connectedAccountId: accountId },
    create: {
      connectedAccountId: accountId,
      totalBytes: total,
      usedBytes: used,
      availableBytes: total === null ? null : total - used,
      trashBytes: quota?.usageInDriveTrash ? BigInt(quota.usageInDriveTrash) : null,
      lastSyncedAt: new Date(),
    },
    update: {
      totalBytes: total,
      usedBytes: used,
      availableBytes: total === null ? null : total - used,
      trashBytes: quota?.usageInDriveTrash ? BigInt(quota.usageInDriveTrash) : null,
      lastSyncedAt: new Date(),
    },
  })
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export async function ensureGoogleAppFolder(account: ConnectedAccount) {
  const auth = await getAuthedGoogleClient(account)
  const drive = google.drive({ version: 'v3', auth })
  const findFolder = async (name: string) => (await drive.files.list({
    q: `name = '${escapeDriveQueryValue(name)}' and mimeType = '${googleDriveFolderMimeType}' and 'root' in parents and trashed = false`,
    spaces: 'drive',
    fields: 'files(id,name)',
    pageSize: 1,
  })).data.files?.[0]?.id

  let folderId = await findFolder(appFolderName)
  if (!folderId) {
    // Rename the old folder in place: the id stays the same, so its files keep their parent and the sync loses nothing.
    const legacyId = await findFolder(legacyAppFolderName)
    if (legacyId) {
      await drive.files.update({ fileId: legacyId, requestBody: { name: appFolderName }, fields: 'id' })
      folderId = legacyId
    }
  }
  folderId ??= (await drive.files.create({
    requestBody: { name: appFolderName, mimeType: googleDriveFolderMimeType, parents: ['root'] },
    fields: 'id',
  })).data.id

  if (!folderId) throw new Error('Failed to create Google Drive app folder.')
  return folderId
}

// Moves a Drive file under another parent (the root `MultiDrive` folder or one of its subfolders).
export async function moveGoogleFile(account: ConnectedAccount, providerFileId: string, parentId: string) {
  const drive = google.drive({ version: 'v3', auth: await getAuthedGoogleClient(account) })
  const current = await drive.files.get({ fileId: providerFileId, fields: 'parents' })
  const previous = current.data.parents ?? []
  const toRemove = previous.filter((id) => id !== parentId)
  if (previous.includes(parentId) && toRemove.length === 0) return
  await drive.files.update({ fileId: providerFileId, addParents: parentId, ...(toRemove.length > 0 ? { removeParents: toRemove.join(',') } : {}), fields: 'id' })
}

export type GoogleAppFolderSyncResult = {
  accountId: string
  created: number
  updated: number
  deleted: number
}

type DriveFileMetadata = {
  id: string
  name: string
  mimeType: string
  sizeBytes: bigint
  parentId: string
  takenAt: Date | null
}

const defaultFolderIconUrl = 'https://api.iconify.design/lucide:folder.svg'
const driveParentsPerQuery = 40

type DriveFolderNode = { id: string; name: string; parentId: string }

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

// Breadth-first walk of the Drive folders under rootId, so every parent is listed before its children.
async function listDriveFolderTree(drive: ReturnType<typeof google.drive>, rootId: string) {
  const nodes: DriveFolderNode[] = []
  const seen = new Set<string>([rootId])
  let level = [rootId]
  while (level.length > 0) {
    const next: string[] = []
    for (const parentIds of chunk(level, driveParentsPerQuery)) {
      const parentsQuery = parentIds.map((id) => `'${id}' in parents`).join(' or ')
      const q = `(${parentsQuery}) and mimeType = '${googleDriveFolderMimeType}' and trashed = false`
      let pageToken: string | undefined
      do {
        const response = await drive.files.list({ q, spaces: 'drive', fields: 'nextPageToken,files(id,name,parents)', pageSize: 1000, pageToken })
        for (const folder of response.data.files ?? []) {
          if (!folder.id || !folder.name || seen.has(folder.id)) continue
          seen.add(folder.id)
          nodes.push({ id: folder.id, name: folder.name, parentId: folder.parents?.find((id) => parentIds.includes(id)) ?? parentIds[0] })
          next.push(folder.id)
        }
        pageToken = response.data.nextPageToken ?? undefined
      } while (pageToken)
    }
    level = next
  }
  return nodes
}

export async function syncGoogleAppFolderFiles(accountId: string, userId: string): Promise<GoogleAppFolderSyncResult> {
  const account = await prisma.connectedAccount.findFirstOrThrow({ where: { id: accountId, userId, provider: 'google_drive', status: 'connected' } })
  const auth = await getAuthedGoogleClient(account)
  const drive = google.drive({ version: 'v3', auth })
  const appFolderId = await ensureGoogleAppFolder(account)

  const driveFolders = await listDriveFolderTree(drive, appFolderId)
  const knownFolders = await prisma.folder.findMany({ where: { userId, connectedAccountId: account.id, providerFolderId: { not: null } } })
  const knownByProviderId = new Map(knownFolders.map((folder) => [folder.providerFolderId, folder]))
  const folderIdMap = new Map<string, string>()

  // Parents come before their children, so a folder's parent is already in folderIdMap.
  for (const node of driveFolders) {
    const parentDbId = node.parentId === appFolderId ? null : (folderIdMap.get(node.parentId) ?? null)
    const known = knownByProviderId.get(node.id)
    if (!known) {
      const created = await prisma.folder.create({
        data: { userId, connectedAccountId: account.id, provider: 'google_drive', providerFolderId: node.id, name: node.name, parentId: parentDbId, iconUrl: defaultFolderIconUrl },
      })
      folderIdMap.set(node.id, created.id)
      continue
    }
    folderIdMap.set(node.id, known.id)
    if (known.name !== node.name || known.parentId !== parentDbId || known.deletedAt !== null) {
      await prisma.folder.update({ where: { id: known.id }, data: { name: node.name, parentId: parentDbId, deletedAt: null } })
    }
  }

  // Folders mirrored from Drive that no longer exist there; app-only folders (no providerFolderId) are left alone.
  const driveFolderIds = driveFolders.map((node) => node.id)
  await prisma.folder.updateMany({
    where: { userId, connectedAccountId: account.id, deletedAt: null, AND: [{ providerFolderId: { not: null } }, { providerFolderId: { notIn: driveFolderIds } }] },
    data: { deletedAt: new Date() },
  })

  const driveFiles: DriveFileMetadata[] = []
  for (const parentIds of chunk([appFolderId, ...driveFolderIds], driveParentsPerQuery)) {
    const parentsQuery = parentIds.map((id) => `'${id}' in parents`).join(' or ')
    const q = `(${parentsQuery}) and mimeType != '${googleDriveFolderMimeType}' and trashed = false`
    let pageToken: string | undefined
    do {
      const response = await drive.files.list({
        q,
        spaces: 'drive',
        fields: 'nextPageToken,files(id,name,mimeType,size,parents,imageMediaMetadata(time))',
        pageSize: 1000,
        pageToken,
      })
      for (const file of response.data.files ?? []) {
        if (!file.id || !file.name || !file.mimeType) continue
        const parentId = file.parents?.[0] ?? appFolderId
        driveFiles.push({ id: file.id, name: file.name, mimeType: file.mimeType, sizeBytes: BigInt(file.size ?? 0), parentId, takenAt: parseExifTime(file.imageMediaMetadata?.time) })
      }
      pageToken = response.data.nextPageToken ?? undefined
    } while (pageToken)
  }

  const existingFiles = await prisma.file.findMany({ where: { userId, connectedAccountId: account.id, provider: 'google_drive' } })
  const existingByProviderId = new Map(existingFiles.map((file) => [file.providerFileId, file]))
  const driveFileIds = new Set(driveFiles.map((file) => file.id))
  let created = 0
  let updated = 0
  let deleted = 0

  // A file the user trashed in the app is still in Drive and stays in the trash until it is restored there. Only a file this
  // sync itself marked as deleted (deletedBySync) because it had disappeared comes back when it reappears.
  for (const driveFile of driveFiles) {
    const dbFolderId = driveFile.parentId === appFolderId ? null : (folderIdMap.get(driveFile.parentId) ?? null)
    const existing = existingByProviderId.get(driveFile.id)
    if (!existing) {
      await prisma.file.create({
        data: { userId, connectedAccountId: account.id, provider: 'google_drive', providerFileId: driveFile.id, name: driveFile.name, mimeType: driveFile.mimeType, sizeBytes: driveFile.sizeBytes, takenAt: driveFile.takenAt, status: 'active', folderId: dbFolderId },
      })
      created += 1
      continue
    }

    const reappeared = existing.status !== 'active' && existing.deletedBySync
    const needsUpdate = reappeared || existing.name !== driveFile.name || existing.mimeType !== driveFile.mimeType || existing.sizeBytes !== driveFile.sizeBytes || existing.folderId !== dbFolderId || (existing.takenAt?.getTime() ?? null) !== (driveFile.takenAt?.getTime() ?? null)
    if (needsUpdate) {
      await prisma.file.update({
        where: { id: existing.id },
        data: { name: driveFile.name, mimeType: driveFile.mimeType, sizeBytes: driveFile.sizeBytes, takenAt: driveFile.takenAt, folderId: dbFolderId, ...(reappeared ? { status: 'active', deletedAt: null, deletedBySync: false } : {}) },
      })
      updated += 1
    }
  }

  const missingActiveIds = existingFiles.filter((file) => file.status === 'active' && !driveFileIds.has(file.providerFileId)).map((file) => file.id)
  if (missingActiveIds.length > 0) {
    const result = await prisma.file.updateMany({ where: { id: { in: missingActiveIds }, userId }, data: { status: 'deleted', deletedAt: new Date(), deletedBySync: true } })
    deleted = result.count
  }

  await syncGoogleQuota(account.id).catch(() => undefined)
  return { accountId: account.id, created, updated, deleted }
}
