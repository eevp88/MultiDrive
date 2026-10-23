import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { API_URL, apiFetch } from '@/lib/api'
import { getAccessToken } from '@/lib/auth'
import { useI18n } from '@/i18n/I18nProvider'

export type UploadProgressStatus = 'queued' | 'uploading' | 'done' | 'error' | 'partial' | 'cancelled'
export type UploadProgressFile = { id: string; name: string; size: number; percent: number; status: UploadProgressStatus }
export type UploadProgressState = { open: boolean; fileName: string; percent: number; status: UploadProgressStatus; files: UploadProgressFile[] }

type UploadItem = { id: string; file: File; folderId: string | null; targetAccountId?: string | null; sessionId?: string }

type UploadContextType = {
  uploadProgress: UploadProgressState
  setUploadProgress: React.Dispatch<React.SetStateAction<UploadProgressState>>
  uploadFiles: (files: File[], folderId: string | null, targetAccountId?: string | null) => Promise<void>
  retryFailedUpload: (id: string) => Promise<void>
  cancelUpload: (id?: string) => void
}

const UploadContext = createContext<UploadContextType | undefined>(undefined)

const CHUNK_SIZE = 5 * 1024 * 1024 // 5MB chunks (must be multiple of 256KB for Google Drive)
let nextUploadId = 0

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

// The panel header: done only when every file finished, otherwise what went wrong.
function overallStatus(files: UploadProgressFile[]): UploadProgressStatus {
  if (files.some((file) => file.status === 'queued' || file.status === 'uploading')) return 'uploading'
  if (files.every((file) => file.status === 'done')) return 'done'
  if (files.every((file) => file.status === 'cancelled')) return 'cancelled'
  if (files.every((file) => file.status === 'error')) return 'error'
  return 'partial'
}

export function UploadProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState>({
    open: false,
    fileName: '',
    percent: 0,
    status: 'uploading',
    files: []
  })
  // Everything the upload loop needs lives in refs so a long upload never reads an outdated copy of the state.
  const queueRef = useRef<UploadItem[]>([])
  const runningRef = useRef(false)
  const itemsRef = useRef(new Map<string, UploadItem>())
  const controllersRef = useRef(new Map<string, AbortController>())

  function updateFile(id: string, patch: Partial<UploadProgressFile>) {
    setUploadProgress((current) => {
      const files = current.files.map((file) => (file.id === id ? { ...file, ...patch } : file))
      const percent = files.length === 0 ? 0 : Math.round(files.reduce((sum, file) => sum + file.percent, 0) / files.length)
      return { ...current, files, percent, status: overallStatus(files) }
    })
  }

  async function uploadSingleFileResumable(item: UploadItem, signal: AbortSignal) {
    const { file, folderId, targetAccountId } = item
    let sessionId = item.sessionId || ''
    let startOffset = 0

    // 1. Initialize or get status
    if (!sessionId) {
      const initData = await apiFetch<{ sessionId: string; provider: string; completed?: boolean }>('/uploads/resumable/init', {
        method: 'POST',
        signal,
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: String(file.size),
          folderId: folderId || undefined,
          targetAccountId: targetAccountId || undefined
        })
      })
      // An empty file is created by the init call itself, there is nothing to send.
      if (initData.completed) return
      sessionId = initData.sessionId
      // Kept so a failed upload can be resumed from where it stopped.
      itemsRef.current.set(item.id, { ...item, sessionId })
    } else {
      const statusData = await apiFetch<{ status: string; offset: string }>(`/uploads/resumable/status/${sessionId}`, { signal })
      startOffset = Number(statusData.offset)
      if (statusData.status === 'completed') return
    }

    // 2. Upload chunk by chunk
    while (startOffset < file.size) {
      const endOffset = Math.min(startOffset + CHUNK_SIZE, file.size)
      const chunk = file.slice(startOffset, endOffset)

      // We use raw fetch with authorization header for binary stream upload
      const response = await fetch(`${API_URL}/uploads/resumable/chunk/${sessionId}`, {
        method: 'PUT',
        signal,
        headers: {
          'Authorization': `Bearer ${getAccessToken()}`,
          'Content-Range': `bytes ${startOffset}-${endOffset - 1}/${file.size}`,
          'Content-Length': String(chunk.size)
        },
        body: chunk
      })

      if (!response.ok) {
        throw new Error('Chunk upload failed')
      }

      const resData = await response.json() as { status: string; offset?: string }
      if (resData.status === 'completed') return

      startOffset = Number(resData.offset)
      updateFile(item.id, { percent: Math.min(99, Math.round((startOffset / file.size) * 100)), status: 'uploading' })
    }

    // Every byte was sent but the server never said it finished: do not show it as done.
    throw new Error('Upload did not complete')
  }

  async function processQueue() {
    runningRef.current = true
    try {
      for (let item = queueRef.current.shift(); item; item = queueRef.current.shift()) {
        const controller = new AbortController()
        controllersRef.current.set(item.id, controller)
        updateFile(item.id, { status: 'uploading' })
        try {
          await uploadSingleFileResumable(item, controller.signal)
          updateFile(item.id, { percent: 100, status: 'done' })
        } catch (err) {
          if (isAbort(err)) {
            updateFile(item.id, { status: 'cancelled' })
          } else {
            console.error('File upload failed:', item.file.name, err)
            updateFile(item.id, { status: 'error' })
          }
        } finally {
          controllersRef.current.delete(item.id)
        }
      }
    } finally {
      runningRef.current = false
      // Dispatch global events so active pages reload their data
      window.dispatchEvent(new Event('multidrive:storage-changed'))
      window.dispatchEvent(new Event('multidrive:upload-completed'))
    }
  }

  async function uploadFiles(filesToUpload: File[], targetFolderId: string | null, targetAccountId?: string | null) {
    if (filesToUpload.length === 0) return

    const items: UploadItem[] = filesToUpload.map((file) => ({ id: `upload-${++nextUploadId}`, file, folderId: targetFolderId, targetAccountId }))
    items.forEach((item) => itemsRef.current.set(item.id, item))
    const rows: UploadProgressFile[] = items.map((item) => ({ id: item.id, name: item.file.name, size: item.file.size, percent: 0, status: 'queued' }))
    const alreadyRunning = runningRef.current

    // A second batch joins the one in progress; otherwise the panel starts over.
    setUploadProgress((current) => {
      const files = alreadyRunning ? [...current.files, ...rows] : rows
      return {
        open: true,
        fileName: files.length === 1 ? files[0].name : t('upload.filesCount', { count: files.length }),
        percent: alreadyRunning ? current.percent : 0,
        status: 'uploading',
        files
      }
    })

    queueRef.current.push(...items)
    if (!alreadyRunning) await processQueue()
  }

  async function retryFailedUpload(id: string) {
    const item = itemsRef.current.get(id)
    if (!item) return
    updateFile(id, { percent: 0, status: 'queued' })
    setUploadProgress((current) => ({ ...current, open: true }))
    queueRef.current.push(item)
    if (!runningRef.current) await processQueue()
  }

  // Without an id, stops everything that has not finished. Files already uploaded stay uploaded.
  function cancelUpload(id?: string) {
    const ids = id ? [id] : [...queueRef.current.map((item) => item.id), ...controllersRef.current.keys()]
    queueRef.current = queueRef.current.filter((item) => !ids.includes(item.id))
    for (const target of ids) {
      controllersRef.current.get(target)?.abort()
    }
    // Files that were only waiting never reach the loop, so mark them here (the active one is marked when its request aborts).
    setUploadProgress((current) => {
      const files = current.files.map((file) => (ids.includes(file.id) && file.status === 'queued' ? { ...file, status: 'cancelled' as const } : file))
      return { ...current, files, status: overallStatus(files) }
    })
  }

  return (
    <UploadContext.Provider value={{ uploadProgress, setUploadProgress, uploadFiles, retryFailedUpload, cancelUpload }}>
      {children}
    </UploadContext.Provider>
  )
}

export function useUpload() {
  const context = useContext(UploadContext)
  if (context === undefined) {
    throw new Error('useUpload must be used within an UploadProvider')
  }
  return context
}
