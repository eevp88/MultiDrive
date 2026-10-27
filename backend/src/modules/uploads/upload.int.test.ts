import { describe, expect, it } from 'vitest'
import { prisma } from '../../config/prisma.js'
import { api, createAccount, createFolder, createUser } from '../../test/helpers.js'
import { fakeDrive } from '../../test/fakes.js'

async function setup(options: { availableBytes?: bigint | null } = {}) {
  const owner = await createUser()
  const account = await createAccount(owner.user.id)
  // A fresh quota snapshot, so the route does not try to sync it from Google first.
  // Created up front on purpose: `selectAccount` upserts this row, and two files of a user's first batch upload do it at the
  // same time, so one of them fails with a unique violation (found by T2, recorded in odd/tasks/test-suite.md L4).
  await prisma.uploadRoutingPolicy.create({ data: { userId: owner.user.id, mode: 'most_available', priorityAccountIds: [] } })
  await prisma.storageAccount.create({ data: { connectedAccountId: account.id, usedBytes: 0n, totalBytes: 1_000_000n, availableBytes: options.availableBytes === undefined ? 1_000_000n : options.availableBytes, lastSyncedAt: new Date() } })
  return { owner, account }
}

const meta = (items: Array<Record<string, unknown>>) => JSON.stringify(items)

describe('POST /uploads', () => {
  it('requires authentication', async () => {
    expect((await api().post('/uploads').field('x', 'y')).status).toBe(401)
  })

  it('rejects a request that is not multipart with 400 UPLOAD_INVALID_CONTENT_TYPE', async () => {
    const { owner } = await setup()
    const res = await api().post('/uploads').set(owner.auth).send({ nope: true })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('UPLOAD_INVALID_CONTENT_TYPE')
  })

  it('answers 400 UPLOAD_FILE_REQUIRED when no file part is sent', async () => {
    const { owner } = await setup()
    const res = await api().post('/uploads').set(owner.auth).field('sizeBytes', '5')
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('UPLOAD_FILE_REQUIRED')
  })

  it('streams one file to Drive, records it, and answers 201 with the file', async () => {
    const { owner, account } = await setup()
    fakeDrive.files.create.mockResolvedValue({ data: { id: 'drive-1', name: 'hello.txt', mimeType: 'text/plain' } })

    const res = await api().post('/uploads').set(owner.auth)
      .field('sizeBytes', '5').field('fileName', 'hello.txt').field('mimeType', 'text/plain')
      .attach('file', Buffer.from('hello'), 'hello.txt')

    expect(res.status).toBe(201)
    expect(res.body.file).toMatchObject({ name: 'hello.txt', providerFileId: 'drive-1', sizeBytes: '5', connectedAccountId: account.id })
    const stored = await prisma.file.findFirstOrThrow()
    expect(stored).toMatchObject({ userId: owner.user.id, provider: 'google_drive', status: 'active' })
    expect(await prisma.uploadSession.findFirstOrThrow()).toMatchObject({ status: 'completed' })
  })

  it('accepts a batch declared in filesMeta and answers { files, failed }', async () => {
    const { owner } = await setup()
    fakeDrive.files.create
      .mockResolvedValueOnce({ data: { id: 'drive-a', name: 'a.txt', mimeType: 'text/plain' } })
      .mockResolvedValueOnce({ data: { id: 'drive-b', name: 'b.txt', mimeType: 'text/plain' } })

    const res = await api().post('/uploads').set(owner.auth)
      .field('filesMeta', meta([
        { fieldName: 'file-0', fileName: 'a.txt', mimeType: 'text/plain', sizeBytes: '1' },
        { fieldName: 'file-1', fileName: 'b.txt', mimeType: 'text/plain', sizeBytes: 2 },
      ]))
      .attach('file-0', Buffer.from('a'), 'a.txt')
      .attach('file-1', Buffer.from('bb'), 'b.txt')

    expect(res.status).toBe(201)
    expect(res.body.files).toHaveLength(2)
    expect(res.body.failed).toEqual([])
    expect(await prisma.file.count()).toBe(2)
  })

  it('places the file under the folder\'s Drive id', async () => {
    const { owner, account } = await setup()
    const folder = await createFolder(owner.user.id, { connectedAccountId: account.id, providerFolderId: 'drive-folder' })

    const res = await api().post('/uploads').set(owner.auth)
      .field('filesMeta', meta([{ fieldName: 'file-0', fileName: 'a.txt', mimeType: 'text/plain', sizeBytes: '1', folderId: folder.id }]))
      .attach('file-0', Buffer.from('a'), 'a.txt')

    expect(res.status).toBe(201)
    expect(fakeDrive.files.create).toHaveBeenCalledWith(expect.objectContaining({ requestBody: { name: 'a.txt', parents: ['drive-folder'] } }))
    expect((await prisma.file.findFirstOrThrow()).folderId).toBe(folder.id)
  })

  it.each([
    ['a fractional sizeBytes', '1.5'],
    ['a negative sizeBytes', '-3'],
    ['a text sizeBytes', 'big'],
    ['an absurdly long sizeBytes', '9'.repeat(40)],
  ])('answers 400 UPLOAD_MALFORMED for %s and uploads nothing', async (_label, sizeBytes) => {
    const { owner } = await setup()

    const res = await api().post('/uploads').set(owner.auth).field('sizeBytes', sizeBytes).attach('file', Buffer.from('hello'), 'hello.txt')

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('UPLOAD_MALFORMED')
    expect(fakeDrive.files.create).not.toHaveBeenCalled()
    expect(await prisma.file.count()).toBe(0)
  })

  it.each([
    ['filesMeta that is not JSON', 'not json'],
    ['filesMeta that is not an array', '{"a":1}'],
    ['a filesMeta item with a bad size', meta([{ fieldName: 'file-0', fileName: 'a', mimeType: 'text/plain', sizeBytes: '1.5' }])],
    ['more than 25 items', meta(Array.from({ length: 26 }, (_, index) => ({ fieldName: `f${index}`, fileName: 'a', mimeType: 'text/plain', sizeBytes: '1' })))],
  ])('answers 400 UPLOAD_MALFORMED for %s', async (_label, filesMeta) => {
    const { owner } = await setup()

    const res = await api().post('/uploads').set(owner.auth).field('filesMeta', filesMeta).attach('file-0', Buffer.from('a'), 'a.txt')

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('UPLOAD_MALFORMED')
    expect(fakeDrive.files.create).not.toHaveBeenCalled()
  })

  it('answers 400 UPLOAD_SIZE_REQUIRED when the size was not declared before the file', async () => {
    const { owner } = await setup()

    const res = await api().post('/uploads').set(owner.auth).attach('file', Buffer.from('hello'), 'hello.txt')

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('UPLOAD_SIZE_REQUIRED')
    expect(await prisma.file.count()).toBe(0)
  })

  it('rejects a file whose bytes do not match the declared size with UPLOAD_SIZE_MISMATCH and records no file', async () => {
    const { owner } = await setup()

    const res = await api().post('/uploads').set(owner.auth).field('sizeBytes', '99').attach('file', Buffer.from('hello'), 'hello.txt')

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('UPLOAD_SIZE_MISMATCH')
    expect(await prisma.file.count()).toBe(0)
    expect(await prisma.uploadSession.findFirstOrThrow()).toMatchObject({ status: 'failed' })
  })

  it('answers 400 NO_ACCOUNT_WITH_ENOUGH_SPACE when no account has room', async () => {
    const { owner } = await setup({ availableBytes: 2n })

    const res = await api().post('/uploads').set(owner.auth).field('sizeBytes', '5').attach('file', Buffer.from('hello'), 'hello.txt')

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('NO_ACCOUNT_WITH_ENOUGH_SPACE')
    expect(fakeDrive.files.create).not.toHaveBeenCalled()
  })

  it('answers 404 FOLDER_NOT_FOUND for a folder that is not the caller\'s', async () => {
    const { owner } = await setup()
    const stranger = await createUser()
    const foreign = await createFolder(stranger.user.id)

    const res = await api().post('/uploads').set(owner.auth)
      .field('filesMeta', meta([{ fieldName: 'file-0', fileName: 'a.txt', mimeType: 'text/plain', sizeBytes: '1', folderId: foreign.id }]))
      .attach('file-0', Buffer.from('a'), 'a.txt')

    expect(res.status).toBe(400)
    expect(res.body.failed[0].code).toBe('FOLDER_NOT_FOUND')
    expect(await prisma.file.count()).toBe(0)
  })

  it('reports a Drive failure as UPLOAD_FAILED without leaking the provider message', async () => {
    const { owner } = await setup()
    fakeDrive.files.create.mockRejectedValue(new Error('Drive exploded at /srv/internal/path'))

    const res = await api().post('/uploads').set(owner.auth).field('sizeBytes', '5').attach('file', Buffer.from('hello'), 'hello.txt')

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('UPLOAD_FAILED')
    expect(JSON.stringify(res.body)).not.toContain('internal')
    expect(await prisma.file.count()).toBe(0)
  })

  it('keeps the good files of a batch when one fails', async () => {
    const { owner } = await setup()
    fakeDrive.files.create.mockResolvedValue({ data: { id: 'drive-ok', name: 'ok.txt', mimeType: 'text/plain' } })

    const res = await api().post('/uploads').set(owner.auth)
      .field('filesMeta', meta([
        { fieldName: 'file-0', fileName: 'ok.txt', mimeType: 'text/plain', sizeBytes: '2' },
        { fieldName: 'file-1', fileName: 'liar.txt', mimeType: 'text/plain', sizeBytes: '99' },
      ]))
      .attach('file-0', Buffer.from('ok'), 'ok.txt')
      .attach('file-1', Buffer.from('short'), 'liar.txt')

    expect(res.status).toBe(201)
    expect(res.body.files).toHaveLength(1)
    expect(res.body.failed).toEqual([expect.objectContaining({ fileName: 'liar.txt', code: 'UPLOAD_SIZE_MISMATCH' })])
    expect(await prisma.file.count()).toBe(1)
  })
})
