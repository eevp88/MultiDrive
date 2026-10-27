import { vi } from 'vitest'

// Google is faked at the module boundary (see integration-setup.ts), so no test can reach a real account.
export const fakeDrive = {
  files: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), get: vi.fn() },
  permissions: { create: vi.fn() },
}

export const googleService = {
  createOAuthClient: vi.fn(),
  getAuthedGoogleClient: vi.fn(),
  ensureGoogleAppFolder: vi.fn(),
  moveGoogleFile: vi.fn(),
  syncGoogleQuota: vi.fn(),
  syncGoogleAppFolderFiles: vi.fn(),
}

// Restores the happy path for every call. A test overrides one of them to simulate a provider failure.
export function resetFakes() {
  for (const fn of [...Object.values(fakeDrive.files), fakeDrive.permissions.create, ...Object.values(googleService)]) fn.mockReset()
  googleService.getAuthedGoogleClient.mockResolvedValue({})
  googleService.ensureGoogleAppFolder.mockResolvedValue('app-folder')
  googleService.moveGoogleFile.mockResolvedValue(undefined)
  googleService.syncGoogleQuota.mockResolvedValue(undefined)
  fakeDrive.files.create.mockResolvedValue({ data: { id: 'drive-created', name: 'created', mimeType: 'application/octet-stream' } })
  fakeDrive.files.delete.mockResolvedValue({})
  fakeDrive.files.update.mockResolvedValue({})
}

// What the Google client raises for a missing item.
export function providerNotFound() {
  return Object.assign(new Error('File not found'), { code: 404 })
}
