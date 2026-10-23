import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Response } from 'express'
import type { ConnectedAccount, File } from '@prisma/client'
import { fetchMicrosoftFileContent } from '../microsoft/microsoft.service.js'
import { contentDisposition, effectiveDisposition } from '../../utils/content-disposition.js'

type FileWithAccount = File & { connectedAccount: ConnectedAccount }
type StreamOptions = { disposition?: 'inline' | 'attachment' }

export async function streamMicrosoftFile(file: FileWithAccount, range: string | undefined, res: Response, options: StreamOptions = {}) {
  // Stop reading from OneDrive as soon as the client goes away.
  const controller = new AbortController()
  res.on('close', () => controller.abort())
  const response = await fetchMicrosoftFileContent(file.connectedAccount, file.providerFileId, range, controller.signal)

  if (!response.ok || !response.body) {
    const status = response.status === 404 || response.status === 416 ? response.status : 502
    return res.status(status).json({ code: 'MICROSOFT_FILE_STREAM_FAILED', message: 'OneDrive could not stream this file.' })
  }

  res.status(response.status)
  res.setHeader('Content-Type', file.mimeType)
  res.setHeader('Accept-Ranges', 'bytes')
  if (options.disposition) res.setHeader('Content-Disposition', contentDisposition(effectiveDisposition(options.disposition, file.mimeType), file.name))
  const contentLength = response.headers.get('content-length')
  const contentRange = response.headers.get('content-range')
  if (contentLength) res.setHeader('Content-Length', contentLength)
  if (contentRange) res.setHeader('Content-Range', contentRange)

  await pipeline(Readable.fromWeb(response.body as any), res).catch(() => undefined)
}
