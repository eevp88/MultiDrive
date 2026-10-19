import { CalendarClock, Database, Folder, HardDrive, Mail, Tag, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatBytes, formatDate } from '@/lib/api'
import type { FileItem } from '@/data/drive-data'
import { useI18n } from '@/i18n/I18nProvider'

function DetailRow({ icon: Icon, label, value }: { icon: typeof Tag; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-3">
      <Icon className="mt-0.5 h-4 w-4 text-blue-600" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="mt-1 break-words text-sm font-semibold text-slate-700">{value}</p>
      </div>
    </div>
  )
}

export function FileDetailsDrawer({ open, file, onClose }: { open: boolean; file: FileItem | null; onClose: () => void }) {
  const { t, language } = useI18n()
  return (
    <>
      <button className={open ? 'fixed inset-0 z-40 bg-slate-950/30' : 'pointer-events-none fixed inset-0 z-40 bg-slate-950/0'} aria-label={t('details.close')} onClick={onClose} />
      <aside className={open ? 'fixed right-0 top-0 z-50 h-full w-full max-w-md translate-x-0 border-l border-slate-200 bg-white shadow-2xl transition-transform duration-300' : 'fixed right-0 top-0 z-50 h-full w-full max-w-md translate-x-full border-l border-slate-200 bg-white shadow-2xl transition-transform duration-300'}>
        <div className="flex items-center justify-between border-b border-slate-200 p-5">
          <div>
            <h2 className="text-xl font-extrabold">{t('details.title')}</h2>
            <p className="mt-1 max-w-[18rem] truncate text-sm text-slate-500">{file?.name ?? t('details.noFile')}</p>
          </div>
          <Button variant="outline" size="icon" onClick={onClose} aria-label={t('details.close')}><X className="h-5 w-5" /></Button>
        </div>
        {file ? (
          <div className="grid gap-3 p-5">
            <DetailRow icon={Tag} label={t('details.name')} value={file.name} />
            <DetailRow icon={Database} label={t('details.size')} value={file.sizeBytes ? formatBytes(file.sizeBytes) : file.size} />
            <DetailRow icon={CalendarClock} label={t('details.uploadedAt')} value={file.createdAt ? formatDate(file.createdAt, language) : file.date} />
            <DetailRow icon={Mail} label={t('details.account')} value={file.accountEmail ?? file.access} />
            <DetailRow icon={HardDrive} label={t('details.provider')} value={file.accountProvider ?? 'google_drive'} />
            <DetailRow icon={Folder} label={t('details.folder')} value={file.folderName ?? t('details.noFolder')} />
            <DetailRow icon={Tag} label={t('details.mime')} value={file.mimeType ?? t('details.unknown')} />
          </div>
        ) : null}
      </aside>
    </>
  )
}
