import { File, FileArchive, FileCode, FileImage, FileMusic, FilePlay, FileSpreadsheet, FileText, Presentation, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FileItem } from '@/data/drive-data'

const spreadsheetMimeTypes = ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.google-apps.spreadsheet', 'application/vnd.oasis.opendocument.spreadsheet', 'text/csv']
const presentationMimeTypes = ['application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.google-apps.presentation', 'application/vnd.oasis.opendocument.presentation']
const documentMimeTypes = ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.google-apps.document', 'application/vnd.oasis.opendocument.text', 'application/rtf']
const archiveMimeTypes = ['application/zip', 'application/x-zip-compressed', 'application/x-rar-compressed', 'application/vnd.rar', 'application/x-7z-compressed', 'application/x-tar', 'application/gzip']

const spreadsheetExtensions = ['xls', 'xlsx', 'ods', 'csv']
const presentationExtensions = ['ppt', 'pptx', 'odp']
const documentExtensions = ['doc', 'docx', 'odt', 'rtf']
const archiveExtensions = ['zip', 'rar', '7z', 'tar', 'gz']
const codeExtensions = ['tex', 'md', 'json', 'js', 'ts', 'tsx', 'jsx', 'html', 'css', 'py', 'sh', 'sql', 'xml', 'yml', 'yaml']

function fileVisual(kind: FileItem['kind'], mimeType = '', name = ''): { Icon: LucideIcon; color: string } {
  const extension = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : ''
  if (kind === 'image' || mimeType.startsWith('image/') || mimeType === 'application/vnd.google-apps.drawing') return { Icon: FileImage, color: 'bg-rose-500' }
  if (kind === 'video' || mimeType.startsWith('video/')) return { Icon: FilePlay, color: 'bg-orange-500' }
  if (mimeType.startsWith('audio/')) return { Icon: FileMusic, color: 'bg-purple-500' }
  if (kind === 'pdf' || mimeType === 'application/pdf' || extension === 'pdf') return { Icon: FileText, color: 'bg-red-500' }
  if (spreadsheetMimeTypes.includes(mimeType) || spreadsheetExtensions.includes(extension)) return { Icon: FileSpreadsheet, color: 'bg-emerald-600' }
  if (presentationMimeTypes.includes(mimeType) || presentationExtensions.includes(extension)) return { Icon: Presentation, color: 'bg-amber-500' }
  if (documentMimeTypes.includes(mimeType) || documentExtensions.includes(extension)) return { Icon: FileText, color: 'bg-blue-500' }
  if (archiveMimeTypes.includes(mimeType) || archiveExtensions.includes(extension)) return { Icon: FileArchive, color: 'bg-slate-500' }
  if (mimeType.startsWith('text/') || codeExtensions.includes(extension)) return { Icon: FileCode, color: 'bg-sky-500' }
  return { Icon: File, color: 'bg-slate-400' }
}

export function FileIcon({ kind, mimeType, name, className }: { kind: FileItem['kind']; mimeType?: string; name?: string; className?: string }) {
  const { Icon, color } = fileVisual(kind, mimeType, name)
  return <Icon className={cn('h-4 w-4 rounded-sm p-0.5 text-white', color, className)} />
}
