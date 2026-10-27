import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { app } from '../app.js'
import { prisma } from '../config/prisma.js'
import { hashPassword } from '../utils/password.js'
import { signAccessToken } from '../utils/jwt.js'

export const api = () => request(app)

// A user with a live session, built straight in the database so tests do not spend the register rate limit.
export async function createUser(overrides: { email?: string; name?: string; password?: string } = {}) {
  const user = await prisma.user.create({
    data: {
      name: overrides.name ?? 'Test User',
      email: overrides.email ?? `user-${randomUUID()}@example.test`,
      passwordHash: await hashPassword(overrides.password ?? 'correct horse battery'),
    },
  })
  const session = await prisma.userSession.create({ data: { userId: user.id, refreshTokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600_000) } })
  const accessToken = signAccessToken({ sub: user.id, sid: session.id })
  return { user, session, accessToken, auth: { Authorization: `Bearer ${accessToken}` } }
}

export async function createAccount(userId: string, overrides: { provider?: string; email?: string } = {}) {
  return prisma.connectedAccount.create({
    data: {
      userId,
      provider: overrides.provider ?? 'google_drive',
      providerAccountId: randomUUID(),
      email: overrides.email ?? `drive-${randomUUID()}@example.test`,
      scopes: [],
      status: 'connected',
    },
  })
}

export async function createFolder(userId: string, overrides: { name?: string; parentId?: string | null; connectedAccountId?: string | null; providerFolderId?: string | null } = {}) {
  return prisma.folder.create({
    data: { userId, name: overrides.name ?? 'Folder', parentId: overrides.parentId ?? null, connectedAccountId: overrides.connectedAccountId ?? null, providerFolderId: overrides.providerFolderId ?? null },
  })
}

export async function createFile(userId: string, connectedAccountId: string, overrides: { name?: string; folderId?: string | null; mimeType?: string; sizeBytes?: bigint; status?: string; deletedBySync?: boolean; provider?: string } = {}) {
  return prisma.file.create({
    data: {
      userId,
      connectedAccountId,
      provider: overrides.provider ?? 'google_drive',
      providerFileId: `remote-${randomUUID()}`,
      name: overrides.name ?? 'file.txt',
      mimeType: overrides.mimeType ?? 'text/plain',
      sizeBytes: overrides.sizeBytes ?? 10n,
      folderId: overrides.folderId ?? null,
      status: overrides.status ?? 'active',
      deletedAt: overrides.status === 'deleted' ? new Date() : null,
      deletedBySync: overrides.deletedBySync ?? false,
    },
  })
}
