import { describe, expect, it } from 'vitest'
import { prisma } from '../../config/prisma.js'
import { api, createAccount, createFile, createFolder, createUser } from '../../test/helpers.js'
import { fakeDrive, providerNotFound } from '../../test/fakes.js'

describe('POST /folders', () => {
  it('creates a database-only folder with defaults when no Drive account is connected', async () => {
    const { user, auth } = await createUser()

    const res = await api().post('/folders').set(auth).send({ name: 'Taxes' })

    expect(res.status).toBe(201)
    expect(res.body.folder).toMatchObject({ name: 'Taxes', parentId: null, providerFolderId: null })
    expect(res.body.folder.color).toMatch(/^#/)
    expect(fakeDrive.files.create).not.toHaveBeenCalled()
    expect(await prisma.folder.count({ where: { userId: user.id } })).toBe(1)
  })

  it('mirrors the folder in Drive under the app folder and stores the Drive id', async () => {
    const { user, auth } = await createUser()
    const account = await createAccount(user.id)
    fakeDrive.files.create.mockResolvedValue({ data: { id: 'drive-folder-1' } })

    const res = await api().post('/folders').set(auth).send({ name: 'Taxes' })

    expect(res.status).toBe(201)
    expect(res.body.folder.providerFolderId).toBe('drive-folder-1')
    expect(fakeDrive.files.create).toHaveBeenCalledWith(expect.objectContaining({ requestBody: { name: 'Taxes', mimeType: 'application/vnd.google-apps.folder', parents: ['app-folder'] } }))
    expect((await prisma.folder.findFirstOrThrow({ where: { userId: user.id } })).connectedAccountId).toBe(account.id)
  })

  it('still creates the folder when Drive fails, leaving the Drive id empty', async () => {
    const { user, auth } = await createUser()
    await createAccount(user.id)
    fakeDrive.files.create.mockRejectedValue(new Error('Drive down'))

    const res = await api().post('/folders').set(auth).send({ name: 'Taxes' })

    expect(res.status).toBe(201)
    expect(res.body.folder.providerFolderId).toBeNull()
  })

  it('nests under the parent in Drive too', async () => {
    const { user, auth } = await createUser()
    const account = await createAccount(user.id)
    const parent = await createFolder(user.id, { connectedAccountId: account.id, providerFolderId: 'drive-parent' })
    fakeDrive.files.create.mockResolvedValue({ data: { id: 'drive-child' } })

    const res = await api().post('/folders').set(auth).send({ name: 'Child', parentId: parent.id })

    expect(res.status).toBe(201)
    expect(fakeDrive.files.create).toHaveBeenCalledWith(expect.objectContaining({ requestBody: expect.objectContaining({ parents: ['drive-parent'] }) }))
  })

  it('refuses a parent that belongs to someone else with 404 and creates nothing', async () => {
    const owner = await createUser()
    const stranger = await createUser()
    const foreign = await createFolder(stranger.user.id)

    const res = await api().post('/folders').set(owner.auth).send({ name: 'Sneaky', parentId: foreign.id })

    expect(res.status).toBe(404)
    expect(await prisma.folder.count({ where: { userId: owner.user.id } })).toBe(0)
  })

  it.each([
    ['an empty name', { name: '' }],
    ['a color that is not a hex or a tailwind class', { name: 'x', color: 'red; background: url(x)' }],
    ['an icon outside the allowed host', { name: 'x', iconUrl: 'https://evil.example/icon.svg' }],
  ])('rejects %s with 400', async (_label, body) => {
    const { auth } = await createUser()
    expect((await api().post('/folders').set(auth).send(body)).status).toBe(400)
  })
})

describe('GET /folders', () => {
  it('lists the children of a parent, root by default, and everything with all=1, only for the caller', async () => {
    const owner = await createUser()
    const stranger = await createUser()
    const root = await createFolder(owner.user.id, { name: 'root' })
    await createFolder(owner.user.id, { name: 'child', parentId: root.id })
    await createFolder(stranger.user.id, { name: 'theirs' })

    const names = async (query: string) => (await api().get(`/folders${query}`).set(owner.auth)).body.folders.map((folder: { name: string }) => folder.name).sort()

    expect(await names('')).toEqual(['root'])
    expect(await names(`?parentId=${root.id}`)).toEqual(['child'])
    expect(await names('?all=1')).toEqual(['child', 'root'])
  })

  it('hides soft-deleted folders', async () => {
    const owner = await createUser()
    const folder = await createFolder(owner.user.id)
    await prisma.folder.update({ where: { id: folder.id }, data: { deletedAt: new Date() } })

    expect((await api().get('/folders?all=1').set(owner.auth)).body.folders).toEqual([])
  })
})

describe('PATCH /folders/:id', () => {
  it('renames the folder', async () => {
    const owner = await createUser()
    const folder = await createFolder(owner.user.id, { name: 'old' })

    const res = await api().patch(`/folders/${folder.id}`).set(owner.auth).send({ name: 'new' })

    expect(res.status).toBe(200)
    expect(res.body.folder.name).toBe('new')
  })

  it('refuses to move a folder into itself or into its own descendant', async () => {
    const owner = await createUser()
    const parent = await createFolder(owner.user.id)
    const child = await createFolder(owner.user.id, { parentId: parent.id })
    const grandchild = await createFolder(owner.user.id, { parentId: child.id })

    const intoSelf = await api().patch(`/folders/${parent.id}`).set(owner.auth).send({ parentId: parent.id })
    const intoDescendant = await api().patch(`/folders/${parent.id}`).set(owner.auth).send({ parentId: grandchild.id })

    expect(intoSelf.body.code).toBe('FOLDER_INVALID_PARENT')
    expect(intoDescendant.status).toBe(400)
    expect(intoDescendant.body.code).toBe('FOLDER_INVALID_PARENT')
    expect((await prisma.folder.findUniqueOrThrow({ where: { id: parent.id } })).parentId).toBeNull()
  })

  it('moves a folder to the root with parentId null', async () => {
    const owner = await createUser()
    const parent = await createFolder(owner.user.id)
    const child = await createFolder(owner.user.id, { parentId: parent.id })

    const res = await api().patch(`/folders/${child.id}`).set(owner.auth).send({ parentId: null })

    expect(res.status).toBe(200)
    expect(res.body.folder.parentId).toBeNull()
  })

  it('answers 404 for someone else\'s folder', async () => {
    const owner = await createUser()
    const stranger = await createUser()
    const foreign = await createFolder(stranger.user.id)
    expect((await api().patch(`/folders/${foreign.id}`).set(owner.auth).send({ name: 'mine now' })).status).toBe(404)
  })
})

describe('DELETE /folders/:id', () => {
  async function tree() {
    const owner = await createUser()
    const account = await createAccount(owner.user.id)
    const root = await createFolder(owner.user.id, { name: 'root', connectedAccountId: account.id, providerFolderId: 'drive-root' })
    const child = await createFolder(owner.user.id, { name: 'child', parentId: root.id, connectedAccountId: account.id, providerFolderId: 'drive-child' })
    const file = await createFile(owner.user.id, account.id, { folderId: child.id })
    return { owner, account, root, child, file }
  }

  it('removes the files and folders from Drive and soft-deletes the folder tree', async () => {
    const { owner, root, child, file } = await tree()

    const res = await api().delete(`/folders/${root.id}`).set(owner.auth)

    expect(res.status).toBe(200)
    expect(fakeDrive.files.delete).toHaveBeenCalledWith({ fileId: file.providerFileId })
    expect(await prisma.file.count()).toBe(0)
    expect((await prisma.folder.findUniqueOrThrow({ where: { id: root.id } })).deletedAt).not.toBeNull()
    expect((await prisma.folder.findUniqueOrThrow({ where: { id: child.id } })).deletedAt).not.toBeNull()
  })

  it('answers 502 FOLDER_DELETE_FAILED and does not mark the folder deleted when Drive cannot remove it', async () => {
    const { owner, root, child } = await tree()
    fakeDrive.files.delete.mockRejectedValue(new Error('Drive down'))

    const res = await api().delete(`/folders/${root.id}`).set(owner.auth)

    expect(res.status).toBe(502)
    expect(res.body.code).toBe('FOLDER_DELETE_FAILED')
    expect((await prisma.folder.findUniqueOrThrow({ where: { id: root.id } })).deletedAt).toBeNull()
    expect((await prisma.folder.findUniqueOrThrow({ where: { id: child.id } })).deletedAt).toBeNull()
  })

  it('sends a file that could not be deleted to the trash, flagged as trashed by the user, not by sync', async () => {
    const { owner, root, file } = await tree()
    fakeDrive.files.delete.mockRejectedValue(new Error('Drive down'))

    await api().delete(`/folders/${root.id}`).set(owner.auth)

    expect(await prisma.file.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({ status: 'deleted', deletedBySync: false })
  })

  it('treats a folder already gone from Drive as deleted', async () => {
    const { owner, root, child } = await tree()
    fakeDrive.files.delete.mockImplementation(async ({ fileId }: { fileId: string }) => {
      if (fileId.startsWith('drive-')) throw providerNotFound()
    })

    const res = await api().delete(`/folders/${root.id}`).set(owner.auth)

    expect(res.status).toBe(200)
    expect((await prisma.folder.findUniqueOrThrow({ where: { id: root.id } })).deletedAt).not.toBeNull()
    expect((await prisma.folder.findUniqueOrThrow({ where: { id: child.id } })).deletedAt).not.toBeNull()
  })

  it('deletes a database-only folder without calling Drive', async () => {
    const owner = await createUser()
    const folder = await createFolder(owner.user.id)

    const res = await api().delete(`/folders/${folder.id}`).set(owner.auth)

    expect(res.status).toBe(200)
    expect(fakeDrive.files.delete).not.toHaveBeenCalled()
    expect((await prisma.folder.findUniqueOrThrow({ where: { id: folder.id } })).deletedAt).not.toBeNull()
  })

  it('answers 404 for someone else\'s folder and leaves it alone', async () => {
    const owner = await createUser()
    const stranger = await createUser()
    const foreign = await createFolder(stranger.user.id)

    expect((await api().delete(`/folders/${foreign.id}`).set(owner.auth)).status).toBe(404)
    expect((await prisma.folder.findUniqueOrThrow({ where: { id: foreign.id } })).deletedAt).toBeNull()
  })
})
