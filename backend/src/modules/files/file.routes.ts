import type { ConnectedAccount, File, Folder } from '@prisma/client'
import { Router } from 'express'
import { google } from 'googleapis'
import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { env } from '../../config/env.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { hashToken, randomToken } from '../../utils/crypto.js'
import { openShareToken, sealShareToken } from '../../utils/share-token.js'
import { HttpError, clientMessage, describeError } from '../../utils/http-error.js'
import { thumbnailHandler } from '../photos/thumbnail.js'
import { ensureGoogleAppFolder, getAuthedGoogleClient, moveGoogleFile, syncGoogleAppFolderFiles } from '../google/google.service.js'
import { fetchMicrosoftFileContent, renameMicrosoftItem, syncMicrosoftAppFolderFiles } from '../microsoft/microsoft.service.js'
import { syncQuotaForAccount } from '../storage/sync-quota.js'
import { syncS3Quota, createS3Client, getS3ConfigForAccount } from '../s3/s3.service.js'
import { deleteProviderFile } from './provider-delete.js'
import { streamProviderFile } from './stream-file.js'
import { googleDownloadExportMimeTypes, normalizeHeaders, withExtension } from './stream-google-file.js'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { Readable } from 'node:stream'
import { ZipArchive } from 'archiver'
import { createAuditLog } from '../../utils/audit.js'



export const fileRouter = Router()

fileRouter.get('/preview/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token)
    const preview = await prisma.filePreviewToken.findFirst({
      where: { tokenHash: hashToken(token), expiresAt: { gt: new Date() } },
      include: { file: { include: { connectedAccount: true } } },
    })
    if (!preview || preview.file.status !== 'active') return res.status(404).json({ code: 'PREVIEW_NOT_FOUND', message: 'Preview token not found.' })
    return streamProviderFile(preview.file, req.headers.range, res, { disposition: 'inline' })
  } catch (error) {
    return next(error)
  }
})

fileRouter.use(requireAuth)

fileRouter.get('/', async (req: AuthRequest, res, next) => {
  try {
    const query = z.object({
      folderId: z.string().optional(),
      rootOnly: z.literal('1').optional(),
      q: z.string().trim().max(255).optional(),
      kind: z.enum(['image', 'video', 'pdf', 'doc', 'archive']).optional(),
      accountId: z.string().optional(),
      minSize: z.coerce.number().optional(),
      maxSize: z.coerce.number().optional(),
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional()
    }).parse(req.query)

    const typeFilters: Record<string, string[]> = {
      image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
      video: ['video/mp4', 'video/mpeg', 'video/ogg', 'video/quicktime', 'video/webm'],
      pdf: ['application/pdf'],
      doc: ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'],
      archive: ['application/zip', 'application/x-rar-compressed', 'application/x-tar', 'application/x-7z-compressed']
    }

    const where: any = {
      userId: req.user!.id,
      status: 'active',
      ...(query.folderId ? { folderId: query.folderId } : query.rootOnly ? { folderId: null } : {}),
      ...(query.q ? { name: { contains: query.q } } : {}),
      ...(query.accountId ? { connectedAccountId: query.accountId } : {}),
      ...(query.kind ? { mimeType: { in: typeFilters[query.kind] || [] } } : {}),
      ...(query.minSize !== undefined || query.maxSize !== undefined ? {
        sizeBytes: {
          ...(query.minSize !== undefined ? { gte: BigInt(query.minSize) } : {}),
          ...(query.maxSize !== undefined ? { lte: BigInt(query.maxSize) } : {})
        }
      } : {}),
      ...(query.startDate || query.endDate ? {
        createdAt: {
          ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
          ...(query.endDate ? { lte: new Date(query.endDate) } : {})
        }
      } : {})
    }

    const files = await prisma.file.findMany({
      where,
      include: {
        connectedAccount: { select: { id: true, email: true, provider: true } },
        folder: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' }
    })
    return res.json({ files: files.map((file) => ({ ...file, sizeBytes: file.sizeBytes.toString() })) })
  } catch (error) {
    return next(error)
  }
})

// Google Drive decides where a file sits (the sync reads it back), so a move has to happen there too or the next sync undoes it.
// A Google file can only go to a folder that is mirrored in its own account. Other providers keep their folders in the database.
async function placeFileInFolder(file: File & { connectedAccount: ConnectedAccount }, folder: Folder | null) {
  if (file.provider !== 'google_drive') return
  if (folder && (folder.connectedAccountId !== file.connectedAccountId || !folder.providerFolderId)) {
    throw new HttpError(400, 'FOLDER_NOT_ON_ACCOUNT', 'That folder belongs to another account, so the file cannot be moved there.')
  }
  const parentId = folder?.providerFolderId ?? await ensureGoogleAppFolder(file.connectedAccount)
  await moveGoogleFile(file.connectedAccount, file.providerFileId, parentId)
}

const batchFileSchema = z.object({ fileIds: z.array(z.string().min(1)).min(1).max(100) })

fileRouter.patch('/batch', async (req: AuthRequest, res, next) => {
  try {
    const body = batchFileSchema.extend({ folderId: z.string().nullable().optional() }).parse(req.body)
    const folder = body.folderId ? await prisma.folder.findFirstOrThrow({ where: { id: body.folderId, userId: req.user!.id, deletedAt: null } }) : null
    const files = await prisma.file.findMany({ where: { id: { in: body.fileIds }, userId: req.user!.id, status: 'active' }, include: { connectedAccount: true } })
    const movedIds: string[] = []
    const failed: Array<{ fileId: string; code?: string; message: string }> = []
    for (const file of files) {
      try {
        await placeFileInFolder(file, folder)
        movedIds.push(file.id)
      } catch (error) {
        console.error('Failed to move file', file.id, describeError(error))
        failed.push({ fileId: file.id, code: error instanceof HttpError ? error.code : undefined, message: clientMessage(error, 'Move failed.') })
      }
    }
    if (movedIds.length > 0) await prisma.file.updateMany({ where: { id: { in: movedIds }, userId: req.user!.id }, data: { folderId: body.folderId ?? null } })
    await createAuditLog(req.user!.id, 'MOVE_FILES', 'file', undefined, { count: movedIds.length, folderId: body.folderId })
    if (movedIds.length === 0 && failed.length > 0) {
      const codes = new Set(failed.map((item) => item.code))
      return res.status(400).json({ code: codes.size === 1 && failed[0].code ? failed[0].code : 'FILES_MOVE_FAILED', message: failed[0].message, moved: 0, failed })
    }
    return res.json({ status: 'ok', moved: movedIds.length, failed })
  } catch (error) {
    return next(error)
  }
})

fileRouter.delete('/batch', async (req: AuthRequest, res, next) => {
  try {
    const body = batchFileSchema.parse(req.body)
    const files = await prisma.file.findMany({ where: { id: { in: body.fileIds }, userId: req.user!.id, status: 'active' } })
    const result = await prisma.file.updateMany({
      where: { id: { in: body.fileIds }, userId: req.user!.id, status: 'active' },
      data: { status: 'deleted', deletedAt: new Date() }
    })
    for (const f of files) {
      await createAuditLog(req.user!.id, 'TRASH_FILE', 'file', f.id, { name: f.name })
    }
    return res.json({ status: 'ok', deleted: result.count })
  } catch (error) {
    return next(error)
  }
})

fileRouter.get('/trash', async (req: AuthRequest, res, next) => {
  try {
    const query = z.object({ q: z.string().trim().max(255).optional() }).parse(req.query)
    const files = await prisma.file.findMany({
      where: {
        userId: req.user!.id,
        status: 'deleted',
        ...(query.q ? { name: { contains: query.q } } : {})
      },
      include: {
        connectedAccount: { select: { id: true, email: true, provider: true } },
        folder: { select: { id: true, name: true } }
      },
      orderBy: { deletedAt: 'desc' }
    })
    return res.json({ files: files.map((file) => ({ ...file, sizeBytes: file.sizeBytes.toString() })) })
  } catch (error) {
    return next(error)
  }
})

fileRouter.post('/batch/restore', async (req: AuthRequest, res, next) => {
  try {
    const body = batchFileSchema.parse(req.body)
    const files = await prisma.file.findMany({ where: { id: { in: body.fileIds }, userId: req.user!.id, status: 'deleted' } })
    const result = await prisma.file.updateMany({
      where: { id: { in: body.fileIds }, userId: req.user!.id, status: 'deleted' },
      data: { status: 'active', deletedAt: null }
    })
    // A file whose folder was deleted meanwhile would come back invisible: put it at the root instead.
    const folderIds = [...new Set(files.map((file) => file.folderId).filter((id): id is string => Boolean(id)))]
    if (folderIds.length > 0) {
      const liveFolders = new Set((await prisma.folder.findMany({ where: { id: { in: folderIds }, deletedAt: null }, select: { id: true } })).map((folder) => folder.id))
      const detachIds = files.filter((file) => file.folderId && !liveFolders.has(file.folderId)).map((file) => file.id)
      if (detachIds.length > 0) await prisma.file.updateMany({ where: { id: { in: detachIds }, userId: req.user!.id }, data: { folderId: null } })
    }
    for (const f of files) {
      await createAuditLog(req.user!.id, 'RESTORE_FILE', 'file', f.id, { name: f.name })
    }
    return res.json({ status: 'ok', restored: result.count })
  } catch (error) {
    return next(error)
  }
})

fileRouter.delete('/batch/permanent', async (req: AuthRequest, res, next) => {
  try {
    const body = batchFileSchema.parse(req.body)
    const files = await prisma.file.findMany({
      where: { id: { in: body.fileIds }, userId: req.user!.id, status: 'deleted' },
      include: { connectedAccount: true }
    })
    const deletedIds: string[] = []
    const syncedAccountIds = new Set<string>()
    const failed: Array<{ fileId: string; message: string }> = []

    for (const file of files) {
      try {
        await deleteProviderFile(file)
        deletedIds.push(file.id)
        syncedAccountIds.add(file.connectedAccountId)
        await createAuditLog(req.user!.id, 'PERMANENT_DELETE_FILE', 'file', file.id, { name: file.name })
      } catch (error) {
        console.error('Failed to delete file', file.id, describeError(error))
        failed.push({ fileId: file.id, message: clientMessage(error, 'Delete failed.') })
      }
    }

    if (deletedIds.length > 0) {
      await prisma.file.deleteMany({
        where: { id: { in: deletedIds }, userId: req.user!.id }
      })
    }

    for (const accountId of syncedAccountIds) {
      const account = files.find((file) => file.connectedAccountId === accountId)?.connectedAccount
      if (account) await syncQuotaForAccount(account).catch(() => undefined)
    }

    if (deletedIds.length === 0 && failed.length > 0) {
      return res.status(400).json({ code: 'FILES_DELETE_FAILED', message: 'No files were permanently deleted.', deleted: 0, failed })
    }
    return res.json({ status: 'ok', deleted: deletedIds.length, failed })
  } catch (error) {
    return next(error)
  }
})

fileRouter.get('/shared-links', async (req: AuthRequest, res, next) => {
  try {
    const shares = await prisma.fileShare.findMany({
      where: { userId: req.user!.id, enabled: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      include: { file: { include: { connectedAccount: { select: { email: true, provider: true } }, folder: { select: { id: true, name: true } } } } },
      orderBy: { createdAt: 'desc' },
    })
    const items = shares.filter((share) => share.file.status === 'active').map((share) => {
      const token = openShareToken(share.token)
      const url = token ? `${env.FRONTEND_URL}/public/files/${token}` : null
      return {
        id: share.id,
        url,
        createdAt: share.createdAt.toISOString(),
        expiresAt: share.expiresAt?.toISOString() ?? null,
        file: { ...share.file, sizeBytes: share.file.sizeBytes.toString() },
      }
    })
    // A share whose link cannot be rebuilt stays enabled (its old link keeps working) but is hidden once the same file has a readable one.
    return res.json({ shares: items.filter((item) => item.url || !items.some((other) => other.url && other.file.id === item.file.id)) })
  } catch (error) {
    return next(error)
  }
})

fileRouter.post('/sync-google', async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ connectedAccountId: z.string().min(1).optional() }).parse(req.body ?? {})
    const accounts = await prisma.connectedAccount.findMany({
      where: { userId: req.user!.id, provider: { in: ['google_drive', 'onedrive'] }, status: 'connected', ...(body.connectedAccountId ? { id: body.connectedAccountId } : {}) },
      select: { id: true, provider: true },
    })

    const results = []
    for (const account of accounts) {
      results.push(account.provider === 'onedrive' ? await syncMicrosoftAppFolderFiles(account.id, req.user!.id) : await syncGoogleAppFolderFiles(account.id, req.user!.id))
    }

    return res.json({
      status: 'ok',
      results,
    })
  } catch (error) {
    return next(error)
  }
})

fileRouter.get('/:id', async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const file = await prisma.file.findFirstOrThrow({ where: { id: fileId, userId: req.user!.id }, include: { connectedAccount: { select: { id: true, email: true, provider: true } }, folder: { select: { id: true, name: true } } } })
    return res.json({ file: { ...file, sizeBytes: file.sizeBytes.toString() } })
  } catch (error) {
    return next(error)
  }
})

fileRouter.patch('/:id', async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ name: z.string().min(1).max(255).optional(), folderId: z.string().nullable().optional() }).parse(req.body)
    const fileId = String(req.params.id)
    const file = await prisma.file.findFirstOrThrow({ where: { id: fileId, userId: req.user!.id }, include: { connectedAccount: true } })
    const drive = body.name && file.provider === 'google_drive' ? google.drive({ version: 'v3', auth: await getAuthedGoogleClient(file.connectedAccount) }) : null
    const folder = body.folderId ? await prisma.folder.findFirstOrThrow({ where: { id: body.folderId, userId: req.user!.id, deletedAt: null } }) : null
    if (body.folderId !== undefined) await placeFileInFolder(file, folder)
    if (body.name && drive) await drive.files.update({ fileId: file.providerFileId, requestBody: { name: body.name } })
    // OneDrive may adjust the name (invalid characters), so the stored name is the one it reports back.
    const newName = body.name && file.provider === 'onedrive' ? await renameMicrosoftItem(file.connectedAccount, file.providerFileId, body.name) : body.name
    const updated = await prisma.file.update({ where: { id: file.id }, data: { ...(newName ? { name: newName } : {}), ...(body.folderId !== undefined ? { folderId: body.folderId } : {}) }, include: { connectedAccount: { select: { id: true, email: true, provider: true } }, folder: { select: { id: true, name: true } } } })
    await createAuditLog(req.user!.id, 'UPDATE_FILE', 'file', updated.id, { name: updated.name, updates: body })
    return res.json({ file: { ...updated, sizeBytes: updated.sizeBytes.toString() } })
  } catch (error) {
    return next(error)
  }
})

fileRouter.post('/:id/share', async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const file = await prisma.file.findFirstOrThrow({ where: { id: fileId, userId: req.user!.id, status: 'active' } })
    const existingShare = await prisma.fileShare.findFirst({ where: { fileId: file.id, userId: req.user!.id, enabled: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { createdAt: 'desc' } })

    let shareId = existingShare?.id
    let token = existingShare ? openShareToken(existingShare.token) : null
    const reused = Boolean(token)
    if (!token) {
      // No share yet, or one whose link cannot be rebuilt (created before tokens were kept, or the encryption key changed).
      // A new share is added instead of rotating it, so links already handed out keep working.
      token = randomToken(32)
      const share = await prisma.fileShare.create({ data: { fileId: file.id, userId: req.user!.id, token: sealShareToken(token), tokenHash: hashToken(token) } })
      shareId = share.id
    }

    return res.status(reused ? 200 : 201).json({ url: `${env.FRONTEND_URL}/public/files/${token}`, shareId })
  } catch (error) {
    return next(error)
  }
})

fileRouter.post('/:id/public-permission', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const file = await prisma.file.findFirstOrThrow({ where: { id: fileId, userId: req.user!.id }, include: { connectedAccount: true } })
    if (file.provider !== 'google_drive') {
      return res.status(400).json({ code: 'UNSUPPORTED_PROVIDER', message: 'Only Google Drive files can be made public.' })
    }
    const auth = await getAuthedGoogleClient(file.connectedAccount)
    const drive = google.drive({ version: 'v3', auth })
    // The only place that opens a Drive file to the world, and only when the user asks for it. Read only: anyone with the
    // link can view and download it, nobody can change it. MultiDrive cannot take this permission back, so it stays opt in.
    await drive.permissions.create({
      fileId: file.providerFileId,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      }
    })
    const metadata = await drive.files.get({ fileId: file.providerFileId, fields: 'webViewLink,webContentLink' })
    return res.json({ status: 'ok', url: metadata.data.webViewLink ?? metadata.data.webContentLink })
  } catch (error: any) {
    console.error('Failed to update Google Drive permissions:', describeError(error))
    return res.status(500).json({ code: error instanceof HttpError ? error.code : 'GOOGLE_API_ERROR', message: clientMessage(error, 'Failed to update Google Drive permissions.') })
  }
})

fileRouter.delete('/:id/share', async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    await prisma.fileShare.updateMany({ where: { fileId, userId: req.user!.id, enabled: true }, data: { enabled: false } })
    return res.json({ status: 'ok' })
  } catch (error) {
    return next(error)
  }
})

fileRouter.post('/:id/preview-token', async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const file = await prisma.file.findFirstOrThrow({ where: { id: fileId, userId: req.user!.id, status: 'active' } })
    const token = randomToken(32)
    await prisma.filePreviewToken.create({ data: { fileId: file.id, userId: req.user!.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 10 * 60_000) } })
    const path = `/files/preview/${token}`
    return res.status(201).json({ path, url: `${req.protocol}://${req.get('host')}${path}` })
  } catch (error) {
    return next(error)
  }
})

fileRouter.get('/:id/thumbnail', thumbnailHandler)

fileRouter.get('/:id/view-url', async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const file = await prisma.file.findFirstOrThrow({ where: { id: fileId, userId: req.user!.id }, include: { connectedAccount: true } })
    if (file.provider !== 'google_drive') return res.json({ url: null })
    const auth = await getAuthedGoogleClient(file.connectedAccount)
    const drive = google.drive({ version: 'v3', auth })

    // Never opens the file: a Drive link that others cannot open is useless, and a Drive permission cannot be revoked from
    // MultiDrive. The Drive link is returned only when the file is already public; otherwise `url` is null and the UI falls back to
    // a MultiDrive share link, which is read only and can be disabled.
    const metadata = await drive.files.get({ fileId: file.providerFileId, fields: 'webViewLink,webContentLink,permissions(type)' })
    const isPublic = metadata.data.permissions?.some((permission) => permission.type === 'anyone') ?? false
    return res.json({ url: isPublic ? (metadata.data.webViewLink ?? metadata.data.webContentLink) : null })
  } catch (error) {
    return next(error)
  }
})

fileRouter.get('/:id/download', async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const file = await prisma.file.findFirstOrThrow({ where: { id: fileId, userId: req.user!.id }, include: { connectedAccount: true } })
    return streamProviderFile(file, req.headers.range, res, { disposition: 'attachment' })
  } catch (error) {
    return next(error)
  }
})

fileRouter.delete('/:id', async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const file = await prisma.file.findFirstOrThrow({ where: { id: fileId, userId: req.user!.id, status: 'active' } })
    await prisma.file.update({ where: { id: file.id }, data: { status: 'deleted', deletedAt: new Date() } })
    await createAuditLog(req.user!.id, 'TRASH_FILE', 'file', file.id, { name: file.name })
    return res.json({ status: 'ok' })
  } catch (error) {
    return next(error)
  }
})

fileRouter.post('/batch-download', async (req: AuthRequest, res, next) => {
  try {
    const body = batchFileSchema.parse(req.body)
    const files = await prisma.file.findMany({
      where: { id: { in: body.fileIds }, userId: req.user!.id, status: 'active' },
      include: { connectedAccount: true }
    })
    if (files.length === 0) return res.status(404).json({ code: 'FILES_NOT_FOUND', message: 'No files found.' })

    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', 'attachment; filename="multidrive-download.zip"')

    const archive = new ZipArchive({ zlib: { level: 9 } })
    let archiveFailed = false
    // Never throw here: this runs outside the route's try/catch, so a throw would be an uncaught exception that stops the process.
    const failArchive = (error: unknown) => {
      if (archiveFailed) return
      archiveFailed = true
      console.error('Batch download archive failed:', describeError(error))
      archive.unpipe(res)
      archive.abort()
      if (!res.headersSent) {
        res.removeHeader('Content-Disposition')
        res.status(500).json({ code: 'BATCH_DOWNLOAD_FAILED', message: 'The ZIP download could not be created.' })
      } else {
        // Destroying the response makes the client see a failed download instead of a truncated ZIP.
        res.destroy()
      }
    }
    archive.on('error', failArchive)
    res.on('close', () => {
      if (!res.writableFinished) archive.abort()
    })
    archive.pipe(res)

    for (const file of files) {
      if (archiveFailed) break
      try {
        let stream: Readable
        let fileName = file.name
        if (file.provider === 's3') {
          const config = await getS3ConfigForAccount(file.connectedAccountId)
          const client = createS3Client(config)
          const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: file.providerFileId }))
          stream = response.Body as Readable
        } else if (file.provider === 'onedrive') {
          const response = await fetchMicrosoftFileContent(file.connectedAccount, file.providerFileId)
          if (!response.ok || !response.body) continue
          stream = Readable.fromWeb(response.body as any)
        } else {
          const auth = await getAuthedGoogleClient(file.connectedAccount)
          const headers = normalizeHeaders(await auth.getRequestHeaders())
          const exportTarget = googleDownloadExportMimeTypes[file.mimeType]
          if (exportTarget) {
            fileName = withExtension(file.name, exportTarget.extension)
          }
          const url = exportTarget
            ? `https://www.googleapis.com/drive/v3/files/${file.providerFileId}/export?mimeType=${encodeURIComponent(exportTarget.mimeType)}`
            : `https://www.googleapis.com/drive/v3/files/${file.providerFileId}?alt=media`
          const response = await fetch(url, { headers })
          if (!response.ok || !response.body) continue
          stream = Readable.fromWeb(response.body as any)
        }
        // Archiver listens to a source only when it reaches it in its queue, so an earlier source error would be uncaught.
        stream.on('error', failArchive)
        archive.append(stream, { name: fileName })
      } catch (err) {
        console.error(`Failed to add file ${file.name} to zip:`, err)
      }
    }

    await archive.finalize()
  } catch (error) {
    // The archive error handler already answered or destroyed the response.
    if (res.headersSent || res.destroyed) return
    return next(error)
  }
})
