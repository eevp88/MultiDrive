export type PhotoItem = {
  id: string
  name: string
  mimeType: string
  kind: 'image' | 'video'
  sizeBytes: string
  provider: string
  displayDate: string
  hasThumbnail: boolean
}

export type PhotosResponse = { files: PhotoItem[]; nextCursor: string | null }
