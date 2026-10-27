import { describe, expect, it, vi } from 'vitest'
import { prisma } from '../../config/prisma.js'
import { hashToken } from '../../utils/crypto.js'
import { api, createAccount, createFile, createFolder, createUser } from '../../test/helpers.js'
import { fakeDrive, googleService, providerNotFound } from '../../test/fakes.js'

async function setup() {
  const owner = await createUser()
  const account = await createAccount(owner.user.id)
  return { owner, account }
}

describe('GET /files', () => {
  it('lists only the caller\'s active files, with sizes as strings', async () => {
    const { owner, account } = await setup()
    const stranger = await createUser()
    const strangerAccount = await createAccount(stranger.user.id)
    await createFile(owner.user.id, account.id, { name: 'mine.txt', sizeBytes: 123n })
    await createFile(owner.user.id, account.id, { name: 'trashed.txt', status: 'deleted' })
    await createFile(stranger.user.id, strangerAccount.id, { name: 'theirs.txt' })

    const res = await api().get('/files').set(owner.auth)

    expect(res.status).toBe(200)
    expect(res.body.files.map((file: { name: string }) => file.name)).toEqual(['mine.txt'])
    expect(res.body.files[0].sizeBytes).toBe('123')
  })

  it('requires authentication', async () => {
    expect((await api().get('/files')).status).toBe(401)
  })

  it('filters by folder, rootOnly, name, kind and size range', async () => {
    const { owner, account } = await setup()
    const folder = await createFolder(owner.user.id)
    await createFile(owner.user.id, account.id, { name: 'root-photo.png', mimeType: 'image/png', sizeBytes: 500n })
    await createFile(owner.user.id, account.id, { name: 'inside.pdf', mimeType: 'application/pdf', sizeBytes: 5000n, folderId: folder.id })

    const names = async (query: string) => (await api().get(`/files?${query}`).set(owner.auth)).body.files.map((file: { name: string }) => file.name).sort()

    expect(await names(`folderId=${folder.id}`)).toEqual(['inside.pdf'])
    expect(await names('rootOnly=1')).toEqual(['root-photo.png'])
    expect(await names('q=photo')).toEqual(['root-photo.png'])
    expect(await names('kind=pdf')).toEqual(['inside.pdf'])
    expect(await names('minSize=1000')).toEqual(['inside.pdf'])
    expect(await names('maxSize=1000')).toEqual(['root-photo.png'])
  })

  it('accepts a fractional size bound by flooring it to whole bytes', async () => {
    const { owner, account } = await setup()
    await createFile(owner.user.id, account.id, { name: 'small.txt', sizeBytes: 314572n })

    // 0.3 MB * 1024 * 1024 = 314572.8 bytes: BigInt() would throw on the fraction.
    const res = await api().get('/files?minSize=314572.8').set(owner.auth)

    expect(res.status).toBe(200)
    expect(res.body.files).toHaveLength(1)
  })

  it.each([
    ['an unknown kind', 'kind=spreadsheet'],
    ['a negative size', 'minSize=-1'],
    ['a non numeric size', 'maxSize=abc'],
    ['a malformed date', 'startDate=yesterday'],
    ['an overlong search', `q=${'a'.repeat(256)}`],
  ])('rejects %s with 400', async (_label, query) => {
    const { owner } = await setup()
    const res = await api().get(`/files?${query}`).set(owner.auth)
    expect(res.status).toBe(400)
  })
})

describe('GET /files/:id', () => {
  it('returns the file and hides other users\' files as 404', async () => {
    const { owner, account } = await setup()
    const stranger = await createUser()
    const file = await createFile(owner.user.id, account.id)

    expect((await api().get(`/files/${file.id}`).set(owner.auth)).status).toBe(200)
    expect((await api().get(`/files/${file.id}`).set(stranger.auth)).status).toBe(404)
  })
})

describe('PATCH /files/batch (move)', () => {
  it('moves Google files in Drive and in the database', async () => {
    const { owner, account } = await setup()
    const folder = await createFolder(owner.user.id, { connectedAccountId: account.id, providerFolderId: 'drive-folder' })
    const file = await createFile(owner.user.id, account.id)

    const res = await api().patch('/files/batch').set(owner.auth).send({ fileIds: [file.id], folderId: folder.id })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ moved: 1, failed: [] })
    expect(googleService.moveGoogleFile).toHaveBeenCalledWith(expect.anything(), file.providerFileId, 'drive-folder')
    expect((await prisma.file.findUniqueOrThrow({ where: { id: file.id } })).folderId).toBe(folder.id)
  })

  it('moves a file to the root through the app folder when folderId is null', async () => {
    const { owner, account } = await setup()
    const folder = await createFolder(owner.user.id, { connectedAccountId: account.id, providerFolderId: 'drive-folder' })
    const file = await createFile(owner.user.id, account.id, { folderId: folder.id })

    const res = await api().patch('/files/batch').set(owner.auth).send({ fileIds: [file.id], folderId: null })

    expect(res.status).toBe(200)
    expect(googleService.moveGoogleFile).toHaveBeenCalledWith(expect.anything(), file.providerFileId, 'app-folder')
    expect((await prisma.file.findUniqueOrThrow({ where: { id: file.id } })).folderId).toBeNull()
  })

  it('refuses a folder from another account with 400 FOLDER_NOT_ON_ACCOUNT and leaves the file where it was', async () => {
    const { owner, account } = await setup()
    const otherAccount = await createAccount(owner.user.id)
    const folder = await createFolder(owner.user.id, { connectedAccountId: otherAccount.id, providerFolderId: 'other-drive-folder' })
    const file = await createFile(owner.user.id, account.id)

    const res = await api().patch('/files/batch').set(owner.auth).send({ fileIds: [file.id], folderId: folder.id })

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ code: 'FOLDER_NOT_ON_ACCOUNT', moved: 0 })
    expect(res.body.failed).toEqual([expect.objectContaining({ fileId: file.id, code: 'FOLDER_NOT_ON_ACCOUNT' })])
    expect(googleService.moveGoogleFile).not.toHaveBeenCalled()
    expect((await prisma.file.findUniqueOrThrow({ where: { id: file.id } })).folderId).toBeNull()
  })

  it('reports a partial failure per file and moves only the ones that succeeded', async () => {
    const { owner, account } = await setup()
    const folder = await createFolder(owner.user.id, { connectedAccountId: account.id, providerFolderId: 'drive-folder' })
    const good = await createFile(owner.user.id, account.id, { name: 'good.txt' })
    const bad = await createFile(owner.user.id, account.id, { name: 'bad.txt' })
    googleService.moveGoogleFile.mockImplementation(async (_account: unknown, providerFileId: string) => {
      if (providerFileId === bad.providerFileId) throw new Error('Drive said no: /secret/path')
    })

    const res = await api().patch('/files/batch').set(owner.auth).send({ fileIds: [good.id, bad.id], folderId: folder.id })

    expect(res.status).toBe(200)
    expect(res.body.moved).toBe(1)
    expect(res.body.failed).toEqual([{ fileId: bad.id, message: 'Move failed.' }])
    expect((await prisma.file.findUniqueOrThrow({ where: { id: good.id } })).folderId).toBe(folder.id)
    expect((await prisma.file.findUniqueOrThrow({ where: { id: bad.id } })).folderId).toBeNull()
  })

  it('answers 400 FILES_MOVE_FAILED, never leaking the provider message, when nothing could move', async () => {
    const { owner, account } = await setup()
    const folder = await createFolder(owner.user.id, { connectedAccountId: account.id, providerFolderId: 'drive-folder' })
    const file = await createFile(owner.user.id, account.id)
    googleService.moveGoogleFile.mockRejectedValue(new Error('internal /var/lib/secret detail'))

    const res = await api().patch('/files/batch').set(owner.auth).send({ fileIds: [file.id], folderId: folder.id })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('FILES_MOVE_FAILED')
    expect(JSON.stringify(res.body)).not.toContain('secret')
  })

  it('does not touch files that belong to someone else', async () => {
    const { owner, account } = await setup()
    const stranger = await createUser()
    const strangerAccount = await createAccount(stranger.user.id)
    const foreign = await createFile(stranger.user.id, strangerAccount.id)
    const folder = await createFolder(owner.user.id, { connectedAccountId: account.id, providerFolderId: 'drive-folder' })

    const res = await api().patch('/files/batch').set(owner.auth).send({ fileIds: [foreign.id], folderId: folder.id })

    expect(res.status).toBe(200)
    expect(res.body.moved).toBe(0)
    expect(googleService.moveGoogleFile).not.toHaveBeenCalled()
    expect((await prisma.file.findUniqueOrThrow({ where: { id: foreign.id } })).folderId).toBeNull()
  })

  it.each([
    ['an empty list', { fileIds: [] }],
    ['more than 100 ids', { fileIds: Array.from({ length: 101 }, (_, index) => `id-${index}`) }],
    ['a non array', { fileIds: 'abc' }],
  ])('rejects %s with 400', async (_label, body) => {
    const { owner } = await setup()
    expect((await api().patch('/files/batch').set(owner.auth).send(body)).status).toBe(400)
  })
})

describe('PATCH /files/:id', () => {
  it('renames in Drive and stores the new name', async () => {
    const { owner, account } = await setup()
    const file = await createFile(owner.user.id, account.id, { name: 'old.txt' })

    const res = await api().patch(`/files/${file.id}`).set(owner.auth).send({ name: 'new.txt' })

    expect(res.status).toBe(200)
    expect(res.body.file.name).toBe('new.txt')
    expect(fakeDrive.files.update).toHaveBeenCalledWith({ fileId: file.providerFileId, requestBody: { name: 'new.txt' } })
  })

  it('does not store the new name when Drive refuses the rename', async () => {
    const { owner, account } = await setup()
    const file = await createFile(owner.user.id, account.id, { name: 'old.txt' })
    fakeDrive.files.update.mockRejectedValue(new Error('quota'))

    const res = await api().patch(`/files/${file.id}`).set(owner.auth).send({ name: 'new.txt' })

    expect(res.status).toBe(500)
    expect((await prisma.file.findUniqueOrThrow({ where: { id: file.id } })).name).toBe('old.txt')
  })

  it('rejects an empty name with 400', async () => {
    const { owner, account } = await setup()
    const file = await createFile(owner.user.id, account.id)
    expect((await api().patch(`/files/${file.id}`).set(owner.auth).send({ name: '' })).status).toBe(400)
  })
})

describe('trash, restore and permanent delete', () => {
  it('DELETE /files/:id sends the file to the trash instead of deleting it', async () => {
    const { owner, account } = await setup()
    const file = await createFile(owner.user.id, account.id)

    const res = await api().delete(`/files/${file.id}`).set(owner.auth)

    expect(res.status).toBe(200)
    const stored = await prisma.file.findUniqueOrThrow({ where: { id: file.id } })
    expect(stored.status).toBe('deleted')
    expect(stored.deletedAt).not.toBeNull()
    expect(fakeDrive.files.delete).not.toHaveBeenCalled()
    expect((await api().get('/files/trash').set(owner.auth)).body.files.map((item: { id: string }) => item.id)).toEqual([file.id])
  })

  it('DELETE /files/batch trashes only the caller\'s active files and counts them', async () => {
    const { owner, account } = await setup()
    const stranger = await createUser()
    const strangerAccount = await createAccount(stranger.user.id)
    const mine = await createFile(owner.user.id, account.id)
    const theirs = await createFile(stranger.user.id, strangerAccount.id)

    const res = await api().delete('/files/batch').set(owner.auth).send({ fileIds: [mine.id, theirs.id] })

    expect(res.body).toEqual({ status: 'ok', deleted: 1 })
    expect((await prisma.file.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe('active')
  })

  it('restoring clears the sync flag so the next sync cannot trash it again silently', async () => {
    const { owner, account } = await setup()
    const file = await createFile(owner.user.id, account.id, { status: 'deleted', deletedBySync: true })

    const res = await api().post('/files/batch/restore').set(owner.auth).send({ fileIds: [file.id] })

    expect(res.body).toEqual({ status: 'ok', restored: 1 })
    const stored = await prisma.file.findUniqueOrThrow({ where: { id: file.id } })
    expect(stored).toMatchObject({ status: 'active', deletedAt: null, deletedBySync: false })
  })

  it('restoring a file whose folder was deleted puts it at the root', async () => {
    const { owner, account } = await setup()
    const folder = await createFolder(owner.user.id)
    const file = await createFile(owner.user.id, account.id, { folderId: folder.id, status: 'deleted' })
    await prisma.folder.update({ where: { id: folder.id }, data: { deletedAt: new Date() } })

    await api().post('/files/batch/restore').set(owner.auth).send({ fileIds: [file.id] })

    expect((await prisma.file.findUniqueOrThrow({ where: { id: file.id } })).folderId).toBeNull()
  })

  it('restoring keeps the folder when it is still alive', async () => {
    const { owner, account } = await setup()
    const folder = await createFolder(owner.user.id)
    const file = await createFile(owner.user.id, account.id, { folderId: folder.id, status: 'deleted' })

    await api().post('/files/batch/restore').set(owner.auth).send({ fileIds: [file.id] })

    expect((await prisma.file.findUniqueOrThrow({ where: { id: file.id } })).folderId).toBe(folder.id)
  })

  it('permanent delete removes the file from Drive and from the database', async () => {
    const { owner, account } = await setup()
    const file = await createFile(owner.user.id, account.id, { status: 'deleted' })

    const res = await api().delete('/files/batch/permanent').set(owner.auth).send({ fileIds: [file.id] })

    expect(res.body).toMatchObject({ status: 'ok', deleted: 1, failed: [] })
    expect(fakeDrive.files.delete).toHaveBeenCalledWith({ fileId: file.providerFileId })
    expect(await prisma.file.count()).toBe(0)
  })

  it('permanent delete treats a file already gone from Drive as deleted', async () => {
    const { owner, account } = await setup()
    const file = await createFile(owner.user.id, account.id, { status: 'deleted' })
    fakeDrive.files.delete.mockRejectedValue(providerNotFound())

    const res = await api().delete('/files/batch/permanent').set(owner.auth).send({ fileIds: [file.id] })

    expect(res.status).toBe(200)
    expect(res.body.deleted).toBe(1)
    expect(await prisma.file.count()).toBe(0)
  })

  it('permanent delete keeps the row and answers 400 FILES_DELETE_FAILED when Drive fails', async () => {
    const { owner, account } = await setup()
    const file = await createFile(owner.user.id, account.id, { status: 'deleted' })
    fakeDrive.files.delete.mockRejectedValue(new Error('Drive down: /internal/detail'))

    const res = await api().delete('/files/batch/permanent').set(owner.auth).send({ fileIds: [file.id] })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('FILES_DELETE_FAILED')
    expect(res.body.failed).toEqual([{ fileId: file.id, message: 'Delete failed.' }])
    expect(JSON.stringify(res.body)).not.toContain('internal')
    expect(await prisma.file.count()).toBe(1)
  })

  it('permanent delete only reaches files that are in the trash', async () => {
    const { owner, account } = await setup()
    const active = await createFile(owner.user.id, account.id)

    const res = await api().delete('/files/batch/permanent').set(owner.auth).send({ fileIds: [active.id] })

    expect(res.body.deleted).toBe(0)
    expect(fakeDrive.files.delete).not.toHaveBeenCalled()
    expect(await prisma.file.count()).toBe(1)
  })
})

describe('sharing', () => {
  it('creates a share link, reuses it on the next call, and lists it', async () => {
    const { owner, account } = await setup()
    const file = await createFile(owner.user.id, account.id)

    const first = await api().post(`/files/${file.id}/share`).set(owner.auth)
    const second = await api().post(`/files/${file.id}/share`).set(owner.auth)

    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    expect(second.body.url).toBe(first.body.url)
    expect(second.body.shareId).toBe(first.body.shareId)
    expect(await prisma.fileShare.count()).toBe(1)
    const listed = await api().get('/files/shared-links').set(owner.auth)
    expect(listed.body.shares).toHaveLength(1)
    expect(listed.body.shares[0].url).toBe(first.body.url)
  })

  it('stores the share token sealed and looks it up by hash only', async () => {
    const { owner, account } = await setup()
    const file = await createFile(owner.user.id, account.id)

    const res = await api().post(`/files/${file.id}/share`).set(owner.auth)

    const rawToken = (res.body.url as string).split('/').pop() as string
    const stored = await prisma.fileShare.findFirstOrThrow()
    expect(stored.token).not.toBe(rawToken)
    expect(stored.token).not.toContain(rawToken)
    expect(stored.tokenHash).toBe(hashToken(rawToken))
  })

  it('refuses to share a trashed file', async () => {
    const { owner, account } = await setup()
    const file = await createFile(owner.user.id, account.id, { status: 'deleted' })
    expect((await api().post(`/files/${file.id}/share`).set(owner.auth)).status).toBe(404)
    expect(await prisma.fileShare.count()).toBe(0)
  })

  it('disabling the share removes it from the list and from the public route', async () => {
    const { owner, account } = await setup()
    const file = await createFile(owner.user.id, account.id)
    const shared = await api().post(`/files/${file.id}/share`).set(owner.auth)
    const rawToken = (shared.body.url as string).split('/').pop() as string

    await api().delete(`/files/${file.id}/share`).set(owner.auth)

    expect((await api().get('/files/shared-links').set(owner.auth)).body.shares).toEqual([])
    expect((await api().get(`/public/files/${rawToken}`)).status).toBe(404)
  })

  it('a live share link opens the public file route without authentication', async () => {
    const { owner, account } = await setup()
    const file = await createFile(owner.user.id, account.id, { name: 'public.txt' })
    const shared = await api().post(`/files/${file.id}/share`).set(owner.auth)
    const rawToken = (shared.body.url as string).split('/').pop() as string

    const res = await api().get(`/public/files/${rawToken}`)

    expect(res.status).toBe(200)
    expect(JSON.stringify(res.body)).toContain('public.txt')
  })
})

describe('preview tokens, view-url and public-permission', () => {
  it('issues a preview token for an active file and never for a trashed one', async () => {
    const { owner, account } = await setup()
    const active = await createFile(owner.user.id, account.id)
    const trashed = await createFile(owner.user.id, account.id, { status: 'deleted' })

    const ok = await api().post(`/files/${active.id}/preview-token`).set(owner.auth)
    const refused = await api().post(`/files/${trashed.id}/preview-token`).set(owner.auth)

    expect(ok.status).toBe(201)
    expect(ok.body.path).toMatch(/^\/files\/preview\//)
    expect(refused.status).toBe(404)
  })

  it('an unknown or expired preview token answers 404 PREVIEW_NOT_FOUND', async () => {
    const { owner, account } = await setup()
    const file = await createFile(owner.user.id, account.id)
    await prisma.filePreviewToken.create({ data: { fileId: file.id, userId: owner.user.id, tokenHash: hashToken('expired'), expiresAt: new Date(Date.now() - 1000) } })

    const unknown = await api().get('/files/preview/nope')
    const expired = await api().get('/files/preview/expired')

    expect(unknown.status).toBe(404)
    expect(expired.status).toBe(404)
    expect(expired.body.code).toBe('PREVIEW_NOT_FOUND')
  })

  it('view-url returns null while the Drive file is private, and the link once it is public', async () => {
    const { owner, account } = await setup()
    const file = await createFile(owner.user.id, account.id)
    fakeDrive.files.get.mockResolvedValueOnce({ data: { webViewLink: 'https://drive.example/view', permissions: [{ type: 'user' }] } })
    const privateRes = await api().get(`/files/${file.id}/view-url`).set(owner.auth)
    fakeDrive.files.get.mockResolvedValueOnce({ data: { webViewLink: 'https://drive.example/view', permissions: [{ type: 'user' }, { type: 'anyone' }] } })
    const publicRes = await api().get(`/files/${file.id}/view-url`).set(owner.auth)

    expect(privateRes.body).toEqual({ url: null })
    expect(publicRes.body).toEqual({ url: 'https://drive.example/view' })
    expect(fakeDrive.permissions.create).not.toHaveBeenCalled()
  })

  it('view-url never asks Drive for anything on a file from another provider', async () => {
    const { owner } = await setup()
    const onedrive = await createAccount(owner.user.id, { provider: 'onedrive' })
    const file = await createFile(owner.user.id, onedrive.id, { provider: 'onedrive' })

    const res = await api().get(`/files/${file.id}/view-url`).set(owner.auth)

    expect(res.body).toEqual({ url: null })
    expect(fakeDrive.files.get).not.toHaveBeenCalled()
  })

  it('public-permission opens the file as a read only link for anyone, and only for Google files', async () => {
    const { owner, account } = await setup()
    const file = await createFile(owner.user.id, account.id)
    fakeDrive.files.get.mockResolvedValue({ data: { webViewLink: 'https://drive.example/view' } })

    const ok = await api().post(`/files/${file.id}/public-permission`).set(owner.auth)

    expect(ok.body).toEqual({ status: 'ok', url: 'https://drive.example/view' })
    expect(fakeDrive.permissions.create).toHaveBeenCalledWith({ fileId: file.providerFileId, requestBody: { role: 'reader', type: 'anyone' } })

    const s3 = await createAccount(owner.user.id, { provider: 's3' })
    const s3File = await createFile(owner.user.id, s3.id, { provider: 's3' })
    const refused = await api().post(`/files/${s3File.id}/public-permission`).set(owner.auth)
    expect(refused.status).toBe(400)
    expect(refused.body.code).toBe('UNSUPPORTED_PROVIDER')
  })
})

describe('POST /files/batch-download', () => {
  it('answers 404 FILES_NOT_FOUND when none of the files is the caller\'s', async () => {
    const { owner } = await setup()
    const res = await api().post('/files/batch-download').set(owner.auth).send({ fileIds: ['missing'] })
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('FILES_NOT_FOUND')
  })

  // Depending on whether the ZIP header reached the client before the source failed, the route answers 500 or destroys the
  // response so the download fails instead of looking complete. Both are the contract; a 200 or a crash is not.
  it('never reports success, and the process survives, when a source stream fails', async () => {
    const { owner, account } = await setup()
    const file = await createFile(owner.user.id, account.id)
    googleService.getAuthedGoogleClient.mockResolvedValue({ getRequestHeaders: async () => ({}) })
    const broken = new ReadableStream({ pull() { throw new Error('connection reset') } })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(broken, { status: 200 })))
    try {
      const outcome = await api().post('/files/batch-download').set(owner.auth).send({ fileIds: [file.id] })
        .then((res) => ({ status: res.status, code: res.body?.code as string | undefined }), () => 'aborted' as const)

      if (outcome !== 'aborted') expect(outcome).toEqual({ status: 500, code: 'BATCH_DOWNLOAD_FAILED' })
      expect((await api().get('/health')).status).toBe(200)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
