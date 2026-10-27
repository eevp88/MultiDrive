import { CheckCircle, ChevronDown, Upload, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useUpload } from '@/context/UploadContext'
import { useI18n } from '@/i18n/I18nProvider'
import { formatBytes } from '@/lib/api'
import { cn } from '@/lib/utils'

// The floating panel that shows the progress of every file being uploaded, with retry, cancel and close.
export function UploadPanel() {
  const { t } = useI18n()
  const { uploadProgress, setUploadProgress, retryFailedUpload, cancelUpload } = useUpload()
  const [collapsed, setCollapsed] = useState(false)

  if (!uploadProgress.open) return null

  return (
    <div className="fixed inset-x-3 bottom-3 z-[70] max-h-[70dvh] overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-2xl shadow-slate-900/20 backdrop-blur-2xl dark:border-slate-800 dark:bg-slate-900/95 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[min(420px,calc(100vw-2.5rem))]">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2 font-extrabold text-sm text-slate-950">
          {uploadProgress.status === 'done' ? <CheckCircle className="h-5 w-5 text-emerald-500" /> : uploadProgress.status === 'partial' || uploadProgress.status === 'error' ? <X className="h-5 w-5 text-red-500" /> : uploadProgress.status === 'cancelled' ? <X className="h-5 w-5 text-slate-400" /> : <Upload className="h-5 w-5 text-blue-600" />}
          {uploadProgress.status === 'done' ? t('upload.complete') : uploadProgress.status === 'partial' ? t('upload.completeWithErrors') : uploadProgress.status === 'error' ? t('upload.failed') : uploadProgress.status === 'cancelled' ? t('upload.cancelled') : uploadProgress.percent >= 99 ? t('upload.processingServer') : t('upload.uploadingFiles')}
          {uploadProgress.files.length > 1 ? <span className="shrink-0 text-xs font-semibold text-slate-500">{t('upload.progressCount', { done: uploadProgress.files.filter((file) => file.status === 'done').length, total: uploadProgress.files.length })}</span> : null}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('upload.togglePanel')} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}><ChevronDown className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('upload.closePanel')} onClick={() => {
            const active = uploadProgress.files.some((file) => file.status === 'uploading' || file.status === 'queued')
            if (active) {
              if (!window.confirm(t('upload.confirmCancel'))) return
              cancelUpload()
            }
            setUploadProgress((current) => ({ ...current, open: false }))
          }}><X className="h-4 w-4" /></Button>
        </div>
      </div>
      {!collapsed && (
        <div className="p-4">
          {uploadProgress.files.length > 0 ? (
            <div className="grid max-h-64 gap-3 overflow-y-auto pr-1 text-slate-950">
              {uploadProgress.files.map((file) => (
                <div key={file.id} className="grid gap-1 rounded-xl bg-slate-50 p-3">
                  <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
                    <p className="min-w-0 flex-1 truncate font-semibold" title={file.name}>{file.name}</p>
                    <span className="shrink-0 text-xs text-slate-500">{file.percent}%</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                    <span>{formatBytes(file.size)}</span>
                    <div className="flex items-center gap-2">
                      {(file.status === 'error' || file.status === 'cancelled') && (
                        <Button variant="default" className="h-6 px-2 text-[11px] font-extrabold text-white bg-blue-600 hover:bg-blue-700 shadow-none border-none" onClick={() => retryFailedUpload(file.id)}>
                          {t('upload.retry')}
                        </Button>
                      )}
                      {(file.status === 'uploading' || file.status === 'queued') && (
                        <Button variant="ghost" className="h-6 px-2 text-[11px] font-extrabold" onClick={() => cancelUpload(file.id)}>
                          {t('upload.cancel')}
                        </Button>
                      )}
                      <span className={file.status === 'error' ? 'font-semibold text-red-600' : file.status === 'done' ? 'font-semibold text-emerald-600' : file.status === 'cancelled' || file.status === 'queued' ? 'font-semibold text-slate-500' : 'font-semibold text-blue-600'}>
                        {file.status === 'error' ? t('upload.statusFailed') : file.status === 'done' ? t('upload.statusDone') : file.status === 'cancelled' ? t('upload.statusCancelled') : file.status === 'queued' ? t('upload.statusQueued') : file.percent >= 99 ? t('upload.statusProcessing') : t('upload.statusUploading')}
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-200">
                    <div className={file.status === 'error' ? 'h-full rounded-full bg-red-500' : file.status === 'done' ? 'h-full rounded-full bg-emerald-500' : file.status === 'cancelled' ? 'h-full rounded-full bg-slate-400' : 'h-full rounded-full bg-blue-600'} style={{ width: `${file.percent}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
