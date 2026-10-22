import type { DragEvent } from 'react'
import type { FolderItem } from '@/data/drive-data'

const highlightClasses = ['bg-blue-50/50', 'border-blue-300']

// Lets a file dragged from the list or the grid be dropped on a folder to move it there.
export function folderDropHandlers(folder: FolderItem, onDropItem?: (fileId: string, folderId: string) => void) {
  return {
    onDragOver: (event: DragEvent<HTMLElement>) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' },
    onDragEnter: (event: DragEvent<HTMLElement>) => { event.currentTarget.classList.add(...highlightClasses) },
    onDragLeave: (event: DragEvent<HTMLElement>) => { event.currentTarget.classList.remove(...highlightClasses) },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      event.currentTarget.classList.remove(...highlightClasses)
      const fileId = event.dataTransfer.getData('text/plain')
      if (fileId && folder.id) onDropItem?.(fileId, folder.id)
    },
  }
}
