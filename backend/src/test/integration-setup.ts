import { afterAll, beforeEach, vi } from 'vitest'
import { prisma } from '../config/prisma.js'
import { resetFakes } from './fakes.js'

vi.mock('googleapis', async () => {
  const { fakeDrive } = await import('./fakes.js')
  return { google: { drive: () => fakeDrive, oauth2: () => ({}) } }
})
vi.mock('../modules/google/google.service.js', async () => (await import('./fakes.js')).googleService)

// The routes log failures on purpose; the output would bury the test results. TEST_VERBOSE=1 brings it back for debugging.
if (!process.env.TEST_VERBOSE) {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
}

const databaseName = new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\//, '')
if (!/_test$/.test(databaseName)) {
  throw new Error(`Refusing to run integration tests against "${databaseName}": the database name must end in _test.`)
}

// Children before parents, so foreign keys never block a delete. `Cascade` on users would also work, but explicit tables
// keep this honest about what the tests leave behind.
const tables = ['file_preview_tokens', 'file_shares', 'files', 'upload_sessions', 'folders', 'storage_accounts', 'connected_accounts', 'workspace_invites', 'audit_logs', 'auth_handoffs', 'oauth_states', 'provider_configs', 'user_sessions', 'api_keys', 'upload_routing_policies', 's3_storage_configs', 'users']

beforeEach(async () => {
  resetFakes()
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0')
  for (const table of tables) await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``)
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1')
})

afterAll(async () => {
  await prisma.$disconnect()
})
