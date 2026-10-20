import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useAuthedImage } from '@/components/photos/useAuthedImage'
import type { PhotoItem } from '@/components/photos/types'
import { API_URL, apiFetch } from '@/lib/api'
import { useI18n } from '@/i18n/I18nProvider'

function VideoPlayer({ photo }: { photo: PhotoItem }) {
  const { t, translateError } = useI18n()
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setUrl(null)
    setError('')
    apiFetch<{ path?: string; url: string }>(`/files/${photo.id}/preview-token`, { method: 'POST' })
      .then((data) => {
        if (active) setUrl(`${API_URL}${data.path ?? new URL(data.url).pathname}`)
      })
      .catch((err) => {
        if (active) setError(translateError(err, 'photos.failedOpen'))
      })
    return () => { active = false }
  }, [photo.id, translateError])

  if (error) return <p className="text-sm text-white">{error}</p>
  if (!url) return <p className="text-sm text-white/70">{t('photos.loading')}</p>
  return <video src={url} controls autoPlay className="max-h-full max-w-full" />
}

function LargeImage({ photo }: { photo: PhotoItem }) {
  const { t } = useI18n()
  // Browsers cannot render HEIF, and Drive serves the thumbnail as JPEG at any size.
  const { src, failed } = useAuthedImage(photo.id, 2048, photo.hasThumbnail)
  if (failed || !photo.hasThumbnail) return <p className="text-sm text-white">{t('photos.noPreview')}</p>
  if (!src) return <p className="text-sm text-white/70">{t('photos.loading')}</p>
  return <img src={src} alt={photo.name} className="max-h-full max-w-full object-contain" />
}

export function PhotoViewer({ photos, index, onChange, onClose }: {
  photos: PhotoItem[]
  index: number
  onChange: (index: number) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const photo = photos[index]
  const hasPrev = index > 0
  const hasNext = index < photos.length - 1

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft' && hasPrev) onChange(index - 1)
      if (event.key === 'ArrowRight' && hasNext) onChange(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, hasPrev, hasNext, onChange, onClose])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/95" role="dialog" aria-modal="true" aria-label={photo.name}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <p className="min-w-0 truncate text-sm font-semibold">{photo.name}</p>
        <button type="button" onClick={onClose} aria-label={t('common.close')} className="rounded-full p-2 hover:bg-white/10">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        {hasPrev ? (
          <button type="button" onClick={() => onChange(index - 1)} aria-label={t('photos.previous')} className="absolute left-2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
            <ChevronLeft className="h-6 w-6" />
          </button>
        ) : null}
        {photo.kind === 'video' ? <VideoPlayer photo={photo} /> : <LargeImage photo={photo} />}
        {hasNext ? (
          <button type="button" onClick={() => onChange(index + 1)} aria-label={t('photos.next')} className="absolute right-2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
            <ChevronRight className="h-6 w-6" />
          </button>
        ) : null}
      </div>
    </div>
  )
}
