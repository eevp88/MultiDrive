import type { Response } from 'express'
import type { ConnectedAccount, File } from '@prisma/client'
import { contentDisposition } from '../../utils/content-disposition.js'
import { getAuthedGoogleClient } from '../google/google.service.js'

type FileWithAccount = File & { connectedAccount: ConnectedAccount }
type StreamOptions = { disposition?: 'inline' | 'attachment' }

export const googleDownloadExportMimeTypes: Record<string, { mimeType: string; extension: string }> = {
  'application/vnd.google-apps.document': { mimeType: 'application/pdf', extension: '.pdf' },
  'application/vnd.google-apps.spreadsheet': { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: '.xlsx' },
  'application/vnd.google-apps.presentation': { mimeType: 'application/pdf', extension: '.pdf' },
  'application/vnd.google-apps.drawing': { mimeType: 'image/png', extension: '.png' },
}

const googlePreviewExportMimeTypes: Record<string, { mimeType: string; extension: string }> = {
  ...googleDownloadExportMimeTypes,
  'application/vnd.google-apps.spreadsheet': { mimeType: 'application/pdf', extension: '.pdf' },
}

export { contentDisposition }

export function withExtension(fileName: string, extension: string) {
  return fileName.toLowerCase().endsWith(extension) ? fileName : `${fileName}${extension}`
}

export function normalizeHeaders(headers: Headers | Record<string, string>) {
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  return headers
}


export async function streamGoogleFile(file: FileWithAccount, range: string | undefined, res: Response, options: StreamOptions = {}) {
  const auth = await getAuthedGoogleClient(file.connectedAccount)
  const headers = normalizeHeaders(await auth.getRequestHeaders())
  const exportTarget = (options.disposition === 'inline' ? googlePreviewExportMimeTypes : googleDownloadExportMimeTypes)[file.mimeType]
  const responseMimeType = exportTarget?.mimeType ?? file.mimeType
  const responseFileName = exportTarget ? withExtension(file.name, exportTarget.extension) : file.name
  const url = exportTarget
    ? `https://www.googleapis.com/drive/v3/files/${file.providerFileId}/export?mimeType=${encodeURIComponent(exportTarget.mimeType)}`
    : `https://www.googleapis.com/drive/v3/files/${file.providerFileId}?alt=media`
  const response = await fetch(url, {
    headers: {
      ...headers,
      ...(range && !exportTarget ? { Range: range } : {}),
    },
  })

  if (!response.ok) {
    // Google's body stays in the server log. Its 401 must not reach the client as a 401: the app takes any 401 for its own
    // expired session and would sign the user out.
    const body = await response.text().catch(() => '')
    console.error('Google file stream failed:', response.status, body.slice(0, 300))
    if (response.status === 401) return res.status(409).json({ code: 'ACCOUNT_RECONNECT_REQUIRED', message: 'This Google account needs to be reconnected.' })
    if (response.status === 404) return res.status(404).json({ code: 'GOOGLE_FILE_NOT_FOUND', message: 'The file no longer exists in Google Drive.' })
    if (response.status === 416) return res.status(416).json({ code: 'GOOGLE_FILE_STREAM_FAILED', message: 'Google Drive could not stream that range.' })
    return res.status(502).json({ code: 'GOOGLE_FILE_STREAM_FAILED', message: 'Google Drive could not stream this file.' })
  }

  res.status(response.status)
  res.setHeader('Content-Type', responseMimeType)
  res.setHeader('Accept-Ranges', 'bytes')
  if (options.disposition) res.setHeader('Content-Disposition', contentDisposition(options.disposition, responseFileName))

  const contentLength = response.headers.get('content-length')
  const contentRange = response.headers.get('content-range')
  if (contentLength) res.setHeader('Content-Length', contentLength)
  if (contentRange) res.setHeader('Content-Range', contentRange)

  if (!response.body) {
    res.end()
    return
  }
  const reader = response.body.getReader()
  async function pump(): Promise<void> {
    const { done, value } = await reader.read()
    if (done) {
      res.end()
      return
    }
    res.write(Buffer.from(value))
    return pump()
  }
  return pump()
}
