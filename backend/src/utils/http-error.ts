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
