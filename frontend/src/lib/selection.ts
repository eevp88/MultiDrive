// The multi-select rules of the file list, kept free of React so they can be tested on their own.

export type SelectionItem = { type: 'file' | 'folder'; id: string }
export type Selection = { fileIds: Set<string>; folderIds: Set<string> }

export const emptySelection = (): Selection => ({ fileIds: new Set(), folderIds: new Set() })

export function toggleId(current: Set<string>, id: string) {
  const next = new Set(current)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export function selectAll(visibleFileIds: string[], visibleFolderIds: string[]): Selection {
  return { fileIds: new Set(visibleFileIds), folderIds: new Set(visibleFolderIds) }
}

// Header checkbox: selects everything visible, or clears the selection when everything visible is already selected.
export function toggleAll(visibleFileIds: string[], visibleFolderIds: string[], current: Selection): Selection {
  const allSelected = (visibleFileIds.length > 0 || visibleFolderIds.length > 0)
    && visibleFileIds.every((id) => current.fileIds.has(id))
    && visibleFolderIds.every((id) => current.folderIds.has(id))
  return allSelected ? emptySelection() : selectAll(visibleFileIds, visibleFolderIds)
}

// File-manager selection on desktop: click selects one row, Ctrl/Cmd+click toggles it, Shift+click selects a range.
// `order` is the rows as shown (folders first, then files); `anchor` is the row of the last plain or Ctrl click.
export function clickSelection(args: {
  order: SelectionItem[]
  anchor: SelectionItem | null
  item: SelectionItem
  shiftKey: boolean
  ctrlOrMeta: boolean
  current: Selection
}): { selection: Selection; anchor: SelectionItem | null } {
  const { order, anchor, item, shiftKey, ctrlOrMeta, current } = args
  if (shiftKey && anchor) {
    const from = order.findIndex((entry) => entry.type === anchor.type && entry.id === anchor.id)
    const to = order.findIndex((entry) => entry.type === item.type && entry.id === item.id)
    if (from >= 0 && to >= 0) {
      const range = order.slice(Math.min(from, to), Math.max(from, to) + 1)
      return {
        selection: {
          fileIds: new Set(range.filter((entry) => entry.type === 'file').map((entry) => entry.id)),
          folderIds: new Set(range.filter((entry) => entry.type === 'folder').map((entry) => entry.id)),
        },
        anchor,
      }
    }
  }
  const nextAnchor = { type: item.type, id: item.id }
  if (ctrlOrMeta) {
    return {
      selection: item.type === 'file'
        ? { fileIds: toggleId(current.fileIds, item.id), folderIds: current.folderIds }
        : { fileIds: current.fileIds, folderIds: toggleId(current.folderIds, item.id) },
      anchor: nextAnchor,
    }
  }
  return {
    selection: { fileIds: new Set(item.type === 'file' ? [item.id] : []), folderIds: new Set(item.type === 'folder' ? [item.id] : []) },
    anchor: nextAnchor,
  }
}
