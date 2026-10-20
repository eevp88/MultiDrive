import { useEffect, useRef, useState } from 'react'
import { Image as ImageIcon, Play } from 'lucide-react'
import { useAuthedImage } from '@/components/photos/useAuthedImage'
import type { PhotoItem } from '@/components/photos/types'

export function PhotoThumb({ photo, onOpen }: { photo: PhotoItem; onOpen: (photo: PhotoItem) => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [visible, setVisible] = useState(false)
  const { src, failed } = useAuthedImage(photo.id, 320, visible && photo.hasThumbnail)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '300px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <button
      ref={ref}
      type="button"
      title={photo.name}
      onClick={() => onOpen(photo)}
      className="group relative aspect-square overflow-hidden rounded-lg bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {src ? (
        <img src={src} alt={photo.name} className="h-full w-full object-cover transition group-hover:scale-105" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-slate-400">
          <ImageIcon className={failed || !photo.hasThumbnail ? 'h-6 w-6' : 'h-6 w-6 animate-pulse'} />
        </span>
      )}
      {photo.kind === 'video' ? (
        <span className="absolute bottom-1.5 right-1.5 rounded-full bg-slate-950/70 p-1 text-white">
          <Play className="h-3 w-3 fill-current" />
        </span>
      ) : null}
    </button>
  )
}
