import type { NextFunction, Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { HttpError, describeError } from '../utils/http-error.js'

// Body-parser errors (malformed JSON, payload too large) carry a 4xx status and a message that is safe to show.
function clientStatus(error: unknown) {
  const { status, expose } = (error ?? {}) as { status?: unknown; expose?: unknown }
  return expose === true && typeof status === 'number' && status >= 400 && status < 500 ? status : null
}

export function errorMiddleware(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    const message = error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ')
    return res.status(400).json({ code: 'VALIDATION_ERROR', message })
  }
  if (error instanceof HttpError) return res.status(error.status).json({ code: error.code, message: error.message })
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2025') return res.status(404).json({ code: 'NOT_FOUND', message: 'Resource not found.' })
    if (error.code === 'P2002') return res.status(409).json({ code: 'CONFLICT', message: 'Resource already exists.' })
  }
  const status = clientStatus(error)
  if (status) return res.status(status).json({ code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST', message: (error as Error).message })

  console.error('Unhandled error:', describeError(error))
  return res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error.' })
}
