import { Prisma } from '@prisma/client'

// An error whose message is meant for the client. The global error handler echoes only these (and validation errors);
// anything else is answered with a generic 500 because its message can carry internals such as file paths or database hosts.
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

// The message to show a client for an arbitrary caught error. Only errors made for the client carry a safe one.
export function clientMessage(error: unknown, fallback: string) {
  return error instanceof HttpError ? error.message : fallback
}

// What to write in the server log for an arbitrary caught error. Prisma messages embed query arguments and source
// paths, so only their code is kept; other messages are logged truncated, server-side only.
export function describeError(error: unknown) {
  if (!(error instanceof Error)) return 'unknown error'
  if (error instanceof Prisma.PrismaClientKnownRequestError) return `${error.name} ${error.code}`
  if (error.name.startsWith('PrismaClient')) return error.name
  return `${error.name} ${error.message.slice(0, 300)}`.trim()
}
