import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { HttpError } from '../../utils/http-error.js'

export const photosRouter = Router()
photosRouter.use(requireAuth)

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(60),
  cursor: z.string().max(200).optional(),
})

type PhotoRow = {
  id: string
  name: string
  mimeType: string
  sizeBytes: bigint
  provider: string
  connectedAccountId: string
  folderId: string | null
  takenAt: Date | null
  createdAt: Date
  displayDate: Date
}

// The cursor is the sort key of the last row sent: the display date and the id that breaks ties between equal dates.
function encodeCursor(row: PhotoRow) {
  return Buffer.from(JSON.stringify({ d: row.displayDate.toISOString(), id: row.id })).toString('base64url')
}

function decodeCursor(value: string) {
  try {
    const parsed = z.object({ d: z.string().datetime(), id: z.string().min(1).max(36) }).parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
    return { date: new Date(parsed.d), id: parsed.id }
  } catch {
    throw new HttpError(400, 'INVALID_CURSOR', 'Invalid cursor.')
  }
}

// GET /photos?limit=60&cursor=...  Images and videos of the user, newest first. The date is taken_at (from the photo's EXIF
// data, filled by the Drive sync) and falls back to created_at. Sorting on COALESCE cannot use an index, so it scans the
// user's rows; that is fine for a personal library and is the first thing to revisit if it grows large.
photosRouter.get('/', async (req: AuthRequest, res, next) => {
  try {
    const { limit, cursor } = querySchema.parse(req.query)
    const after = cursor ? decodeCursor(cursor) : null
    const afterClause = after
      ? Prisma.sql`AND (COALESCE(taken_at, created_at) < ${after.date} OR (COALESCE(taken_at, created_at) = ${after.date} AND id < ${after.id}))`
      : Prisma.empty

    const rows = await prisma.$queryRaw<PhotoRow[]>(Prisma.sql`
      SELECT id, name, mime_type AS mimeType, size_bytes AS sizeBytes, provider, connected_account_id AS connectedAccountId,
             folder_id AS folderId, taken_at AS takenAt, created_at AS createdAt, COALESCE(taken_at, created_at) AS displayDate
      FROM files
      WHERE user_id = ${req.user!.id} AND status = 'active' AND (mime_type LIKE 'image/%' OR mime_type LIKE 'video/%') ${afterClause}
      ORDER BY displayDate DESC, id DESC
      LIMIT ${limit + 1}`)

    const page = rows.slice(0, limit)
    return res.json({
      files: page.map((row) => ({
        id: row.id,
        name: row.name,
        mimeType: row.mimeType,
        kind: row.mimeType.startsWith('video/') ? 'video' : 'image',
        sizeBytes: row.sizeBytes.toString(),
        provider: row.provider,
        connectedAccountId: row.connectedAccountId,
        folderId: row.folderId,
        takenAt: row.takenAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        displayDate: row.displayDate.toISOString(),
        hasThumbnail: row.provider === 'google_drive' || row.provider === 'onedrive',
      })),
      nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
    })
  } catch (error) {
    return next(error)
  }
})
