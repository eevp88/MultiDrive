import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/drive/PageHeader'
import { PhotoThumb } from '@/components/photos/PhotoThumb'
import { PhotoViewer } from '@/components/photos/PhotoViewer'
import type { PhotoItem, PhotosResponse } from '@/components/photos/types'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'
import { useI18n } from '@/i18n/I18nProvider'

const PAGE_SIZE = 60

function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
  if (!keys.includes(event.key)) return
  const thumbs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-photo-thumb]'))
  const current = thumbs.indexOf(document.activeElement as HTMLElement)
  if (current < 0) return
  event.preventDefault()
  let target: HTMLElement | undefined
  if (event.key === 'ArrowLeft') target = thumbs[current - 1]
  else if (event.key === 'ArrowRight') target = thumbs[current + 1]
  else {
    // Up and down: the closest thumbnail in the nearest row above or below, by horizontal position.
    const from = thumbs[current].getBoundingClientRect()
    const down = event.key === 'ArrowDown'
    const others = thumbs
      .map((node) => ({ node, rect: node.getBoundingClientRect() }))
      .filter(({ rect }) => (down ? rect.top > from.top + 1 : rect.top < from.top - 1))
    if (others.length) {
      const rowTop = down ? Math.min(...others.map(({ rect }) => rect.top)) : Math.max(...others.map(({ rect }) => rect.top))
      target = others
        .filter(({ rect }) => Math.abs(rect.top - rowTop) < 1)
        .sort((a, b) => Math.abs(a.rect.left - from.left) - Math.abs(b.rect.left - from.left))[0]?.node
    }
  }
  target?.focus()
  target?.scrollIntoView({ block: 'nearest' })
}

export function PhotosPage() {
  const { t, translateError, language } = useI18n()
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const load = useCallback(async (after: string | null) => {
    setLoading(true)
    setMessage('')
    try {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE) })
      if (after) query.set('cursor', after)
      const data = await apiFetch<PhotosResponse>(`/photos?${query}`)
      setPhotos((current) => (after ? [...current, ...data.files] : data.files))
      setCursor(data.nextCursor)
    } catch (error) {
      setMessage(translateError(error, 'photos.failedLoad'))
    } finally {
      setLoading(false)
    }
  }, [translateError])

  useEffect(() => { void load(null) }, [load])

  const groups = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric' })
    const result: Array<{ label: string; items: Array<{ photo: PhotoItem; index: number }> }> = []
    photos.forEach((photo, index) => {
      const text = formatter.format(new Date(photo.displayDate))
      const label = text.charAt(0).toUpperCase() + text.slice(1)
      const last = result[result.length - 1]
      if (last?.label === label) last.items.push({ photo, index })
      else result.push({ label, items: [{ photo, index }] })
    })
    return result
  }, [photos, language])

  return (
    <div className="pb-10" onKeyDown={openIndex === null ? moveFocus : undefined}>
      <PageHeader title={t('photos.title')} description={t('photos.subtitle')} />
      {message ? <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{message}</p> : null}
      {!loading && photos.length === 0 && !message ? (
        <p className="mt-10 text-center text-sm text-slate-500">{t('photos.empty')}</p>
      ) : null}
      {groups.map((group) => (
        <section key={group.label} className="mt-6">
          <h2 className="mb-2 text-sm font-bold text-slate-700">{group.label}</h2>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
            {group.items.map(({ photo, index }) => (
              <PhotoThumb key={photo.id} photo={photo} onOpen={() => setOpenIndex(index)} />
            ))}
          </div>
        </section>
      ))}
      {cursor ? (
        <div className="mt-6 flex justify-center">
          <Button type="button" variant="outline" disabled={loading} onClick={() => void load(cursor)}>
            {loading ? t('photos.loading') : t('photos.loadMore')}
          </Button>
        </div>
      ) : null}
      {openIndex !== null && photos[openIndex] ? (
        <PhotoViewer photos={photos} index={openIndex} onChange={setOpenIndex} onClose={() => setOpenIndex(null)} />
      ) : null}
    </div>
  )
}
