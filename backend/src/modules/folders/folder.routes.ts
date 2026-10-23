import { Router } from 'express'
import { google } from 'googleapis'
import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { getAuthedGoogleClient, syncGoogleQuota, ensureGoogleAppFolder } from '../google/google.service.js'
import { deleteProviderFile } from '../files/provider-delete.js'
import { syncQuotaForAccount } from '../storage/sync-quota.js'
import { createAuditLog } from '../../utils/audit.js'
import { HttpError, describeError, isProviderNotFound } from '../../utils/http-error.js'

export const folderRouter = Router()
folderRouter.use(requireAuth)

const defaultFolderColor = '#3b82f6'
const defaultFolderIconUrl = 'https://api.iconify.design/lucide:folder.svg'
const iconUrlSchema = z.string().url().startsWith('https://api.iconify.design/lucide:').max(2048)
const colorSchema = z.string().regex(/^(#[0-9a-fA-F]{6}|text-[a-z]+-[0-9]+)$/).max(64)

const createSchema = z.object({
  name: z.string().min(1).max(255),
  color: colorSchema.optional(),
  iconUrl: iconUrlSchema.nullable().optional(),
  parentId: z.string().nullable().optional(),
})

function serializeFolder(folder: { id: string; name: string; color: string; iconUrl?: string | null; parentId?: string | null; providerFolderId?: string | null; createdAt: Date; updatedAt: Date }) {
  return { ...folder, providerFolderId: folder.providerFolderId ?? null, createdAt: folder.createdAt.toISOString(), updatedAt: folder.updatedAt.toISOString() }
}

async function ensureProviderFolderIds(
  folders: Array<{ id: string; name: string; parentId: string | null; providerFolderId: string | null }>,
  userId: string
) {
  const foldersWithoutId = folders.filter((f) => !f.providerFolderId)
  if (foldersWithoutId.length === 0) return

  const connectedAccount = await prisma.connectedAccount.findFirst({
    where: { userId, provider: 'google_drive', status: 'connected' }
  })
  if (!connectedAccount) return

  try {
    const auth = await getAuthedGoogleClient(connectedAccount)
    const drive = google.drive({ version: 'v3', auth })
    const appFolderId = await ensureGoogleAppFolder(connectedAccount)

    for (const folder of foldersWithoutId) {
      try {
        let parentGoogleId = appFolderId
        if (folder.parentId) {
          const parentFolder = await prisma.folder.findFirst({
            where: { id: folder.parentId, userId }
          })
          if (parentFolder?.providerFolderId) {
            parentGoogleId = parentFolder.providerFolderId
          }
        }

        const driveFolder = await drive.files.create({
          requestBody: {
            name: folder.name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentGoogleId]
          },
          fields: 'id'
        })

        const gId = driveFolder.data.id ?? null
        if (gId) {
          await prisma.folder.update({
            where: { id: folder.id },
            data: { providerFolderId: gId, connectedAccountId: connectedAccount.id }
          })
          folder.providerFolderId = gId
        }
      } catch (error) {
        console.error(`Failed self-healing for folder ${folder.id}:`, error)
      }
    }
  } catch (error) {
    console.error('Failed self-healing Google Drive auth:', error)
  }
}

folderRouter.get('/', async (req: AuthRequest, res, next) => {
  try {
    const query = z.object({ parentId: z.string().nullable().optional(), all: z.string().optional() }).parse(req.query)
    const folders = await prisma.folder.findMany({
      where: { userId: req.user!.id, deletedAt: null, ...(query.all === '1' ? {} : { parentId: query.parentId ?? null }) },
      select: { id: true, name: true, color: true, iconUrl: true, parentId: true, providerFolderId: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    })
    await ensureProviderFolderIds(folders, req.user!.id)
    return res.json({ folders: folders.map(serializeFolder) })
  } catch (error) {
    return next(error)
  }
})

folderRouter.get('/recent', async (req: AuthRequest, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 4), 4)
    const folders = await prisma.folder.findMany({
      where: { userId: req.user!.id, deletedAt: null },
      select: { id: true, name: true, color: true, iconUrl: true, parentId: true, providerFolderId: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    })
    await ensureProviderFolderIds(folders, req.user!.id)
    return res.json({ folders: folders.map(serializeFolder) })
  } catch (error) {
    return next(error)
  }
})

folderRouter.post('/', async (req: AuthRequest, res, next) => {
  try {
    const body = createSchema.parse(req.body)
    let parentFolder = null
    if (body.parentId) {
      parentFolder = await prisma.folder.findFirstOrThrow({
        where: { id: body.parentId, userId: req.user!.id, deletedAt: null }
      })
    }

    const connectedAccount = await prisma.connectedAccount.findFirst({
      where: { userId: req.user!.id, provider: 'google_drive', status: 'connected' }
    })

    let providerFolderId: string | null = null
    if (connectedAccount) {
      try {
        const auth = await getAuthedGoogleClient(connectedAccount)
        const drive = google.drive({ version: 'v3', auth })

        let googleParentId = await ensureGoogleAppFolder(connectedAccount)
        if (parentFolder && parentFolder.providerFolderId) {
          googleParentId = parentFolder.providerFolderId
        }

        const driveFolder = await drive.files.create({
          requestBody: {
            name: body.name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [googleParentId]
          },
          fields: 'id'
        })
        providerFolderId = driveFolder.data.id ?? null
      } catch (error) {
        console.error('Failed to create folder on Google Drive:', error)
      }
    }

    const folder = await prisma.folder.create({
      data: {
        userId: req.user!.id,
        name: body.name,
        color: body.color ?? defaultFolderColor,
        iconUrl: body.iconUrl ?? defaultFolderIconUrl,
        parentId: body.parentId ?? null,
        providerFolderId,
        connectedAccountId: connectedAccount?.id ?? null
      },
      select: { id: true, name: true, color: true, iconUrl: true, parentId: true, providerFolderId: true, createdAt: true, updatedAt: true },
    })
    await createAuditLog(req.user!.id, 'CREATE_FOLDER', 'folder', folder.id, { name: folder.name })
    return res.status(201).json({ folder: serializeFolder(folder) })
  } catch (error) {
    return next(error)
  }
})

folderRouter.patch('/:id', async (req: AuthRequest, res, next) => {
  try {
    const body = createSchema.partial().parse(req.body)
    const folderId = String(req.params.id)
    if (body.parentId === folderId) return res.status(400).json({ code: 'FOLDER_INVALID_PARENT', message: 'Folder cannot be moved into itself.' })

    const folderRecord = await prisma.folder.findFirstOrThrow({
      where: { id: folderId, userId: req.user!.id, deletedAt: null },
      include: { connectedAccount: true }
    })

    if (body.parentId) {
      await prisma.folder.findFirstOrThrow({ where: { id: body.parentId, userId: req.user!.id, deletedAt: null } })
      const folders = await prisma.folder.findMany({ where: { userId: req.user!.id, deletedAt: null }, select: { id: true, parentId: true } })
      const descendantIds = new Set<string>([folderId])
      let changed = true
      while (changed) {
        changed = false
        for (const folder of folders) {
          if (folder.parentId && descendantIds.has(folder.parentId) && !descendantIds.has(folder.id)) {
            descendantIds.add(folder.id)
            changed = true
          }
        }
      }
      if (descendantIds.has(body.parentId)) return res.status(400).json({ code: 'FOLDER_INVALID_PARENT', message: 'Folder cannot be moved into itself or a child folder.' })
    }

    // Update name on Google Drive if changed
    if (body.name && folderRecord.providerFolderId && folderRecord.connectedAccount) {
      try {
        const auth = await getAuthedGoogleClient(folderRecord.connectedAccount)
        const drive = google.drive({ version: 'v3', auth })
        await drive.files.update({
          fileId: folderRecord.providerFolderId,
          requestBody: { name: body.name }
        })
      } catch (error) {
        console.error('Failed to rename folder on Google Drive:', error)
      }
    }

    // Update parent on Google Drive if moved
    if (body.parentId !== undefined && folderRecord.providerFolderId && folderRecord.connectedAccount) {
      try {
        const auth = await getAuthedGoogleClient(folderRecord.connectedAccount)
        const drive = google.drive({ version: 'v3', auth })

        let newGoogleParentId = await ensureGoogleAppFolder(folderRecord.connectedAccount)
        if (body.parentId) {
          const newParent = await prisma.folder.findFirst({ where: { id: body.parentId, userId: req.user!.id } })
          if (newParent?.providerFolderId) {
            newGoogleParentId = newParent.providerFolderId
          }
        }

        const fileInfo = await drive.files.get({ fileId: folderRecord.providerFolderId, fields: 'parents' })
        const previousParents = fileInfo.data.parents?.join(',')

        await drive.files.update({
          fileId: folderRecord.providerFolderId,
          addParents: newGoogleParentId,
          removeParents: previousParents,
          fields: 'id, parents'
        })
      } catch (error) {
        console.error('Failed to move folder on Google Drive:', error)
      }
    }

    const folder = await prisma.folder.updateMany({
      where: { id: folderId, userId: req.user!.id, deletedAt: null },
      data: { ...(body.name ? { name: body.name } : {}), ...(body.color ? { color: body.color } : {}), ...(body.iconUrl !== undefined ? { iconUrl: body.iconUrl } : {}), ...(body.parentId !== undefined ? { parentId: body.parentId } : {}) },
    })
    if (folder.count === 0) return res.status(404).json({ code: 'FOLDER_NOT_FOUND', message: 'Folder not found.' })
    const updated = await prisma.folder.findFirstOrThrow({
      where: { id: folderId, userId: req.user!.id },
      select: { id: true, name: true, color: true, iconUrl: true, parentId: true, providerFolderId: true, createdAt: true, updatedAt: true },
    })
    await createAuditLog(req.user!.id, 'UPDATE_FOLDER', 'folder', updated.id, { name: updated.name, updates: body })
    return res.json({ folder: serializeFolder(updated) })
  } catch (error) {
    return next(error)
  }
})

folderRouter.delete('/:id', async (req: AuthRequest, res, next) => {
  try {
    const rootId = String(req.params.id)
    const root = await prisma.folder.findFirstOrThrow({ where: { id: rootId, userId: req.user!.id, deletedAt: null } })
    const folders = await prisma.folder.findMany({ where: { userId: req.user!.id, deletedAt: null }, select: { id: true, parentId: true } })
    const folderIds = new Set<string>([root.id])
    let changed = true
    while (changed) {
      changed = false
      for (const folder of folders) {
        if (folder.parentId && folderIds.has(folder.parentId) && !folderIds.has(folder.id)) {
          folderIds.add(folder.id)
          changed = true
        }
      }
    }

    const files = await prisma.file.findMany({ where: { userId: req.user!.id, status: 'active', folderId: { in: [...folderIds] } }, include: { connectedAccount: true } })
    const syncedAccountIds = new Set<string>()
    const removedFileIds: string[] = []
    const survivingFiles: typeof files = []
    for (const file of files) {
      try {
        await deleteProviderFile(file)
        removedFileIds.push(file.id)
        syncedAccountIds.add(file.connectedAccountId)
      } catch (error) {
        // Keep going so one failure does not block the whole deletion
        console.error('Failed to delete file', file.id, describeError(error))
        survivingFiles.push(file)
      }
    }

    // Delete folders on Google Drive (this also removes whatever is still inside them there)
    const removedFolderIds = new Set<string>()
    const foldersToDelete = await prisma.folder.findMany({ where: { id: { in: [...folderIds] }, userId: req.user!.id }, include: { connectedAccount: true } })
    for (const f of foldersToDelete) {
      if (f.providerFolderId && f.connectedAccount) {
        try {
          const auth = await getAuthedGoogleClient(f.connectedAccount)
          const drive = google.drive({ version: 'v3', auth })
          await drive.files.delete({ fileId: f.providerFolderId })
          removedFolderIds.add(f.id)
          if (f.connectedAccountId) syncedAccountIds.add(f.connectedAccountId)
        } catch (error) {
          if (isProviderNotFound(error)) removedFolderIds.add(f.id)
          else console.error('Failed to delete folder', f.id, describeError(error))
        }
      }
    }

    // A folder is gone when it lives only in the database or Drive removed it (itself or through an ancestor, which takes
    // everything inside with it). One that Drive could not remove must not be marked deleted: the next sync would bring it back.
    const parentById = new Map(folders.map((folder) => [folder.id, folder.parentId]))
    const driveRemovedFolderIds = new Set<string>()
    const goneFolderIds = new Set<string>()
    for (const f of foldersToDelete) {
      if (!f.providerFolderId || !f.connectedAccount) {
        goneFolderIds.add(f.id)
        continue
      }
      const seen = new Set<string>()
      for (let current: string | null | undefined = f.id; current && !seen.has(current); current = parentById.get(current)) {
        if (removedFolderIds.has(current)) {
          driveRemovedFolderIds.add(f.id)
          goneFolderIds.add(f.id)
          break
        }
        seen.add(current)
      }
    }

    // A file that is really gone from its provider has nothing to restore, so it is not kept in the trash. One that could
    // not be deleted (and is not inside a Drive folder that was removed) still exists there, so it goes to the trash.
    // Google files that were already in the trash inside a removed Drive folder are gone too.
    const goneWithFolder = survivingFiles.filter((file) => file.provider === 'google_drive' && file.folderId && driveRemovedFolderIds.has(file.folderId)).map((file) => file.id)
    const trashedFileIds = survivingFiles.map((file) => file.id).filter((id) => !goneWithFolder.includes(id))
    const trashedInRemovedFolders = (await prisma.file.findMany({ where: { userId: req.user!.id, status: 'deleted', provider: 'google_drive', folderId: { in: [...driveRemovedFolderIds] } }, select: { id: true } })).map((file) => file.id)
    const goneFileIds = [...removedFileIds, ...goneWithFolder, ...trashedInRemovedFolders]
    if (goneFileIds.length > 0) await prisma.file.deleteMany({ where: { id: { in: goneFileIds }, userId: req.user!.id } })
    if (trashedFileIds.length > 0) await prisma.file.updateMany({ where: { id: { in: trashedFileIds }, userId: req.user!.id }, data: { status: 'deleted', deletedAt: new Date(), deletedBySync: false } })
    await prisma.folder.updateMany({ where: { id: { in: [...goneFolderIds] }, userId: req.user!.id }, data: { deletedAt: new Date() } })
    for (const accountId of syncedAccountIds) {
      const provider = files.find((file) => file.connectedAccountId === accountId)?.provider ?? 'google_drive'
      await syncQuotaForAccount({ id: accountId, provider }).catch(() => undefined)
    }

    if (!goneFolderIds.has(root.id)) throw new HttpError(502, 'FOLDER_DELETE_FAILED', 'The folder could not be deleted from Google Drive. Try again.')
    await createAuditLog(req.user!.id, 'DELETE_FOLDER', 'folder', root.id, { name: root.name })
    return res.json({ status: 'ok' })
  } catch (error) {
    return next(error)
  }
})
