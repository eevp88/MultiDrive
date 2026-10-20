import type { NextFunction, Response } from 'express'
import { google } from 'googleapis'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import type { AuthRequest } from '../../middleware/auth.middleware.js'
import { HttpError } from '../../utils/http-error.js'
import { getAuthedGoogleClient } from '../google/google.service.js'

const querySchema = z.object({ size: z.coerce.number().int().min(32).max(2048).default(320) })

// Drive thumbnail links are signed URLs: anyone holding one can fetch the image until it expires. The link is therefore only
// used here, server side, and never sent to the client; the browser gets the image bytes through this authenticated route.
function thumbnailUrl(link: string, size: number) {
  const url = new URL(link)
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.googleusercontent.com')) throw new HttpError(502, 'GOOGLE_API_ERROR', 'Google Drive returned an unexpected thumbnail address.')
  return /=s\d+/.test(url.href) ? url.href.replace(/=s\d+/, `=s${size}`) : `${url.href}=s${size}`
}

// GET /files/:id/thumbnail?size=320. Google files only; Drive converts formats browsers cannot show (such as HEIF) to JPEG.
export async function thumbnailHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { size } = querySchema.parse(req.query)
    const file = await prisma.file.findFirstOrThrow({ where: { id: String(req.params.id), userId: req.user!.id, status: 'active' }, include: { connectedAccount: true } })
    if (file.provider !== 'google_drive') throw new HttpError(404, 'THUMBNAIL_UNAVAILABLE', 'No thumbnail for this file.')

    const drive = google.drive({ version: 'v3', auth: await getAuthedGoogleClient(file.connectedAccount) })
    // A file deleted in Drive stays in the database until the next sync; that is a missing thumbnail, not a server error.
    const metadata = await drive.files.get({ fileId: file.providerFileId, fields: 'thumbnailLink' }).catch((error: { code?: number | string; status?: number }) => {
      if (error.code === 404 || error.status === 404) throw new HttpError(404, 'THUMBNAIL_UNAVAILABLE', 'No thumbnail for this file.')
      throw error
    })
    if (!metadata.data.thumbnailLink) throw new HttpError(404, 'THUMBNAIL_UNAVAILABLE', 'No thumbnail for this file.')

    const upstream = await fetch(thumbnailUrl(metadata.data.thumbnailLink, size), { signal: AbortSignal.timeout(15_000) })
    const contentType = upstream.headers.get('content-type') ?? ''
    if (!upstream.ok || !upstream.body || !contentType.startsWith('image/')) throw new HttpError(502, 'GOOGLE_API_ERROR', 'Google Drive could not provide the thumbnail.')

    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    const length = upstream.headers.get('content-length')
    if (length) res.setHeader('Content-Length', length)
    // pipeline attaches the error handlers; a client that goes away mid-transfer rejects it, which is not worth reporting.
    await pipeline(Readable.fromWeb(upstream.body as unknown as WebReadableStream<Uint8Array>), res).catch(() => undefined)
  } catch (error) {
    return next(error)
  }
}
