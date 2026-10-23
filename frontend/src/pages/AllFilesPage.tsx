import { useEffect, useRef, useState, type DragEvent, type FormEvent, type MouseEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle, ClipboardPaste, Download, FolderInput, FolderPlus, LayoutGrid, List, RefreshCw, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DummyModal } from '@/components/drive/DummyModal'
import { EmptyAreaContextMenu } from '@/components/drive/EmptyAreaContextMenu'
import { FileContextMenu } from '@/components/drive/FileContextMenu'
import { FileDetailsDrawer } from '@/components/drive/FileDetailsDrawer'
import { FileGrid } from '@/components/drive/FileGrid'
import { FileTable } from '@/components/drive/FileTable'
import { FolderContextMenu } from '@/components/drive/FolderContextMenu'
import type { FolderSizeScale } from '@/components/drive/FolderGrid'
import { defaultFolderColor, defaultFolderIconUrl, folderColorOptions, folderIconOptions, iconUrlWithColor, normalizeFolderColor } from '@/components/drive/FolderVisual'
import { PageHeader } from '@/components/drive/PageHeader'
import { Input } from '@/components/ui/input'
import { API_URL, apiFetch, apiFetchBlob, formatBytes, formatDate } from '@/lib/api'
import { providerName } from '@/lib/providers'
import { useI18n } from '@/i18n/I18nProvider'
import { saveBlob } from '@/lib/download'
import { createPlyr, ensurePlyr } from '@/lib/plyr'
import { getPreviewKind, officeViewerUrl } from '@/lib/preview'
import type { FileItem, FolderItem } from '@/data/drive-data'
import { useUpload } from '@/context/UploadContext'
import { useDriveLayoutActions } from '@/layouts/DriveLayout'

type BackendFile = { id: string; name: string; mimeType: string; sizeBytes: string; createdAt: string; folderId?: string | null; connectedAccount?: { email: string; provider: string }; folder?: { id: string; name: string } | null }
type BackendFolder = { id: string; name: string; color: string; iconUrl?: string | null; parentId?: string | null; providerFolderId?: string | null; updatedAt: string }
type ConnectedAccount = { id: string; provider: string; email: string; displayName?: string | null; status: string }

const sizeActiveClasses: Record<FolderSizeScale, string> = {
  xs: 'bg-white text-slate-800 dark:bg-red-500/20 dark:text-red-300 dark:border-red-500/30 shadow-sm dark:shadow-none',
  sm: 'bg-white text-slate-800 dark:bg-orange-500/20 dark:text-orange-300 dark:border-orange-500/30 shadow-sm dark:shadow-none',
  md: 'bg-white text-slate-800 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/30 shadow-sm dark:shadow-none',
  lg: 'bg-white text-slate-800 dark:bg-purple-500/20 dark:text-purple-300 dark:border-purple-500/30 shadow-sm dark:shadow-none'
}

type FileViewMode = 'list' | 'grid'

const fileViewStorageKey = 'multidrive:all-files-view-mode'

function getStoredFileViewMode(): FileViewMode {
  const stored = localStorage.getItem(fileViewStorageKey)
  return stored === 'grid' || stored === 'list' ? stored : 'list'
}

// The batch endpoints (move, delete, ZIP) accept at most 100 ids per request.
const maxBatchSize = 100

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

function mimeToKind(mimeType: string): FileItem['kind'] {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.includes('pdf')) return 'pdf'
  return 'doc'
}

function providerLabel(provider: string | undefined) {
  return providerName(provider)
}

function mapFile(file: BackendFile, language: string): FileItem {
  return { id: file.id, name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes, createdAt: file.createdAt, accountEmail: file.connectedAccount?.email, accountProvider: providerLabel(file.connectedAccount?.provider), date: formatDate(file.createdAt, language), size: formatBytes(file.sizeBytes), access: file.connectedAccount?.email ?? providerLabel(file.connectedAccount?.provider), kind: mimeToKind(file.mimeType), shared: 1, folderId: file.folderId, folderName: file.folder?.name }
}

function mapFolder(folder: BackendFolder, language: string, t: ReturnType<typeof useI18n>['t']): FolderItem {
  return { id: folder.id, name: folder.name, color: folder.color, iconUrl: folder.iconUrl, parentId: folder.parentId, providerFolderId: folder.providerFolderId, updated: t('files.updated', { date: formatDate(folder.updatedAt, language) }) }
}



function FolderAppearanceFields({ color, iconUrl, onColorChange, onIconChange }: { color: string; iconUrl: string; onColorChange: (color: string) => void; onIconChange: (iconUrl: string) => void }) {
  const { t, tDynamic } = useI18n()
  const normalizedColor = normalizeFolderColor(color)
  return (
    <div className="grid gap-4">
      <label className="grid gap-2 text-sm font-semibold">{t('files.folderColor')}<Input type="color" value={normalizedColor} onChange={(event) => onColorChange(event.target.value)} className="h-12 p-1" /></label>
      <div className="flex flex-wrap gap-2">{folderColorOptions.map((option) => <button key={option} type="button" onClick={() => onColorChange(option)} className={normalizedColor === option ? 'h-8 w-8 rounded-lg border-2 border-blue-600' : 'h-8 w-8 rounded-lg border border-slate-200'} style={{ backgroundColor: option }} aria-label={t('files.useColor', { color: option })} />)}</div>
      <div className="grid gap-2 text-sm font-semibold"><span>{t('files.folderIcon')}</span><div className="grid grid-cols-4 gap-2 sm:grid-cols-8">{folderIconOptions.map((option) => <button key={option.url} type="button" onClick={() => onIconChange(option.url)} className={iconUrl === option.url ? 'flex h-12 items-center justify-center rounded-xl border-2 border-blue-600 bg-blue-50 p-2' : 'flex h-12 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-2 hover:bg-slate-100'} title={tDynamic(`icon.${option.label}`, option.label)} aria-label={t('files.useIcon', { label: tDynamic(`icon.${option.label}`, option.label) })}><img src={iconUrlWithColor(option.url, normalizedColor)} alt="" className="h-6 w-6" /></button>)}</div></div>
    </div>
  )
}

export function AllFilesPage() {
  const { t, translateError, language } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeFolderId = searchParams.get('folderId')
  const searchQuery = searchParams.get('q')?.trim() ?? ''
  const [uploadOpen, setUploadOpen] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [folderRenameOpen, setFolderRenameOpen] = useState(false)
  const [folderDeleteOpen, setFolderDeleteOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [copiedShareLink, setCopiedShareLink] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [files, setFiles] = useState<FileItem[]>([])
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [allFolders, setAllFolders] = useState<FolderItem[]>([])
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState('')
  const [isUploadDragging, setIsUploadDragging] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderColor, setFolderColor] = useState(defaultFolderColor)
  const [folderIconUrl, setFolderIconUrl] = useState(defaultFolderIconUrl)
  const [renameValue, setRenameValue] = useState('')
  const [folderRenameValue, setFolderRenameValue] = useState('')
  const [folderRenameColor, setFolderRenameColor] = useState(defaultFolderColor)
  const [folderRenameIconUrl, setFolderRenameIconUrl] = useState(defaultFolderIconUrl)
  const [activeFile, setActiveFile] = useState<FileItem | null>(null)
  const [activeFolderForMenu, setActiveFolderForMenu] = useState<FolderItem | null>(null)
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set())
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set())
  const selectionAnchorRef = useRef<{ type: 'file' | 'folder'; id: string } | null>(null)
  const [cutFolder, setCutFolder] = useState<FolderItem | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: FileItem | null }>({ x: 0, y: 0, file: null })
  const [folderContextMenu, setFolderContextMenu] = useState<{ x: number; y: number; folder: FolderItem | null }>({ x: 0, y: 0, folder: null })
  const [emptyContextMenu, setEmptyContextMenu] = useState<{ x: number; y: number; open: boolean }>({ x: 0, y: 0, open: false })
  const [message, setMessage] = useState('')
  const [gdrivePublicUrl, setGdrivePublicUrl] = useState('')
  const [makingPublic, setMakingPublic] = useState(false)
  const [loading, setLoading] = useState(false)
  const [syncingDrive, setSyncingDrive] = useState(false)
  const [fileViewMode, setFileViewMode] = useState<FileViewMode>(getStoredFileViewMode)
  const { uploadFiles } = useUpload()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('viewer')
  const [inviteTargetType, setInviteTargetType] = useState<'file' | 'folder'>('file')
  const [inviteTargetId, setInviteTargetId] = useState('')
  const [inviteMessage, setInviteMessage] = useState('')
  const [inviting, setInviting] = useState(false)
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)
  const [folderSizeScale, setFolderSizeScale] = useState<FolderSizeScale>(() => {
    const v = localStorage.getItem('multidrive:folder-size')
    return (v === 'xs' || v === 'sm' || v === 'md' || v === 'lg') ? v : 'md'
  })
  const { setHeaderActions } = useDriveLayoutActions()
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([])
  const [selectedTargetAccountId, setSelectedTargetAccountId] = useState('')

  function changeFolderSize(scale: FolderSizeScale) {
    setFolderSizeScale(scale)
    localStorage.setItem('multidrive:folder-size', scale)
  }

  async function loadFiles() {
    const params = new URLSearchParams()
    if (activeFolderId) params.set('folderId', activeFolderId)
    if (searchQuery) params.set('q', searchQuery)

    // Add advanced search filters
    const kind = searchParams.get('kind')
    const accountId = searchParams.get('accountId')
    const minSize = searchParams.get('minSize')
    const maxSize = searchParams.get('maxSize')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    if (kind) params.set('kind', kind)
    if (accountId) params.set('accountId', accountId)
    if (minSize) params.set('minSize', minSize)
    if (maxSize) params.set('maxSize', maxSize)
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)

    // Like a file manager: the root lists only its own files; a search or a filter looks through everything.
    const searching = Boolean(searchQuery || kind || accountId || minSize || maxSize || startDate || endDate)
    if (!activeFolderId && !searching) params.set('rootOnly', '1')

    const query = params.toString()
    const path = query ? `/files?${query}` : '/files'
    const data = await apiFetch<{ files: BackendFile[] }>(path)
    setFiles(data.files.map((file) => mapFile(file, language)))
  }

  async function loadFolders() {
    const visiblePath = activeFolderId ? `/folders?parentId=${activeFolderId}` : '/folders'
    const [visibleData, allData] = await Promise.all([
      apiFetch<{ folders: BackendFolder[] }>(visiblePath),
      apiFetch<{ folders: BackendFolder[] }>('/folders?all=1'),
    ])
    setFolders(visibleData.folders.map((folder) => mapFolder(folder, language, t)))
    setAllFolders(allData.folders.map((folder) => mapFolder(folder, language, t)))
  }

  async function loadAll() {
    await Promise.all([loadFiles(), loadFolders()])
  }

  async function handleDropItem(fileId: string, targetFolderId: string) {
    const fileIds = selectedFileIds.has(fileId) ? Array.from(selectedFileIds) : [fileId]
    setLoading(true)
    setMessage('')
    try {
      const result = await apiFetch<{ moved: number; failed?: unknown[] }>('/files/batch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds, folderId: targetFolderId })
      })
      setMessage(result.failed && result.failed.length > 0 ? t('files.batchActionFailed') : t('files.movedItems', { count: result.moved }))
      loadAll().catch(() => undefined)
      setSelectedFileIds(new Set())
    } catch (error) {
      setMessage(translateError(error, 'files.failedMove'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll().catch((error) => setMessage(translateError(error, 'files.failedLoad')))
    setSelectedFileIds(new Set())
  }, [activeFolderId, searchQuery, language])

  useEffect(() => {
    async function loadConnectedAccounts() {
      try {
        const data = await apiFetch<{ accounts: ConnectedAccount[] }>('/connected-accounts')
        setConnectedAccounts(data.accounts || [])
      } catch (error) {
        console.error('Failed to load connected accounts:', error)
      }
    }
    loadConnectedAccounts()
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setContextMenu({ x: 0, y: 0, file: null })
      if (event.key === 'Escape') setFolderContextMenu({ x: 0, y: 0, folder: null })
      if (event.key === 'Escape') setEmptyContextMenu({ x: 0, y: 0, open: false })
      if (event.ctrlKey && event.key.toLowerCase() === 'x' && activeFolderForMenu) {
        event.preventDefault()
        cutSelectedFolder(activeFolderForMenu)
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'v' && cutFolder) {
        event.preventDefault()
        pasteFolder().catch((error) => setMessage(translateError(error, 'files.failedPaste')))
      }
    }

    function onOpenMoveShortcut(e: Event) {
      const file = (e as CustomEvent).detail as FileItem
      selectContextFile(file)
      setActiveFile(file)
      setSelectedFolderId(file.folderId || '')
      setMoveOpen(true)
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('multidrive:open-move-modal', onOpenMoveShortcut)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('multidrive:open-move-modal', onOpenMoveShortcut)
    }
  }, [activeFolderForMenu, cutFolder, activeFolderId, selectedFileIds])

  useEffect(() => {
    if (!previewOpen || !activeFile?.mimeType?.startsWith('video/') || !previewVideoRef.current) return undefined
    let disposed = false
    let player: { destroy: () => void } | null = null

    ensurePlyr().then(() => {
      if (disposed || !previewVideoRef.current) return
      player = createPlyr(previewVideoRef.current)
    }).catch(() => undefined)

    return () => {
      disposed = true
      player?.destroy()
    }
  }, [previewOpen, activeFile?.mimeType, previewUrl])

  useEffect(() => {
    setSelectedFileIds(new Set())
    setSelectedFolderIds(new Set())
    selectionAnchorRef.current = null
  }, [activeFolderId])

  // Re-registered on every render so it always sees the current lists.
  useEffect(() => {
    function onSelectAll(event: KeyboardEvent) {
      const target = event.target
      if (target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        selectAllVisible()
      }
    }
    window.addEventListener('keydown', onSelectAll)
    return () => window.removeEventListener('keydown', onSelectAll)
  })

  async function createFolder(event: FormEvent) {
    event.preventDefault()
    await apiFetch('/folders', { method: 'POST', body: JSON.stringify({ name: folderName, color: folderColor, iconUrl: folderIconUrl, parentId: activeFolderId ?? null }) })
    setFolderName('')
    setFolderColor(defaultFolderColor)
    setFolderIconUrl(defaultFolderIconUrl)
    setFolderOpen(false)
    await loadFolders()
  }

  async function uploadFile(event: FormEvent) {
    event.preventDefault()
    if (selectedFiles.length === 0) return
    setLoading(true)
    setMessage('')

    const uploadingFiles = [...selectedFiles]
    const targetFolderId = activeFolderId || selectedFolderId
    const targetAccountId = selectedTargetAccountId || null

    setSelectedFiles([])
    setSelectedFolderId('')
    setSelectedTargetAccountId('')
    setUploadOpen(false)

    try {
      await uploadFiles(uploadingFiles, targetFolderId, targetAccountId)
    } catch (err) {
      console.error('Upload initiation failed:', err)
    } finally {
      setLoading(false)
    }
  }


  async function syncGoogleDrive() {
    setSyncingDrive(true)
    setMessage('')
    try {
      const response = await apiFetch<{ results: { created: number; updated: number; deleted: number }[] }>('/files/sync-google', { method: 'POST', body: JSON.stringify({}) })

      let created = 0, updated = 0, deleted = 0
      for (const res of response.results) {
        created += res.created
        updated += res.updated
        deleted += res.deleted
      }
      const accounts = response.results.length

      setMessage(t('files.syncDone', { created, updated, deleted, accounts }))
      await loadAll()
      window.dispatchEvent(new Event('multidrive:storage-changed'))
    } catch (error) {
      setMessage(translateError(error, 'files.failedSync'))
    } finally {
      setSyncingDrive(false)
    }
  }

  function selectUploadFiles(files: FileList | File[] | null | undefined) {
    if (!files) return
    const nextFiles = Array.from(files)
    if (nextFiles.length === 0) return
    setSelectedFiles(nextFiles)
  }

  function removeUploadFile(index: number) {
    setSelectedFiles((files) => files.filter((_, fileIndex) => fileIndex !== index))
  }

  function handleUploadDrag(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (event.type === 'dragenter' || event.type === 'dragover') setIsUploadDragging(true)
    if (event.type === 'dragleave' || event.type === 'drop') setIsUploadDragging(false)
    if (event.type === 'drop') selectUploadFiles(event.dataTransfer.files)
  }



  // Like Google Drive: a menu opened on a file outside the selection acts on that file only; inside it, on the whole selection.
  function selectContextFile(file: FileItem) {
    if (!file.id || selectedFileIds.has(file.id)) return
    setSelectedFileIds(new Set([file.id]))
    setSelectedFolderIds(new Set())
  }

  function openContext(event: MouseEvent<HTMLElement>, file: FileItem) {
    event.preventDefault()
    event.stopPropagation()
    selectContextFile(file)
    setActiveFile(file)
    setContextMenu({ x: event.clientX, y: event.clientY, file })
  }

  function toggleFileSelection(file: FileItem) {
    if (!file.id) return
    setSelectedFileIds((current) => {
      const next = new Set(current)
      if (next.has(file.id!)) next.delete(file.id!)
      else next.add(file.id!)
      return next
    })
  }

  function toggleFolderSelection(folder: FolderItem) {
    if (!folder.id) return
    setSelectedFolderIds((current) => {
      const next = new Set(current)
      if (next.has(folder.id!)) next.delete(folder.id!)
      else next.add(folder.id!)
      return next
    })
  }

  function toggleAllVisibleFiles() {
    const visibleFileIds = files.map((file) => file.id).filter(Boolean) as string[]
    const visibleFolderIds = visibleFolderRows.map((folder) => folder.id).filter(Boolean) as string[]
    const allSelected = (visibleFileIds.length > 0 || visibleFolderIds.length > 0) && visibleFileIds.every((id) => selectedFileIds.has(id)) && visibleFolderIds.every((id) => selectedFolderIds.has(id))
    setSelectedFileIds(allSelected ? new Set() : new Set(visibleFileIds))
    setSelectedFolderIds(allSelected ? new Set() : new Set(visibleFolderIds))
  }

  function clearSelection() {
    setSelectedFileIds(new Set())
    setSelectedFolderIds(new Set())
  }

  function selectAllVisible() {
    setSelectedFileIds(new Set(files.map((file) => file.id).filter(Boolean) as string[]))
    setSelectedFolderIds(new Set(visibleFolderRows.map((folder) => folder.id).filter(Boolean) as string[]))
  }

  // File-manager selection on desktop: click selects one row, Ctrl/Cmd+click toggles it, Shift+click selects a range.
  function handleRowClick(item: { type: 'file' | 'folder'; id?: string }, event: MouseEvent<HTMLElement>) {
    if (!item.id) return
    const order = [...visibleFolderRows.map((folder) => ({ type: 'folder' as const, id: folder.id })), ...files.map((file) => ({ type: 'file' as const, id: file.id }))].filter((entry): entry is { type: 'file' | 'folder'; id: string } => Boolean(entry.id))
    const anchor = selectionAnchorRef.current
    if (event.shiftKey && anchor) {
      const from = order.findIndex((entry) => entry.type === anchor.type && entry.id === anchor.id)
      const to = order.findIndex((entry) => entry.type === item.type && entry.id === item.id)
      if (from >= 0 && to >= 0) {
        const range = order.slice(Math.min(from, to), Math.max(from, to) + 1)
        setSelectedFileIds(new Set(range.filter((entry) => entry.type === 'file').map((entry) => entry.id)))
        setSelectedFolderIds(new Set(range.filter((entry) => entry.type === 'folder').map((entry) => entry.id)))
        return
      }
    }
    selectionAnchorRef.current = { type: item.type, id: item.id }
    const setIds = item.type === 'file' ? setSelectedFileIds : setSelectedFolderIds
    if (event.ctrlKey || event.metaKey) {
      setIds((current) => {
        const next = new Set(current)
        if (next.has(item.id!)) next.delete(item.id!)
        else next.add(item.id!)
        return next
      })
      return
    }
    setSelectedFileIds(new Set(item.type === 'file' ? [item.id] : []))
    setSelectedFolderIds(new Set(item.type === 'folder' ? [item.id] : []))
  }

  function changeFileViewMode(mode: FileViewMode) {
    setFileViewMode(mode)
    localStorage.setItem(fileViewStorageKey, mode)
  }

  function openFolderMenu(event: MouseEvent<HTMLElement>, folder: FolderItem) {
    event.preventDefault()
    event.stopPropagation()
    setActiveFolderForMenu(folder)
    setFolderContextMenu({ x: event.clientX, y: event.clientY, folder })
  }

  function openFolder(folder: FolderItem) {
    if (!folder.id) return
    setSearchParams(searchQuery ? { folderId: folder.id, q: searchQuery } : { folderId: folder.id })
  }

  function openFolderById(folderId: string) {
    setSearchParams(searchQuery ? { folderId, q: searchQuery } : { folderId })
  }

  function openEmptyContextMenu(event: MouseEvent<HTMLElement>) {
    event.preventDefault()
    setEmptyContextMenu({ x: event.clientX, y: event.clientY, open: true })
  }

  function closeFolder() {
    setSearchParams(searchQuery ? { q: searchQuery } : {})
  }

  async function viewFile() {
    if (!activeFile?.id) return
    setPreviewUrl('')
    setPreviewError('')
    setPreviewLoading(true)
    setPreviewOpen(true)
    setContextMenu({ x: 0, y: 0, file: null })
    try {
      const data = await apiFetch<{ path?: string; url: string }>(`/files/${activeFile.id}/preview-token`, { method: 'POST' })
      const previewPath = data.path ?? new URL(data.url).pathname
      setPreviewUrl(`${API_URL}${previewPath}`)
    } catch (error) {
      setPreviewError(translateError(error, 'files.failedPreview'))
    } finally {
      setPreviewLoading(false)
    }
  }

  async function downloadFile() {
    if (!activeFile?.id) return
    const file = activeFile
    setContextMenu({ x: 0, y: 0, file: null })
    setMessage('')
    try {
      const { blob, fileName } = await apiFetchBlob(`/files/${file.id}/download`)
      saveBlob(blob, fileName ?? file.name)
    } catch (error) {
      setMessage(translateError(error, 'files.downloadFailed'))
    }
  }

  async function downloadBatchAsZip() {
    const selectedIds = [...selectedFileIds]
    if (selectedIds.length === 0) return
    if (selectedIds.length > maxBatchSize) {
      setMessage(t('files.zipLimit', { max: maxBatchSize }))
      return
    }
    setLoading(true)
    setMessage('')
    try {
      const { blob, fileName } = await apiFetchBlob('/files/batch-download', { method: 'POST', body: JSON.stringify({ fileIds: selectedIds }) })
      saveBlob(blob, fileName ?? 'multidrive-download.zip')
      clearSelection()
      setMessage(t('files.batchDone'))
    } catch (error) {
      setMessage(translateError(error, 'files.zipFailed'))
    } finally {
      setLoading(false)
    }
  }


  async function renameFile(event: FormEvent) {
    event.preventDefault()
    if (!activeFile?.id) return
    await apiFetch(`/files/${activeFile.id}`, { method: 'PATCH', body: JSON.stringify({ name: renameValue }) })
    setRenameOpen(false)
    await loadFiles()
  }

  // A selected folder whose ancestor is also selected travels (or goes) with that ancestor.
  function topLevelSelectedFolderIds() {
    const parentById = new Map(allFolders.map((folder) => [folder.id, folder.parentId]))
    return [...selectedFolderIds].filter((id) => {
      const seen = new Set<string>()
      let parentId = parentById.get(id)
      while (parentId && !seen.has(parentId)) {
        if (selectedFolderIds.has(parentId)) return false
        seen.add(parentId)
        parentId = parentById.get(parentId)
      }
      return true
    })
  }

  async function moveFile(event: FormEvent) {
    event.preventDefault()
    const selectedIds = [...selectedFileIds]
    const folderIds = topLevelSelectedFolderIds()
    if (selectedIds.length === 0 && folderIds.length === 0 && !activeFile?.id) return
    let failed = 0
    let failedFiles = 0
    try {
      if (selectedIds.length > 0 || folderIds.length > 0) {
        for (const ids of chunk(selectedIds, maxBatchSize)) {
          const result = await apiFetch<{ failed?: unknown[] }>('/files/batch', { method: 'PATCH', body: JSON.stringify({ fileIds: ids, folderId: selectedFolderId || null }) })
          failedFiles += result.failed?.length ?? 0
        }
        const results = await Promise.allSettled(folderIds.map((id) => apiFetch(`/folders/${id}`, { method: 'PATCH', body: JSON.stringify({ parentId: selectedFolderId || null }) })))
        failed = results.filter((result) => result.status === 'rejected').length
      } else if (activeFile?.id) await apiFetch(`/files/${activeFile.id}`, { method: 'PATCH', body: JSON.stringify({ folderId: selectedFolderId || null }) })
      setMessage(failed + failedFiles > 0 ? t('files.batchActionFailed') : '')
    } catch (error) {
      setMessage(translateError(error, 'files.failedMove'))
    }
    setMoveOpen(false)
    setSelectedFolderId('')
    clearSelection()
    await Promise.all([loadFiles(), loadFolders()]).catch(() => undefined)
  }

  async function deleteFile() {
    const selectedIds = [...selectedFileIds]
    const folderIds = topLevelSelectedFolderIds()
    if (selectedIds.length === 0 && folderIds.length === 0 && !activeFile?.id) return
    let failed = 0
    try {
      if (selectedIds.length > 0 || folderIds.length > 0) {
        for (const ids of chunk(selectedIds, maxBatchSize)) await apiFetch('/files/batch', { method: 'DELETE', body: JSON.stringify({ fileIds: ids }) })
        for (const id of folderIds) {
          try { await apiFetch(`/folders/${id}`, { method: 'DELETE' }) } catch { failed += 1 }
        }
      } else if (activeFile?.id) await apiFetch(`/files/${activeFile.id}`, { method: 'DELETE' })
      setMessage(failed > 0 ? t('files.batchActionFailed') : '')
    } catch (error) {
      setMessage(translateError(error, 'files.failedDelete'))
    }
    setDeleteOpen(false)
    clearSelection()
    await Promise.all([loadFiles(), loadFolders()]).catch(() => undefined)
    window.dispatchEvent(new Event('multidrive:storage-changed'))
  }

  async function shareFile() {
    if (!activeFile?.id) return
    const data = await apiFetch<{ url: string }>(`/files/${activeFile.id}/share`, { method: 'POST' })
    setShareUrl(data.url)
    setCopiedShareLink(false)
    setGdrivePublicUrl('')
    setMakingPublic(false)
    setShareOpen(true)
    setContextMenu({ x: 0, y: 0, file: null })
  }

  async function copyShareLinkDirect() {
    if (!activeFile?.id) return
    try {
      const data = await apiFetch<{ url: string | null }>(`/files/${activeFile.id}/view-url`)
      if (data.url) {
        await navigator.clipboard.writeText(data.url)
        setMessage(t('files.gdriveLinkCopied'))
        setTimeout(() => setMessage(''), 2500)
      } else {
        const shareData = await apiFetch<{ url: string }>(`/files/${activeFile.id}/share`, { method: 'POST' })
        await navigator.clipboard.writeText(shareData.url)
        setMessage(t('files.shareLinkCopied'))
        setTimeout(() => setMessage(''), 2500)
      }
    } catch (err: any) {
      setMessage(t('files.copyFailed', { error: err.message || String(err) }))
      setTimeout(() => setMessage(''), 2500)
    }
    setContextMenu({ x: 0, y: 0, file: null })
  }

  async function inviteToFile() {
    if (!activeFile?.id) return
    setInviteTargetType('file')
    setInviteTargetId(activeFile.id)
    setInviteOpen(true)
    setContextMenu({ x: 0, y: 0, file: null })
  }

  async function inviteToFolder() {
    if (!activeFolderForMenu?.id) return
    setInviteTargetType('folder')
    setInviteTargetId(activeFolderForMenu.id)
    setInviteOpen(true)
    setFolderContextMenu({ x: 0, y: 0, folder: null })
  }

  async function copyFolderLink() {
    if (!activeFolderForMenu?.id) return
    let url = `${window.location.origin}/all-files?folderId=${activeFolderForMenu.id}`
    if (activeFolderForMenu.providerFolderId) {
      url = `https://drive.google.com/open?id=${activeFolderForMenu.providerFolderId}`
    }
    await navigator.clipboard.writeText(url)
    setMessage(t('files.folderLinkCopied'))
    setTimeout(() => setMessage(''), 2500)
    setFolderContextMenu({ x: 0, y: 0, folder: null })
  }

  async function sendInvite(event: FormEvent) {
    event.preventDefault()
    if (!inviteTargetId) return
    setInviting(true)
    setInviteMessage('')
    try {
      await apiFetch('/invites', { method: 'POST', body: JSON.stringify({ email: inviteEmail, role: inviteRole, targetType: inviteTargetType, targetId: inviteTargetId }) })
      setInviteEmail('')
      setInviteRole('viewer')
      setInviteMessage(t('files.inviteSaved'))
      window.dispatchEvent(new Event('multidrive:invites-changed'))
    } catch (error) {
      setInviteMessage(translateError(error, 'files.failedInvite'))
    } finally {
      setInviting(false)
    }
  }

  async function copyShareLink() {
    await navigator.clipboard.writeText(shareUrl)
    setCopiedShareLink(true)
    window.setTimeout(() => setCopiedShareLink(false), 1600)
  }

  async function renameFolder(event: FormEvent) {
    event.preventDefault()
    if (!activeFolderForMenu?.id) return
    await apiFetch(`/folders/${activeFolderForMenu.id}`, { method: 'PATCH', body: JSON.stringify({ name: folderRenameValue, color: folderRenameColor, iconUrl: folderRenameIconUrl }) })
    setFolderRenameOpen(false)
    await loadFolders()
  }

  async function deleteFolder() {
    if (!activeFolderForMenu?.id) return
    await apiFetch(`/folders/${activeFolderForMenu.id}`, { method: 'DELETE' })
    setFolderDeleteOpen(false)
    await loadFolders()
  }

  function cutSelectedFolder(folder: FolderItem | null) {
    if (!folder?.id) return
    setCutFolder(folder)
    setFolderContextMenu({ x: 0, y: 0, folder: null })
    setMessage(t('files.folderReadyMove', { name: folder.name }))
  }

  async function pasteFolder() {
    if (!cutFolder?.id) return
    await apiFetch(`/folders/${cutFolder.id}`, { method: 'PATCH', body: JSON.stringify({ parentId: activeFolderId ?? null }) })
    setMessage(t('files.folderMoved', { name: cutFolder.name }))
    setCutFolder(null)
    await loadFolders()
  }

  function closePreview() {
    setPreviewUrl('')
    setPreviewError('')
    setPreviewLoading(false)
    setPreviewOpen(false)
  }

  useEffect(() => {
    function handleUploadCompleted() {
      loadAll().catch(() => undefined)
    }
    window.addEventListener('multidrive:upload-completed', handleUploadCompleted)
    return () => window.removeEventListener('multidrive:upload-completed', handleUploadCompleted)
  }, [activeFolderId])

  // The header buttons are only rebuilt when the dependencies below change, so they must not call a stale copy of the sync
  // (it would reload the folder the page was opened in instead of the current one).
  const syncGoogleDriveRef = useRef(syncGoogleDrive)
  syncGoogleDriveRef.current = syncGoogleDrive

  useEffect(() => {
    const sizeLabels: FolderSizeScale[] = ['xs', 'sm', 'md', 'lg']
    setHeaderActions(
      <div className="flex items-center gap-2">
        {/* Folder size scale picker */}
        <div className="hidden sm:flex items-center gap-0.5 rounded-xl border border-slate-200 bg-slate-50 p-0.5">
          {sizeLabels.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => changeFolderSize(s)}
              className={[
                'rounded-lg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide transition-all border border-transparent',
                folderSizeScale === s
                  ? sizeActiveClasses[s]
                  : 'text-slate-400 hover:text-slate-600',
              ].join(' ')}
              aria-label={t('files.folderSize', { size: s })}
              aria-pressed={folderSizeScale === s}
            >
              {s}
            </button>
          ))}
        </div>
        {/* Divider */}
        <div className="hidden sm:block h-6 w-px bg-slate-200" />
        <Button size="sm" onClick={() => setUploadOpen(true)}>
          <Upload className="h-3.5 w-3.5" />{t('files.upload')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setFolderOpen(true)}>
          <FolderPlus className="h-3.5 w-3.5" />{t('areaMenu.newFolder')}
        </Button>
        <Button size="sm" variant="outline" disabled={syncingDrive} onClick={() => syncGoogleDriveRef.current()}>
          <RefreshCw className={syncingDrive ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
          {syncingDrive ? t('files.syncing') : t('files.sync')}
        </Button>
      </div>
    )
  }, [syncingDrive, folderSizeScale, t])


  const activeFolder = allFolders.find((folder) => folder.id === activeFolderId)
  const folderBreadcrumbs = (() => {
    if (!activeFolder) return []
    const foldersById = new Map(allFolders.map((folder) => [folder.id, folder]))
    const path: FolderItem[] = []
    const visited = new Set<string>()
    let current: FolderItem | undefined = activeFolder
    while (current?.id && !visited.has(current.id)) {
      path.unshift(current)
      visited.add(current.id)
      current = current.parentId ? foldersById.get(current.parentId) : undefined
    }
    return path
  })()
  const visibleFolderRows = searchQuery ? [] : folders
  const selectedCount = selectedFileIds.size + selectedFolderIds.size
  const allVisibleSelected = (files.length > 0 || visibleFolderRows.length > 0) && files.every((file) => file.id && selectedFileIds.has(file.id)) && visibleFolderRows.every((folder) => folder.id && selectedFolderIds.has(folder.id))
  const activePreviewKind = getPreviewKind(activeFile?.mimeType)

  return (
    <>
      <div onContextMenu={openEmptyContextMenu} className="min-h-[620px] w-full min-w-0">
      <PageHeader title={activeFolder ? <span className="block min-w-0 truncate"><button className="text-blue-600 hover:underline" onClick={closeFolder}>{t('nav.allFiles')}</button>{folderBreadcrumbs.map((folder, index) => <span key={folder.id}><span className="text-slate-400"> / </span>{index === folderBreadcrumbs.length - 1 ? <span>{folder.name}</span> : <button className="text-blue-600 hover:underline" onClick={() => folder.id && openFolderById(folder.id)}>{folder.name}</button>}</span>)}</span> : t('nav.allFiles')} />
      {/* Action buttons row — visible on mobile/tablet, hidden on desktop (desktop uses header slot) */}
      <div className="mt-4 flex flex-wrap items-center gap-2 lg:hidden">
        <Button size="sm" onClick={() => setUploadOpen(true)}><Upload className="h-3.5 w-3.5" />{t('files.upload')}</Button>
        <Button size="sm" variant="outline" onClick={() => setFolderOpen(true)}><FolderPlus className="h-3.5 w-3.5" />{t('areaMenu.newFolder')}</Button>
        <Button size="sm" variant="outline" disabled={syncingDrive} onClick={syncGoogleDrive}><RefreshCw className={syncingDrive ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />{syncingDrive ? t('files.syncing') : t('files.sync')}</Button>
        <div className="flex items-center gap-0.5 rounded-xl border border-slate-200 bg-slate-50 p-0.5">
          {(['xs','sm','md','lg'] as FolderSizeScale[]).map((s) => (
            <button key={s} type="button" onClick={() => changeFolderSize(s)} className={['rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-all border border-transparent', folderSizeScale === s ? sizeActiveClasses[s] : 'text-slate-400 hover:text-slate-600'].join(' ')} aria-label={t('files.folderSize', { size: s })}>{s}</button>
          ))}
        </div>
      </div>
      {message ? <p className="mt-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-700">{message}</p> : null}
      <div className="mt-4 flex flex-col gap-2 sm:mt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">{selectedCount > 0 ? <div className="flex w-full flex-col gap-3 rounded-2xl border border-orange-500/20 bg-orange-500/10 p-3 sm:w-auto sm:flex-row sm:items-center sm:border-0 sm:bg-transparent sm:p-0"><span className="text-sm font-extrabold text-slate-700">{t('files.selected', { count: selectedCount })}</span><div className="grid grid-cols-4 gap-2 sm:flex sm:gap-3"><Button className="w-full" variant="outline" disabled={selectedFileIds.size === 0} onClick={downloadBatchAsZip}><Download className="h-4 w-4" />{t('files.zip')}</Button><Button className="w-full" variant="outline" onClick={() => setMoveOpen(true)}><FolderInput className="h-4 w-4" />{t('table.move')}</Button><Button className="w-full" variant="danger" onClick={() => setDeleteOpen(true)}><Trash2 className="h-4 w-4" />{t('action.delete')}</Button><Button className="w-full" variant="ghost" onClick={clearSelection}>{t('files.clear')}</Button></div></div> : null}</div>
        <div className="flex gap-3"><Button variant={fileViewMode === 'grid' ? 'soft' : 'outline'} size="icon" aria-label={t('files.viewGrid')} aria-pressed={fileViewMode === 'grid'} onClick={() => changeFileViewMode('grid')}><LayoutGrid className="h-5 w-5" /></Button><Button variant={fileViewMode === 'list' ? 'soft' : 'outline'} size="icon" aria-label={t('files.viewList')} aria-pressed={fileViewMode === 'list'} onClick={() => changeFileViewMode('list')}><List className="h-5 w-5" /></Button></div>
      </div>
      {cutFolder ? <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-700"><ClipboardPaste className="mr-2 inline h-4 w-4" />{t('files.cutNotice', { name: cutFolder.name })}</p> : null}
      {files.length === 0 && visibleFolderRows.length === 0 ? (
        <Card className="mt-3 p-5 bg-white/10 backdrop-blur-sm border border-white/20 dark:bg-transparent dark:border-0 dark:p-0 dark:shadow-none">
          <p className="text-sm text-slate-500">{searchQuery ? t('files.emptySearch', { query: searchQuery }) : activeFolder ? t('files.emptyFolder') : t('files.emptyAll')}</p>
        </Card>
      ) : (
        <Card className="mt-3 p-4 sm:p-5 bg-white/10 backdrop-blur-sm border border-white/20 dark:bg-transparent dark:border-0 dark:p-0 dark:shadow-none">
          {fileViewMode === 'grid' ? (
            <FileGrid files={files} folders={visibleFolderRows} selectedFileIds={selectedFileIds} selectedFolderIds={selectedFolderIds} sizeScale={folderSizeScale} onToggleFile={toggleFileSelection} onToggleFolder={toggleFolderSelection} onFileContextMenu={openContext} onFolderOpen={openFolder} onFolderMenu={openFolderMenu} onDropItem={handleDropItem} />
          ) : (
            <FileTable files={files} folders={visibleFolderRows} selectedFileIds={selectedFileIds} selectedFolderIds={selectedFolderIds} allSelected={allVisibleSelected} onToggleFile={toggleFileSelection} onToggleFolder={toggleFolderSelection} onToggleAll={toggleAllVisibleFiles} onRowClick={handleRowClick} onFileContextMenu={openContext} onFolderOpen={openFolder} onFolderMenu={openFolderMenu} onDropItem={handleDropItem} />
          )}
        </Card>
      )}
      </div>
      <EmptyAreaContextMenu x={emptyContextMenu.x} y={emptyContextMenu.y} open={emptyContextMenu.open} canPasteFolder={Boolean(cutFolder)} onClose={() => setEmptyContextMenu({ x: 0, y: 0, open: false })} onUpload={() => { setUploadOpen(true); setEmptyContextMenu({ x: 0, y: 0, open: false }) }} onCreateFolder={() => { setFolderOpen(true); setEmptyContextMenu({ x: 0, y: 0, open: false }) }} onPasteFolder={() => { pasteFolder().catch((error) => setMessage(translateError(error, 'files.failedPaste'))); setEmptyContextMenu({ x: 0, y: 0, open: false }) }} />
      <FileContextMenu x={contextMenu.x} y={contextMenu.y} file={contextMenu.file} onClose={() => setContextMenu({ x: 0, y: 0, file: null })} onView={viewFile} onDownload={downloadFile} onRename={() => { setRenameValue(activeFile?.name ?? ''); setRenameOpen(true); setContextMenu({ x: 0, y: 0, file: null }) }} onMove={() => { setMoveOpen(true); setContextMenu({ x: 0, y: 0, file: null }) }} onDetails={() => { setDetailOpen(true); setContextMenu({ x: 0, y: 0, file: null }) }} onShare={shareFile} onCopyLink={copyShareLinkDirect} onInvite={inviteToFile} onDelete={() => { setDeleteOpen(true); setContextMenu({ x: 0, y: 0, file: null }) }} />
      <FolderContextMenu x={folderContextMenu.x} y={folderContextMenu.y} folder={folderContextMenu.folder} onClose={() => setFolderContextMenu({ x: 0, y: 0, folder: null })} onCut={() => cutSelectedFolder(activeFolderForMenu)} onRename={() => { setFolderRenameValue(activeFolderForMenu?.name ?? ''); setFolderRenameColor(normalizeFolderColor(activeFolderForMenu?.color)); setFolderRenameIconUrl(activeFolderForMenu?.iconUrl ?? defaultFolderIconUrl); setFolderRenameOpen(true); setFolderContextMenu({ x: 0, y: 0, folder: null }) }} onInvite={inviteToFolder} onCopyLink={copyFolderLink} onDelete={() => { setFolderDeleteOpen(true); setFolderContextMenu({ x: 0, y: 0, folder: null }) }} />
      <FileDetailsDrawer open={detailOpen} file={activeFile} onClose={() => setDetailOpen(false)} />

      <DummyModal open={uploadOpen} title={t('areaMenu.upload')} description={t('files.uploadDesc')} onClose={() => setUploadOpen(false)}>
        <form onSubmit={uploadFile} className="grid gap-4">
           <label onDragEnter={handleUploadDrag} onDragOver={handleUploadDrag} onDragLeave={handleUploadDrag} onDrop={handleUploadDrag} className={isUploadDragging ? 'grid cursor-pointer gap-3 rounded-2xl border-2 border-dashed border-blue-500 bg-blue-50 p-4 text-center transition sm:p-6' : 'grid cursor-pointer gap-3 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-4 text-center transition hover:border-blue-300 hover:bg-blue-50/50 sm:p-6'}>
            <Upload className={isUploadDragging ? 'mx-auto h-8 w-8 text-blue-600' : 'mx-auto h-8 w-8 text-slate-500'} />
            <span className="text-sm font-extrabold text-slate-950">{t('files.dropHere')}</span>
            <span className="text-xs text-slate-500">{t('files.uploadHint')}</span>
            <Input type="file" className="sr-only" multiple onChange={(event) => selectUploadFiles(event.target.files)} required={selectedFiles.length === 0} />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            {t('files.targetAccount')}
            <select
              className="h-11 rounded-xl border border-slate-200 px-3 text-sm bg-white"
              value={selectedTargetAccountId}
              onChange={(event) => setSelectedTargetAccountId(event.target.value)}
            >
              <option value="">{t('files.automatic')}</option>
              {connectedAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.email || account.displayName || account.id} ({account.provider === 's3' ? 'S3' : providerName(account.provider)})
                </option>
              ))}
            </select>
          </label>
          {activeFolder ? <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{t('files.uploadingTo')} <b>{activeFolder.name}</b></p> : <label className="grid gap-2 text-sm font-semibold">{t('details.folder')}<select className="h-11 rounded-xl border border-slate-200 px-3 text-sm bg-white" value={selectedFolderId} onChange={(event) => setSelectedFolderId(event.target.value)}><option value="">{t('details.noFolder')}</option>{allFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>}
          {selectedFiles.length > 0 ? <div className="grid max-h-56 gap-2 overflow-y-auto rounded-xl bg-slate-50 p-3 text-sm text-slate-600"><div className="flex items-center justify-between gap-3"><span className="font-bold text-slate-950">{t('files.selected', { count: selectedFiles.length })}</span><span className="shrink-0">{formatBytes(selectedFiles.reduce((total, file) => total + file.size, 0))}</span></div>{selectedFiles.map((file, index) => <div key={`${file.name}-${file.size}-${index}`} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-white px-3 py-2"><span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span><span className="shrink-0 text-xs text-slate-500">{formatBytes(file.size)}</span><button type="button" className="shrink-0 text-slate-500 hover:text-red-600" onClick={() => removeUploadFile(index)} aria-label={t('files.removeFile', { name: file.name })}><X className="h-4 w-4" /></button></div>)}</div> : null}
          <div className="grid gap-3 sm:flex sm:justify-end"><Button type="button" variant="outline" onClick={() => setUploadOpen(false)}>{t('common.cancel')}</Button><Button disabled={loading || selectedFiles.length === 0}>{loading ? t('files.uploading') : selectedFiles.length > 1 ? t('files.uploadN', { count: selectedFiles.length }) : t('files.upload')}</Button></div>
        </form>
      </DummyModal>
       <DummyModal open={folderOpen} title={t('areaMenu.newFolder')} description={t('files.newFolderDesc')} onClose={() => setFolderOpen(false)}>
        <form onSubmit={createFolder} className="grid gap-4">
          <label className="grid gap-2 text-sm font-semibold">{t('files.folderName')}<Input value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder="Project Assets" required /></label>
          <FolderAppearanceFields color={folderColor} iconUrl={folderIconUrl} onColorChange={setFolderColor} onIconChange={setFolderIconUrl} />
          <div className="grid gap-3 pt-2 sm:flex sm:justify-end"><Button type="button" variant="outline" onClick={() => setFolderOpen(false)}>{t('common.cancel')}</Button><Button>{t('files.createFolder')}</Button></div>
        </form>
      </DummyModal>
      <DummyModal open={renameOpen} title={t('files.renameFileTitle')} description={activeFile?.name ?? ''} onClose={() => setRenameOpen(false)}><form onSubmit={renameFile} className="grid gap-4"><Input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} required /><div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>{t('common.cancel')}</Button><Button>{t('action.rename')}</Button></div></form></DummyModal>
      <DummyModal open={moveOpen} title={t('action.move')} description={selectedCount > 0 ? t(selectedFolderIds.size > 0 ? 'files.moveCountItems' : 'files.moveCount', { count: selectedCount }) : activeFile?.name ?? ''} onClose={() => setMoveOpen(false)}><form onSubmit={moveFile} className="grid gap-4"><select className="h-11 rounded-xl border border-slate-200 px-3 text-sm" value={selectedFolderId} onChange={(event) => setSelectedFolderId(event.target.value)}><option value="">{t('details.noFolder')}</option>{allFolders.filter((folder) => !selectedFolderIds.has(folder.id ?? '')).map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => setMoveOpen(false)}>{t('common.cancel')}</Button><Button>{t('table.move')}</Button></div></form></DummyModal>
      <DummyModal open={deleteOpen} title={selectedFolderIds.size > 0 ? t('files.deleteItems') : selectedFileIds.size > 0 ? t('files.deleteFiles') : t('files.deleteFile')} description={selectedFolderIds.size > 0 ? t('files.deleteManyItems', { count: selectedCount }) : selectedFileIds.size > 0 ? t('files.deleteMany', { count: selectedFileIds.size }) : t('files.deleteOne', { name: activeFile?.name ?? t('files.fileWord') })} onClose={() => setDeleteOpen(false)}><div className="flex justify-end gap-3"><Button variant="outline" onClick={() => setDeleteOpen(false)}>{t('common.cancel')}</Button><Button variant="danger" onClick={deleteFile}>{t('action.delete')}</Button></div></DummyModal>
      <DummyModal open={shareOpen} title={t('action.shareLink')} description={activeFile?.name ?? ''} onClose={() => setShareOpen(false)}>
        <div className="grid gap-4">
          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1">{t('files.sharePublic')}</label>
            <Input value={shareUrl} readOnly />
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setShareOpen(false)}>{t('common.close')}</Button>
            <Button onClick={copyShareLink}>{copiedShareLink ? <CheckCircle className="h-4 w-4" /> : null}{copiedShareLink ? t('table.copied') : t('action.copyLink')}</Button>
          </div>
          {copiedShareLink ? <p className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{t('files.shareCopied')}</p> : null}

          {activeFile?.accountProvider === 'google_drive' && (
            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 grid gap-3">
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">{t('files.gdriveDirect')}</label>
                <p className="text-xs text-slate-500 mb-2">{t('files.gdriveDesc')}</p>
              </div>
              {gdrivePublicUrl ? (
                <div className="grid gap-2">
                  <Input value={gdrivePublicUrl} readOnly />
                  <p className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{t('files.gdriveDone')}</p>
                </div>
              ) : (
                <Button
                  variant="outline"
                  disabled={makingPublic}
                  onClick={async () => {
                    if (!activeFile?.id) return
                    setMakingPublic(true)
                    try {
                      const res = await apiFetch<{ url: string }>('/files/' + activeFile.id + '/public-permission', { method: 'POST' })
                      setGdrivePublicUrl(res.url)
                      await navigator.clipboard.writeText(res.url)
                    } catch (err: any) {
                      alert(t('files.makePublicFailed', { error: err.message || String(err) }))
                    } finally {
                      setMakingPublic(false)
                    }
                  }}
                  className="w-full text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-950/30 dark:border-blue-900/50"
                >
                  {makingPublic ? t('files.makingPublic') : t('files.makePublic')}
                </Button>
              )}
            </div>
          )}
        </div>
      </DummyModal>
      <DummyModal open={folderRenameOpen} title={t('files.renameFolderTitle')} description={activeFolderForMenu?.name ?? ''} onClose={() => setFolderRenameOpen(false)}><form onSubmit={renameFolder} className="grid gap-4"><Input value={folderRenameValue} onChange={(event) => setFolderRenameValue(event.target.value)} required /><FolderAppearanceFields color={folderRenameColor} iconUrl={folderRenameIconUrl} onColorChange={setFolderRenameColor} onIconChange={setFolderRenameIconUrl} /><div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => setFolderRenameOpen(false)}>{t('common.cancel')}</Button><Button>{t('action.rename')}</Button></div></form></DummyModal>
      <DummyModal open={folderDeleteOpen} title={t('folderMenu.delete')} description={t('files.deleteFolderDesc', { name: activeFolderForMenu?.name ?? '' })} onClose={() => setFolderDeleteOpen(false)}><div className="flex justify-end gap-3"><Button variant="outline" onClick={() => setFolderDeleteOpen(false)}>{t('common.cancel')}</Button><Button variant="danger" onClick={deleteFolder}>{t('action.delete')}</Button></div></DummyModal>
      <DummyModal open={inviteOpen} title={t('action.invite')} description={t('files.inviteDesc', { name: inviteTargetType === 'file' ? (activeFile?.name ?? t('files.fileWord')) : (activeFolderForMenu?.name ?? t('files.folderWord')) })} onClose={() => setInviteOpen(false)}>
        <form onSubmit={sendInvite} className="grid gap-4">
          <label className="grid gap-2 text-sm font-semibold">{t('files.emailAddress')}<Input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="member@example.com" required /></label>
          <label className="grid gap-2 text-sm font-semibold">{t('files.role')}<select className="h-11 rounded-xl border border-slate-200 px-3 text-sm" value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}><option value="viewer">{t('files.canView')}</option><option value="editor">{t('files.canEdit')}</option></select></label>
          {inviteMessage ? <p className="rounded-xl bg-blue-50 p-3 text-sm font-semibold text-blue-700">{inviteMessage}</p> : null}
          <div className="flex justify-end gap-3 pt-2"><Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>{t('common.cancel')}</Button><Button disabled={inviting}>{inviting ? t('files.sending') : t('files.sendInvite')}</Button></div>
        </form>
      </DummyModal>
      <DummyModal open={previewOpen} title={t('files.previewTitle')} description={activeFile?.name ?? ''} onClose={closePreview} className="overflow-hidden sm:max-w-[95vw] xl:max-w-[1400px]">
        <div className="flex h-[72dvh] w-full items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 sm:h-[80vh]">
          {previewLoading ? <div className="p-6 text-center text-sm font-semibold text-slate-500">{t('files.previewLoading')}</div> : null}
          {previewError ? <div className="p-6 text-center text-sm text-red-600">{previewError}</div> : null}
          {!previewLoading && !previewError && activePreviewKind === 'image' && previewUrl ? <img src={previewUrl} alt={activeFile?.name ?? t('files.previewTitle')} className="max-h-full max-w-full object-contain" onError={() => setPreviewError(t('files.previewFailed'))} /> : null}
          {!previewLoading && !previewError && activePreviewKind === 'video' && previewUrl ? <div className="shared-video-shell"><video ref={previewVideoRef} controls playsInline preload="metadata" onError={() => setPreviewError(t('files.previewFailed'))}><source src={previewUrl} type={activeFile?.mimeType} /></video></div> : null}
          {!previewLoading && !previewError && activePreviewKind === 'document' && previewUrl ? <iframe src={previewUrl} title={activeFile?.name ?? t('files.previewTitle')} className="h-full w-full border-0 bg-white" /> : null}
          {!previewLoading && !previewError && activePreviewKind === 'office' && previewUrl ? <iframe src={officeViewerUrl(previewUrl)} title={activeFile?.name ?? t('files.previewTitle')} className="h-full w-full border-0 bg-white" /> : null}
          {!previewLoading && !previewError && !activePreviewKind ? <div className="p-6 text-center text-sm text-slate-500">{t('files.previewUnavailable')}</div> : null}
        </div>
      </DummyModal>
    </>
  )
}
