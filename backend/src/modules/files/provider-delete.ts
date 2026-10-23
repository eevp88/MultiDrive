import type { ConnectedAccount, File } from '@prisma/client'
import { google } from 'googleapis'
import { isProviderNotFound } from '../../utils/http-error.js'
import { getAuthedGoogleClient } from '../google/google.service.js'
import { deleteMicrosoftItem } from '../microsoft/microsoft.service.js'
import { deleteS3Object } from '../s3/s3.service.js'

type FileWithAccount = File & { connectedAccount: ConnectedAccount }

// Removes the file from its provider. A file that is already gone counts as deleted, so a trash entry whose remote copy
// disappeared can still be cleared instead of failing forever.
export async function deleteProviderFile(file: FileWithAccount) {
  if (file.provider === 's3') return deleteS3Object(file)
  if (file.provider === 'onedrive') return deleteMicrosoftItem(file.connectedAccount, file.providerFileId)
  const drive = google.drive({ version: 'v3', auth: await getAuthedGoogleClient(file.connectedAccount) })
  await drive.files.delete({ fileId: file.providerFileId }).catch((error) => {
    if (!isProviderNotFound(error)) throw error
  })
}
