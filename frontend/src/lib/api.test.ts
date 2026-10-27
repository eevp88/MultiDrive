import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch, apiFetchBlob, formatBytes } from '@/lib/api'
import { getAccessToken, setAuthSession } from '@/lib/auth'

const user = { id: 'u1', name: 'Ada', email: 'ada@example.test' }
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('formatBytes', () => {
  it.each([
    [null, '--'],
    [undefined, '--'],
    ['abc', '--'],
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1.00 KB'],
    ['1572864', '1.50 MB'],
    [5n * 1024n ** 3n, '5.00 GB'],
    [2 * 1024 ** 5, '2048.00 TB'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatBytes(input as never)).toBe(expected)
  })
})

describe('apiFetch', () => {
  it('sends the bearer token and a JSON content type, and parses the answer', async () => {
    setAuthSession('access-1', 'refresh-1', user)
    fetchMock.mockResolvedValue(json({ ok: true }))

    const result = await apiFetch<{ ok: boolean }>('/files', { method: 'POST', body: JSON.stringify({ a: 1 }) })

    expect(result).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://api.test/files')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer access-1')
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
  })

  it('leaves the content type alone for FormData so the browser can set the boundary', async () => {
    fetchMock.mockResolvedValue(json({}))
    await apiFetch('/uploads', { method: 'POST', body: new FormData() })
    expect(new Headers(fetchMock.mock.calls[0][1].headers).has('Content-Type')).toBe(false)
  })

  it('omits the token when skipAuth is set', async () => {
    setAuthSession('access-1', 'refresh-1', user)
    fetchMock.mockResolvedValue(json({}))
    await apiFetch('/auth/login', { skipAuth: true })
    expect(new Headers(fetchMock.mock.calls[0][1].headers).has('Authorization')).toBe(false)
  })

  it('refreshes the token on 401 and retries the request once with the new one', async () => {
    setAuthSession('expired', 'refresh-1', user)
    fetchMock
      .mockResolvedValueOnce(json({ code: 'AUTH_SESSION_EXPIRED', message: 'expired' }, 401))
      .mockResolvedValueOnce(json({ accessToken: 'fresh' }))
      .mockResolvedValueOnce(json({ files: [] }))

    const result = await apiFetch('/files')

    expect(result).toEqual({ files: [] })
    expect(fetchMock.mock.calls[1][0]).toBe('http://api.test/auth/refresh')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ refreshToken: 'refresh-1' })
    expect(new Headers(fetchMock.mock.calls[2][1].headers).get('Authorization')).toBe('Bearer fresh')
    expect(getAccessToken()).toBe('fresh')
  })

  it('clears the session and throws an ApiError when the refresh fails', async () => {
    setAuthSession('expired', 'refresh-1', user)
    fetchMock
      .mockResolvedValueOnce(json({ code: 'AUTH_SESSION_EXPIRED', message: 'expired' }, 401))
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ code: 'AUTH_SESSION_EXPIRED', message: 'expired' }, 401))

    await expect(apiFetch('/files')).rejects.toMatchObject({ name: 'ApiError', code: 'AUTH_SESSION_EXPIRED' })

    expect(getAccessToken()).toBeNull()
    expect(localStorage.getItem('multidrive.refreshToken')).toBeNull()
  })

  it('does not try to refresh without a refresh token', async () => {
    fetchMock.mockResolvedValue(json({ code: 'AUTH_REQUIRED', message: 'no' }, 401))

    await expect(apiFetch('/files')).rejects.toBeInstanceOf(ApiError)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry forever when the retried request is 401 again', async () => {
    setAuthSession('expired', 'refresh-1', user)
    fetchMock
      .mockResolvedValueOnce(json({ message: 'no' }, 401))
      .mockResolvedValueOnce(json({ accessToken: 'fresh' }))
      .mockResolvedValueOnce(json({ message: 'still no' }, 401))

    await expect(apiFetch('/files')).rejects.toBeInstanceOf(ApiError)

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('never refreshes for a skipAuth request such as a failed login', async () => {
    setAuthSession('access-1', 'refresh-1', user)
    fetchMock.mockResolvedValue(json({ code: 'AUTH_INVALID_CREDENTIALS', message: 'bad' }, 401))

    await expect(apiFetch('/auth/login', { skipAuth: true })).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS', message: 'bad' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the server code and message on a non-401 error and leaves the session alone', async () => {
    setAuthSession('access-1', 'refresh-1', user)
    fetchMock.mockResolvedValue(json({ code: 'FOLDER_NOT_ON_ACCOUNT', message: 'Wrong account.' }, 400))

    await expect(apiFetch('/files/batch')).rejects.toMatchObject({ code: 'FOLDER_NOT_ON_ACCOUNT', message: 'Wrong account.' })

    expect(getAccessToken()).toBe('access-1')
  })

  it('falls back to the status text when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }))
    await expect(apiFetch('/files')).rejects.toMatchObject({ message: 'Bad Gateway', code: undefined })
  })
})

describe('apiFetchBlob', () => {
  it('returns the blob and the file name the server chose', async () => {
    setAuthSession('access-1', 'refresh-1', user)
    fetchMock.mockResolvedValue(new Response('zip-bytes', { status: 200, headers: { 'Content-Disposition': 'attachment; filename="multidrive-download.zip"' } }))

    const { blob, fileName } = await apiFetchBlob('/files/batch-download', { method: 'POST', body: '{}' })

    expect(fileName).toBe('multidrive-download.zip')
    expect(await blob.text()).toBe('zip-bytes')
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer access-1')
  })

  it('refreshes on 401 like apiFetch', async () => {
    setAuthSession('expired', 'refresh-1', user)
    fetchMock
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ accessToken: 'fresh' }))
      .mockResolvedValueOnce(new Response('data', { status: 200 }))

    const { fileName } = await apiFetchBlob('/files/1/download')

    expect(fileName).toBeNull()
    expect(new Headers(fetchMock.mock.calls[2][1].headers).get('Authorization')).toBe('Bearer fresh')
  })

  it('throws an ApiError with the server code on failure', async () => {
    fetchMock.mockResolvedValue(json({ code: 'FILES_NOT_FOUND', message: 'No files found.' }, 404))
    await expect(apiFetchBlob('/files/batch-download')).rejects.toMatchObject({ code: 'FILES_NOT_FOUND' })
  })
})
