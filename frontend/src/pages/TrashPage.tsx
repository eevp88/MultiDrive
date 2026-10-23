import { useEffect, useState } from 'react'
import { RotateCcw, Trash2, ShieldAlert, FileText, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/drive/PageHeader'
import { apiFetch, formatBytes, formatDate } from '@/lib/api'
import { useI18n } from '@/i18n/I18nProvider'

type TrashFile = {
  id: string
  name: string
  mimeType: string
  sizeBytes: string
  provider: string
  deletedAt: string
  connectedAccount: {
    email: string
    provider: string
  }
}

export function TrashPage() {
  const { t, translateError, language } = useI18n()
  const [files, setFiles] = useState<TrashFile[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error' | ''>('')

  async function loadTrash() {
    setLoading(true)
    try {
      const data = await apiFetch<{ files: TrashFile[] }>('/files/trash')
      setFiles(data.files)
    } catch (error) {
      setMessage(translateError(error, 'trash.loadFailed'))
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTrash().catch(() => undefined)
  }, [])

  function toggleSelect(id: string) {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  function toggleSelectAll() {
    if (selectedIds.size === files.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(files.map((f) => f.id)))
    }
  }

  async function handleRestore(ids: string[]) {
    if (ids.length === 0) return
    setLoading(true)
    setMessage('')
    try {
      await apiFetch('/files/batch/restore', {
        method: 'POST',
        body: JSON.stringify({ fileIds: ids })
      })
      setFiles((prev) => prev.filter((f) => !ids.includes(f.id)))
      setSelectedIds((prev) => {
        const next = new Set(prev)
        ids.forEach((id) => next.delete(id))
        return next
      })
      setMessage(t('trash.restored', { count: ids.length }))
      setMessageType('success')
      window.dispatchEvent(new Event('multidrive:storage-changed'))
    } catch (error) {
      setMessage(translateError(error, 'trash.restoreFailed'))
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  async function handlePermanentDelete(ids: string[]) {
    if (ids.length === 0) return
    if (!confirm(t('trash.confirmPermanent', { count: ids.length }))) return
    setLoading(true)
    setMessage('')
    try {
      const result = await apiFetch<{ deleted: number; failed: { fileId: string }[] }>('/files/batch/permanent', {
        method: 'DELETE',
        body: JSON.stringify({ fileIds: ids })
      })
      // The backend answers 200 even when only some files could be deleted: keep the ones that failed in the list.
      const failedIds = new Set(result.failed.map((item) => item.fileId))
      const removedIds = ids.filter((id) => !failedIds.has(id))
      setFiles((prev) => prev.filter((f) => !removedIds.includes(f.id)))
      setSelectedIds((prev) => {
        const next = new Set(prev)
        removedIds.forEach((id) => next.delete(id))
        return next
      })
      if (failedIds.size > 0) {
        setMessage(t('trash.deletedPartial', { count: result.deleted, failed: failedIds.size }))
        setMessageType('error')
      } else {
        setMessage(t('trash.deleted', { count: result.deleted }))
        setMessageType('success')
      }
      window.dispatchEvent(new Event('multidrive:storage-changed'))
    } catch (error) {
      setMessage(translateError(error, 'trash.deleteFailed'))
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <PageHeader
        title={t('nav.trash')}
        description={t('trash.description')}
        actions={
          selectedIds.size > 0 ? (
            <>
              <Button variant="outline" onClick={() => handleRestore(Array.from(selectedIds))} disabled={loading}>
                <RotateCcw className="h-4 w-4" /> {t('trash.restoreSelected', { count: selectedIds.size })}
              </Button>
              <Button variant="danger" onClick={() => handlePermanentDelete(Array.from(selectedIds))} disabled={loading}>
                <Trash2 className="h-4 w-4" /> {t('trash.deleteSelected', { count: selectedIds.size })}
              </Button>
            </>
          ) : null
        }
      />

      {message ? (
        <p
          className={`mt-5 rounded-xl p-3 text-sm flex items-center gap-2 ${
            messageType === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {messageType === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
          {message}
        </p>
      ) : null}

      <Card className="mt-8 overflow-hidden">
        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <Trash2 className="h-12 w-12 text-slate-400 mb-3" />
            <p className="text-base font-bold">{t('trash.empty')}</p>
            <p className="text-sm text-slate-500 mt-1">{t('trash.emptyHint')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-sm font-semibold text-slate-500">
                  <th className="p-4 w-12">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === files.length && files.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-slate-300"
                    />
                  </th>
                  <th className="p-4">{t('table.name')}</th>
                  <th className="p-4">{t('trash.account')}</th>
                  <th className="p-4">{t('table.size')}</th>
                  <th className="p-4">{t('trash.deletedAt')}</th>
                  <th className="p-4 text-right">{t('trash.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition">
                    <td className="p-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(file.id)}
                        onChange={() => toggleSelect(file.id)}
                        className="rounded border-slate-300"
                      />
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 text-slate-400 shrink-0" />
                        <span className="font-medium truncate max-w-xs sm:max-w-md block" title={file.name}>
                          {file.name}
                        </span>
                      </div>
                    </td>
                    <td className="p-4 text-sm text-slate-500">
                      {file.connectedAccount.email} ({file.provider})
                    </td>
                    <td className="p-4 text-sm font-semibold">{formatBytes(file.sizeBytes)}</td>
                    <td className="p-4 text-sm text-slate-500">
                      {formatDate(file.deletedAt, language)}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRestore([file.id])}
                          disabled={loading}
                          title={t('trash.restore')}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handlePermanentDelete([file.id])}
                          disabled={loading}
                          title={t('trash.deletePermanently')}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
