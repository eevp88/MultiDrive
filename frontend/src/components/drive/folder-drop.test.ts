import { describe, expect, it, vi } from 'vitest'
import type { DragEvent } from 'react'
import { folderDropHandlers } from '@/components/drive/folder-drop'

function dragEvent(data: Record<string, string> = {}) {
  const element = document.createElement('div')
  return {
    event: {
      preventDefault: vi.fn(),
      currentTarget: element,
      dataTransfer: { dropEffect: 'none', getData: (type: string) => data[type] ?? '' },
    } as unknown as DragEvent<HTMLElement>,
    element,
  }
}

describe('folderDropHandlers', () => {
  it('reports the drop as a move to the folder with the dragged file id', () => {
    const onDropItem = vi.fn()
    const { event } = dragEvent({ 'text/plain': 'file-1' })

    folderDropHandlers({ id: 'folder-1', name: 'Docs', updated: '', color: '' }, onDropItem).onDrop(event)

    expect(onDropItem).toHaveBeenCalledWith('file-1', 'folder-1')
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it.each([
    ['nothing was dragged', { id: 'folder-1', name: 'Docs', updated: '', color: '' }, {}],
    ['the folder has no id yet', { name: 'Docs', updated: '', color: '' }, { 'text/plain': 'file-1' }],
  ])('does not report a drop when %s', (_label, folder, data) => {
    const onDropItem = vi.fn()
    folderDropHandlers(folder, onDropItem).onDrop(dragEvent(data).event)
    expect(onDropItem).not.toHaveBeenCalled()
  })

  it('does not fail without a callback', () => {
    expect(() => folderDropHandlers({ id: 'f', name: 'Docs', updated: '', color: '' }).onDrop(dragEvent({ 'text/plain': 'x' }).event)).not.toThrow()
  })

  it('allows the drop with a move effect', () => {
    const { event } = dragEvent()
    folderDropHandlers({ id: 'f', name: 'Docs', updated: '', color: '' }).onDragOver(event)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.dataTransfer.dropEffect).toBe('move')
  })

  it('highlights while dragging over and clears the highlight on leave and on drop', () => {
    const handlers = folderDropHandlers({ id: 'f', name: 'Docs', updated: '', color: '' })
    const { event, element } = dragEvent({ 'text/plain': 'x' })

    handlers.onDragEnter(event)
    expect(element).toHaveClass('bg-blue-50/50', 'border-blue-300')
    handlers.onDragLeave(event)
    expect(element).not.toHaveClass('bg-blue-50/50')

    handlers.onDragEnter(event)
    handlers.onDrop(event)
    expect(element).not.toHaveClass('border-blue-300')
  })
})
