import { Prisma } from '@prisma/client'
import type { Request, Response } from 'express'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { HttpError } from '../utils/http-error.js'
import { errorMiddleware } from './error.middleware.js'

function run(error: unknown) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  errorMiddleware(error, {} as Request, res as unknown as Response, vi.fn())
  return { status: res.status.mock.calls[0]?.[0] as number, body: res.json.mock.calls[0]?.[0] as { code: string; message: string } }
}

describe('errorMiddleware', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined))
  afterEach(() => vi.restoreAllMocks())

  it('maps validation errors to 400 with the failing paths', () => {
    const result = z.object({ size: z.number() }).safeParse({ size: 'x' })
    const { status, body } = run((result as { error: unknown }).error)
    expect(status).toBe(400)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(body.message).toContain('size')
  })

  it('answers an HttpError with its own status, code and message', () => {
    expect(run(new HttpError(409, 'ACCOUNT_RECONNECT_REQUIRED', 'Reconnect.'))).toEqual({
      status: 409,
      body: { code: 'ACCOUNT_RECONNECT_REQUIRED', message: 'Reconnect.' },
    })
  })

  it('maps Prisma not found and unique violations', () => {
    const notFound = new Prisma.PrismaClientKnownRequestError('x', { code: 'P2025', clientVersion: 't' })
    const unique = new Prisma.PrismaClientKnownRequestError('x', { code: 'P2002', clientVersion: 't' })
    expect(run(notFound)).toEqual({ status: 404, body: { code: 'NOT_FOUND', message: 'Resource not found.' } })
    expect(run(unique)).toEqual({ status: 409, body: { code: 'CONFLICT', message: 'Resource already exists.' } })
  })

  it('passes through body-parser errors that are safe to expose', () => {
    expect(run({ status: 413, expose: true, message: 'request entity too large' })).toEqual({
      status: 413,
      body: { code: 'PAYLOAD_TOO_LARGE', message: 'request entity too large' },
    })
    expect(run({ status: 400, expose: true, message: 'Unexpected token' }).body.code).toBe('BAD_REQUEST')
  })

  it('does not expose a 4xx that is not marked safe', () => {
    expect(run({ status: 400, expose: false, message: 'internal detail' }).status).toBe(500)
  })

  it('hides everything else behind a generic 500', () => {
    const { status, body } = run(new Error('connect ECONNREFUSED 10.0.0.5:3306 /srv/app/db.js'))
    expect(status).toBe(500)
    expect(body).toEqual({ code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error.' })
    expect(JSON.stringify(body)).not.toContain('10.0.0.5')
  })

  it('also answers 500 for an unknown Prisma code', () => {
    const other = new Prisma.PrismaClientKnownRequestError('x', { code: 'P2034', clientVersion: 't' })
    expect(run(other).status).toBe(500)
  })
})
