import { FolderOpen, MoreVertical, Star } from 'lucide-react'
import { type MouseEvent, useState } from 'react'
import { AvatarStack } from '@/components/drive/AvatarStack'
import { FileIcon } from '@/components/drive/FileIcon'
import { FolderVisual } from '@/components/drive/FolderVisual'
import type { FileItem, FolderItem } from '@/data/drive-data'
import { apiFetch } from '@/lib/api'
import { useI18n } from '@/i18n/I18nProvider'

const dropHighlightClasses = ['bg-blue-50/50', 'border-blue-300']

export function FileTable({ files, folders = [], mode = 'default', selectedFileIds = new Set<string>(), selectedFolderIds = new Set<string>(), allSelected = false, onFileContextMenu, onToggleFile, onToggleFolder, onToggleAll, onRowClick, onFolderOpen, onFolderMenu, onDropItem }: { files: FileItem[]; folders?: FolderItem[]; mode?: 'default' | 'shared' | 'recent' | 'starred' | 'archived'; selectedFileIds?: Set<string>; selectedFolderIds?: Set<string>; allSelected?: boolean; onFileContextMenu?: (event: MouseEvent<HTMLElement>, file: FileItem) => void; onToggleFile?: (file: FileItem) => void; onToggleFolder?: (folder: FolderItem) => void; onToggleAll?: () => void; onRowClick?: (item: { type: 'file' | 'folder'; id?: string }, event: MouseEvent<HTMLElement>) => void; onFolderOpen?: (folder: FolderItem) => void; onFolderMenu?: (event: MouseEvent<HTMLElement>, folder: FolderItem) => void; onDropItem?: (fileId: string, folderId: string) => void }) {
  const { t } = useI18n()
  const [copiedFileId, setCopiedFileId] = useState<string | null>(null)

  function folderDropHandlers(folder: FolderItem) {
    return {
      onDragOver: (event: React.DragEvent<HTMLElement>) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' },
      onDragEnter: (event: React.DragEvent<HTMLElement>) => { event.currentTarget.classList.add(...dropHighlightClasses) },
      onDragLeave: (event: React.DragEvent<HTMLElement>) => { event.currentTarget.classList.remove(...dropHighlightClasses) },
      onDrop: (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault()
        event.currentTarget.classList.remove(...dropHighlightClasses)
        const fileId = event.dataTransfer.getData('text/plain')
        if (fileId && folder.id) onDropItem?.(fileId, folder.id)
      },
    }
  }

  return (
    <div className="mt-4">
      {/* Mobile card view */}
      <div className="grid gap-2.5 sm:hidden">
        {onToggleAll ? (
          <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold shadow-sm">
            <span>{t('table.selectAll')}</span>
            <input type="checkbox" className="h-5 w-5 accent-blue-600" checked={allSelected} onChange={onToggleAll} />
          </label>
        ) : null}
        {folders.map((folder) => (
          <article key={`folder-${folder.id ?? folder.name}`} onClick={() => onFolderOpen?.(folder)} onContextMenu={(event) => onFolderMenu?.(event, folder)} {...folderDropHandlers(folder)} className={selectedFolderIds.has(folder.id ?? '') ? 'cursor-pointer overflow-hidden rounded-2xl border file-selected p-3.5 shadow-sm' : 'cursor-pointer overflow-hidden rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm'}>
            <div className="flex items-center gap-3">
              {onToggleFolder ? <input type="checkbox" className="h-4 w-4 shrink-0 accent-blue-600" checked={selectedFolderIds.has(folder.id ?? '')} onChange={() => onToggleFolder(folder)} onClick={(event) => event.stopPropagation()} /> : null}
              <FolderVisual folder={folder} className="h-5 w-5 shrink-0" />
              <div className="min-w-0 flex-1 overflow-hidden">
                <h3 className="truncate text-sm font-bold leading-snug text-slate-950" title={folder.name}>{folder.name}</h3>
                <div className="mt-1 text-xs text-slate-400">{folder.updated}</div>
              </div>
              <button className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100" onClick={(event) => { event.stopPropagation(); onFolderMenu?.(event, folder) }} aria-label={t('table.openMenu', { name: folder.name })}><MoreVertical className="h-4 w-4" /></button>
            </div>
          </article>
        ))}
        {files.map((file) => {
          const selected = selectedFileIds.has(file.id ?? '')
          const meta = mode === 'archived' ? file.location : mode === 'recent' ? file.openedDate : mode === 'starred' ? file.starredDate : file.date
          return (
            <article key={file.id ?? file.name} draggable onDragStart={(event) => { event.dataTransfer.setData('text/plain', file.id ?? ''); event.dataTransfer.effectAllowed = 'move' }} onClick={() => onToggleFile?.(file)} onContextMenu={(event) => onFileContextMenu?.(event, file)} className={selected ? 'overflow-hidden rounded-2xl border file-selected p-3.5 shadow-sm cursor-grab active:cursor-grabbing' : 'overflow-hidden rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm cursor-grab active:cursor-grabbing'}>
              <div className="flex items-center gap-3">
                {onToggleFile ? <input type="checkbox" className="h-4 w-4 shrink-0 accent-blue-600" checked={selected} onChange={() => onToggleFile?.(file)} onClick={(event) => event.stopPropagation()} /> : null}
                <div className="shrink-0">{mode === 'starred' ? <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" /> : <FileIcon kind={file.kind} mimeType={file.mimeType} name={file.name} />}</div>
                <div className="min-w-0 flex-1 overflow-hidden">
                  <h3 className="truncate text-sm font-bold leading-snug text-slate-950" title={file.name}>{file.name}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                    <span>{meta}</span>
                    <span>·</span>
                    <span>{file.size}</span>
                    {file.folderName && <><span>·</span><span className="flex items-center gap-0.5 text-blue-500"><FolderOpen className="h-3 w-3" />{file.folderName}</span></>}
                  </div>
                </div>
                <button className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100" onClick={(event) => { event.stopPropagation(); onFileContextMenu?.(event, file) }} aria-label={t('table.openMenu', { name: file.name })}><MoreVertical className="h-4 w-4" /></button>
              </div>
            </article>
          )
        })}
      </div>

      {/* Desktop table view */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200/20 text-slate-950">
              <th className="py-2.5 font-extrabold">{t('table.name')}</th>
              {mode === 'default' ? <th className="py-2.5 font-extrabold text-slate-500 font-semibold">{t('table.folder')}</th> : null}
              {mode === 'shared' ? <th className="py-2.5 font-extrabold">{t('table.owner')}</th> : null}
              {mode === 'recent' ? <th className="py-2.5 font-extrabold">{t('table.lastOpened')}</th> : null}
              {mode === 'starred' ? <th className="py-2.5 font-extrabold">{t('table.starredOn')}</th> : null}
              {mode === 'archived' ? <th className="py-2.5 font-extrabold">{t('table.archivedDate')}</th> : null}
              {mode === 'archived' ? <th className="py-2.5 font-extrabold">{t('table.originalLocation')}</th> : <th className="py-2.5 font-extrabold">{t('table.lastModified')}</th>}
              <th className="py-2.5 font-extrabold">{t('table.size')}</th>
              <th className="py-2.5 font-extrabold">{t('table.access')}</th>
              <th className="py-2.5" />
            </tr>
          </thead>
          <tbody>
            {folders.map((folder) => (
              <tr key={`folder-${folder.id ?? folder.name}`} onClick={(event) => (onRowClick ? onRowClick({ type: 'folder', id: folder.id }, event) : onToggleFolder?.(folder))} onDoubleClick={() => onFolderOpen?.(folder)} onContextMenu={(event) => onFolderMenu?.(event, folder)} {...folderDropHandlers(folder)} className={selectedFolderIds.has(folder.id ?? '') ? 'group border-b file-selected transition hover:bg-orange-500/15 cursor-pointer select-none' : 'group border-b border-slate-200/10 transition hover:bg-slate-100 cursor-pointer select-none'}>
                <td className="py-2.5 font-semibold">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <FolderVisual folder={folder} className="h-5 w-5 shrink-0" />
                    <span className="truncate max-w-[200px] lg:max-w-[280px]" title={folder.name}>{folder.name}</span>
                  </span>
                </td>
                {mode === 'default' ? <td className="py-2.5"><span className="text-xs text-slate-300">—</span></td> : null}
                <td className="py-2.5 text-slate-500">{folder.updated}</td>
                <td className="py-2.5 text-slate-500">—</td>
                <td className="py-2.5" />
                <td className="py-2.5 text-right">
                  <button className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 shrink-0 ml-auto" onClick={(event) => { event.stopPropagation(); onFolderMenu?.(event, folder) }} aria-label={t('table.openMenu', { name: folder.name })}><MoreVertical className="h-4 w-4" /></button>
                </td>
              </tr>
            ))}
            {files.map((file) => (
              <tr key={file.id ?? file.name} draggable onDragStart={(event) => { event.dataTransfer.setData('text/plain', file.id ?? ''); event.dataTransfer.effectAllowed = 'move' }} onContextMenu={(event) => onFileContextMenu?.(event, file)} onClick={(event) => (onRowClick ? onRowClick({ type: 'file', id: file.id }, event) : onToggleFile?.(file))} className={selectedFileIds.has(file.id ?? '') ? 'group border-b file-selected transition hover:bg-orange-500/15 cursor-grab active:cursor-grabbing select-none' : 'group border-b border-slate-200/10 transition hover:bg-slate-100 cursor-grab active:cursor-grabbing select-none'}>
                <td className="py-2.5 font-semibold">
                  <span className="flex min-w-0 items-center gap-2.5">
                    {mode === 'starred' ? <Star className="h-4 w-4 shrink-0 fill-yellow-400 text-yellow-400" /> : <FileIcon kind={file.kind} mimeType={file.mimeType} name={file.name} />}
                    <span className="truncate max-w-[200px] lg:max-w-[280px]" title={file.name}>{file.name}</span>
                  </span>
                </td>
                {/* Folder path column — only in default mode */}
                {mode === 'default' ? (
                  <td className="py-2.5 text-slate-400">
                    {file.folderName ? (
                      <span className="flex items-center gap-1 text-xs font-medium text-blue-500">
                        <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate max-w-[120px]">{file.folderName}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                ) : null}
                {mode === 'shared' ? <td className="py-2.5 text-slate-500">{file.owner}</td> : null}
                {mode === 'recent' ? <td className="py-2.5 text-slate-500">{file.openedDate}</td> : null}
                {mode === 'starred' ? <td className="py-2.5 text-slate-500">{file.starredDate}</td> : null}
                {mode === 'archived' ? <td className="py-2.5 text-slate-500">{file.archivedDate}</td> : null}
                <td className="py-2.5 text-slate-500">{mode === 'archived' ? file.location : file.date}</td>
                <td className="py-2.5 text-slate-500">{file.size}</td>
                <td className="py-2.5 text-slate-500"><span className="flex items-center gap-2"><AvatarStack count={file.shared} />{file.access}</span></td>
                <td className="py-2.5 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {/* Hover shortcuts */}
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex gap-1.5">
                      <button
                        title={t('action.copyLink')}
                        onClick={async (event) => {
                          event.stopPropagation()
                          try {
                            const data = await apiFetch<{ url: string | null }>(`/files/${file.id}/view-url`)
                            if (data.url) {
                              await navigator.clipboard.writeText(data.url)
                              setCopiedFileId(file.id ?? null)
                              setTimeout(() => setCopiedFileId(null), 2000)
                            } else {
                              const shareData = await apiFetch<{ url: string }>(`/files/${file.id}/share`, { method: 'POST' })
                              await navigator.clipboard.writeText(shareData.url)
                              setCopiedFileId(file.id ?? null)
                              setTimeout(() => setCopiedFileId(null), 2000)
                            }
                          } catch { /* ignore */ }
                        }}
                        className={
                          copiedFileId === file.id
                            ? "inline-flex h-7 px-2 items-center justify-center rounded-lg text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-all scale-95"
                            : "inline-flex h-7 px-2 items-center justify-center rounded-lg text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors"
                        }
                      >
                        {copiedFileId === file.id ? t('table.copied') : t('action.copyLink')}
                      </button>
                      <button
                        title={t('table.moveFile')}
                        onClick={(event) => {
                          event.stopPropagation()
                          window.dispatchEvent(new CustomEvent('multidrive:open-move-modal', { detail: file }))
                        }}
                        className="inline-flex h-7 px-2 items-center justify-center rounded-lg text-[11px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                      >
                        {t('table.move')}
                      </button>
                    </div>
                    <button className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 shrink-0" onClick={(event) => { event.stopPropagation(); onFileContextMenu?.(event, file) }} aria-label={t('table.openMenu', { name: file.name })}><MoreVertical className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
