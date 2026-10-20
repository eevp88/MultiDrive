import { useEffect, useState } from 'react'
import { API_URL } from '@/lib/api'
import { getAccessToken } from '@/lib/auth'

// An <img> cannot send an Authorization header and tokens never go in URLs,
// so the thumbnail is fetched with the Bearer token and shown through an object URL.
export function useAuthedImage(fileId: string, size: number, enabled: boolean) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let objectUrl: string | null = null
    setSrc(null)
    setFailed(false)
    fetch(`${API_URL}/files/${fileId}/thumbnail?size=${size}`, {
      headers: { Authorization: `Bearer ${getAccessToken()}` },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('thumbnail')
        return response.blob()
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') setFailed(true)
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [fileId, size, enabled])

  return { src, failed }
}
