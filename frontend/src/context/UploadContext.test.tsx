import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/I18nProvider'
import { UploadProvider, useUpload } from './UploadContext'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider><UploadProvider>{children}</UploadProvider></I18nProvider>
const file = (name: string, content = '0123456789') => new File([content], name, { type: 'text/plain' })

type Route = (url: string, init: RequestInit) => Response | Promise<Response>
let route: Route
let fetchMock: ReturnType<typeof vi.fn>
let completedEvents: number
const countCompleted = () => { completedEvents += 1 }

// A request that stays open until the test aborts it, like a slow upload.
const hangUntilAborted: Route = (_url, init) => new Promise((_resolve, reject) => {
  init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
})

beforeEach(() => {
  localStorage.setItem('multidrive.language', 'en')
  completedEvents = 0
  window.addEventListener('multidrive:upload-completed', countCompleted)
  route = () => json({})
  fetchMock = vi.fn((url: string, init: RequestInit) => Promise.resolve(route(url, init)))
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  window.removeEventListener('multidrive:upload-completed', countCompleted)
  vi.unstubAllGlobals()
})

const urls = () => fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit).method ?? 'GET'} ${String(url).replace('http://api.test', '')}`)

describe('uploadFiles', () => {
  it('registers the upload, sends the bytes and ends with a finished panel', async () => {
    route = (url) => (url.endsWith('/uploads/resumable/init') ? json({ sessionId: 's1', provider: 'google_drive' }) : json({ status: 'completed' }))
    const { result } = renderHook(() => useUpload(), { wrapper })

    await act(() => result.current.uploadFiles([file('a.txt')], 'folder-1', 'account-1'))

    expect(urls()).toEqual(['POST /uploads/resumable/init', 'PUT /uploads/resumable/chunk/s1'])
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ fileName: 'a.txt', mimeType: 'text/plain', sizeBytes: '10', folderId: 'folder-1', targetAccountId: 'account-1' })
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get('Content-Range')).toBe('bytes 0-9/10')
    expect(result.current.uploadProgress).toMatchObject({ open: true, fileName: 'a.txt', percent: 100, status: 'done' })
    expect(result.current.uploadProgress.files).toEqual([expect.objectContaining({ name: 'a.txt', size: 10, percent: 100, status: 'done' })])
    expect(completedEvents).toBe(1)
  })

  it('does nothing for an empty selection', async () => {
    const { result } = renderHook(() => useUpload(), { wrapper })

    await act(() => result.current.uploadFiles([], null))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.uploadProgress.open).toBe(false)
  })

  it('sends no bytes for an empty file, which the init call already created', async () => {
    route = () => json({ sessionId: 's1', provider: 'google_drive', completed: true })
    const { result } = renderHook(() => useUpload(), { wrapper })

    await act(() => result.current.uploadFiles([file('empty.txt', '')], null))

    expect(urls()).toEqual(['POST /uploads/resumable/init'])
    expect(result.current.uploadProgress.status).toBe('done')
  })

  it('names the panel by file count for a batch', async () => {
    route = (url) => (url.endsWith('/init') ? json({ sessionId: 's', provider: 'google_drive' }) : json({ status: 'completed' }))
    const { result } = renderHook(() => useUpload(), { wrapper })

    await act(() => result.current.uploadFiles([file('a.txt'), file('b.txt')], null))

    expect(result.current.uploadProgress.fileName).toBe('2 files')
    expect(result.current.uploadProgress.files.map((item) => item.status)).toEqual(['done', 'done'])
  })

  it('marks a file as error when a chunk is rejected, and the batch as partial when others finished', async () => {
    route = (url, init) => {
      if (url.endsWith('/init')) return json({ sessionId: JSON.parse(init.body as string).fileName, provider: 'google_drive' })
      return url.endsWith('/chunk/bad.txt') ? json({ message: 'no' }, 500) : json({ status: 'completed' })
    }
    const { result } = renderHook(() => useUpload(), { wrapper })

    await act(() => result.current.uploadFiles([file('good.txt'), file('bad.txt')], null))

    expect(result.current.uploadProgress.files.map((item) => item.status)).toEqual(['done', 'error'])
    expect(result.current.uploadProgress.status).toBe('partial')
  })

  it('reports a single failed file as an error and still tells the pages to reload', async () => {
    route = (url) => (url.endsWith('/init') ? json({ sessionId: 's1', provider: 'google_drive' }) : json({}, 500))
    const { result } = renderHook(() => useUpload(), { wrapper })

    await act(() => result.current.uploadFiles([file('a.txt')], null))

    expect(result.current.uploadProgress.status).toBe('error')
    expect(completedEvents).toBe(1)
  })

  it('never shows a file as done when every byte was sent but the server did not confirm', async () => {
    route = (url) => (url.endsWith('/init') ? json({ sessionId: 's1', provider: 'google_drive' }) : json({ status: 'uploading', offset: '10' }))
    const { result } = renderHook(() => useUpload(), { wrapper })

    await act(() => result.current.uploadFiles([file('a.txt')], null))

    expect(result.current.uploadProgress.files[0].status).toBe('error')
  })

  it('sends a large file in 5 MiB chunks with matching Content-Range headers', async () => {
    const size = 5 * 1024 * 1024 + 100
    route = (url, init) => {
      if (url.endsWith('/init')) return json({ sessionId: 's1', provider: 'google_drive' })
      return new Headers(init.headers).get('Content-Range')!.startsWith('bytes 0-') ? json({ status: 'uploading', offset: String(5 * 1024 * 1024) }) : json({ status: 'completed' })
    }
    const { result } = renderHook(() => useUpload(), { wrapper })

    await act(() => result.current.uploadFiles([new File([new Uint8Array(size)], 'big.bin')], null))

    const ranges = fetchMock.mock.calls.filter(([url]) => String(url).includes('/chunk/')).map(([, init]) => new Headers((init as RequestInit).headers).get('Content-Range'))
    expect(ranges).toEqual([`bytes 0-${5 * 1024 * 1024 - 1}/${size}`, `bytes ${5 * 1024 * 1024}-${size - 1}/${size}`])
    expect(result.current.uploadProgress.files[0].status).toBe('done')
  })
})

describe('retryFailedUpload', () => {
  it('resumes a failed upload from the server offset instead of starting over', async () => {
    let chunkCalls = 0
    route = (url) => {
      if (url.endsWith('/init')) return json({ sessionId: 's1', provider: 'google_drive' })
      if (url.includes('/status/')) return json({ status: 'uploading', offset: '4' })
      chunkCalls += 1
      return chunkCalls === 1 ? json({}, 500) : json({ status: 'completed' })
    }
    const { result } = renderHook(() => useUpload(), { wrapper })
    await act(() => result.current.uploadFiles([file('a.txt')], null))
    const id = result.current.uploadProgress.files[0].id
    expect(result.current.uploadProgress.files[0].status).toBe('error')

    await act(() => result.current.retryFailedUpload(id))

    expect(urls()).toEqual(['POST /uploads/resumable/init', 'PUT /uploads/resumable/chunk/s1', 'GET /uploads/resumable/status/s1', 'PUT /uploads/resumable/chunk/s1'])
    expect(new Headers(fetchMock.mock.calls[3][1].headers).get('Content-Range')).toBe('bytes 4-9/10')
    expect(result.current.uploadProgress.files[0].status).toBe('done')
  })

  it('does not fail for an id it does not know', async () => {
    const { result } = renderHook(() => useUpload(), { wrapper })
    await act(() => result.current.retryFailedUpload('upload-nope'))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('cancelUpload', () => {
  it('aborts the running request and marks the file cancelled', async () => {
    route = hangUntilAborted
    const { result } = renderHook(() => useUpload(), { wrapper })
    let finished: Promise<void> = Promise.resolve()
    act(() => { finished = result.current.uploadFiles([file('a.txt')], null) })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())

    act(() => result.current.cancelUpload())
    await act(() => finished)

    expect(result.current.uploadProgress.files[0].status).toBe('cancelled')
    expect(result.current.uploadProgress.status).toBe('cancelled')
  })

  it('cancels a file that is still waiting in the queue without touching the one in progress', async () => {
    route = hangUntilAborted
    const { result } = renderHook(() => useUpload(), { wrapper })
    let finished: Promise<void> = Promise.resolve()
    act(() => { finished = result.current.uploadFiles([file('first.txt'), file('second.txt')], null) })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const secondId = result.current.uploadProgress.files[1].id

    act(() => result.current.cancelUpload(secondId))

    expect(result.current.uploadProgress.files.map((item) => item.status)).toEqual(['uploading', 'cancelled'])
    act(() => result.current.cancelUpload())
    await act(() => finished)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('a second batch while one is running', () => {
  it('joins the same panel instead of starting over', async () => {
    route = hangUntilAborted
    const { result } = renderHook(() => useUpload(), { wrapper })
    let first: Promise<void> = Promise.resolve()
    act(() => { first = result.current.uploadFiles([file('a.txt')], null) })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())

    await act(() => result.current.uploadFiles([file('b.txt')], null))

    expect(result.current.uploadProgress.files.map((item) => item.name)).toEqual(['a.txt', 'b.txt'])
    act(() => result.current.cancelUpload())
    await act(() => first)
  })
})

describe('useUpload', () => {
  it('throws outside the provider', () => {
    expect(() => renderHook(() => useUpload())).toThrow('useUpload must be used within an UploadProvider')
  })
})
