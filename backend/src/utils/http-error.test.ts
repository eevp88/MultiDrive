import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { HttpError, clientMessage, describeError, isProviderNotFound } from './http-error.js'

describe('HttpError', () => {
  it('carries status, code and message', () => {
    const error = new HttpError(409, 'ACCOUNT_RECONNECT_REQUIRED', 'Reconnect the account.')
    expect(error).toBeInstanceOf(Error)
    expect(error.status).toBe(409)
    expect(error.code).toBe('ACCOUNT_RECONNECT_REQUIRED')
    expect(error.message).toBe('Reconnect the account.')
    expect(error.name).toBe('HttpError')
  })
})

describe('clientMessage', () => {
  it('shows the message of an HttpError', () => {
    expect(clientMessage(new HttpError(400, 'X', 'Safe message.'), 'fallback')).toBe('Safe message.')
  })

  it('never leaks the message of any other error', () => {
    expect(clientMessage(new Error('ENOENT /srv/app/secret/path'), 'fallback')).toBe('fallback')
    expect(clientMessage('boom', 'fallback')).toBe('fallback')
    expect(clientMessage(null, 'fallback')).toBe('fallback')
  })
})

describe('isProviderNotFound', () => {
  it('recognises a 404 in the three shapes providers use', () => {
    expect(isProviderNotFound({ code: 404 })).toBe(true)
    expect(isProviderNotFound({ status: 404 })).toBe(true)
    expect(isProviderNotFound({ response: { status: 404 } })).toBe(true)
  })

  it('does not treat other failures as not found', () => {
    expect(isProviderNotFound({ code: 500 })).toBe(false)
    expect(isProviderNotFound({ status: 403 })).toBe(false)
    expect(isProviderNotFound({ code: '404' })).toBe(false)
    expect(isProviderNotFound(new Error('404'))).toBe(false)
  })

  it('tolerates null and primitives', () => {
    expect(isProviderNotFound(null)).toBe(false)
    expect(isProviderNotFound(undefined)).toBe(false)
    expect(isProviderNotFound('404')).toBe(false)
  })
})

describe('describeError', () => {
  it('keeps only the code of a Prisma error, because its message embeds query arguments', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Invalid `prisma.user.findMany()` invocation: email = "a@b.c"', {
      code: 'P2002',
      clientVersion: 'test',
    })
    const text = describeError(error)
    expect(text).toBe('PrismaClientKnownRequestError P2002')
    expect(text).not.toContain('a@b.c')
  })

  it('keeps only the name of other Prisma errors', () => {
    const error = new Prisma.PrismaClientInitializationError('Can not reach database at db.internal:3306', 'test')
    expect(describeError(error)).toBe('PrismaClientInitializationError')
  })

  it('truncates the message of a regular error', () => {
    const text = describeError(new Error('x'.repeat(1000)))
    expect(text.startsWith('Error ')).toBe(true)
    expect(text.length).toBeLessThanOrEqual('Error '.length + 300)
  })

  it('does not throw for values that are not errors', () => {
    expect(describeError('boom')).toBe('unknown error')
    expect(describeError(undefined)).toBe('unknown error')
  })
})
