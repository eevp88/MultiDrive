import { describe, expect, it } from 'vitest'
import { clickSelection, emptySelection, selectAll, toggleAll, toggleId, type Selection, type SelectionItem } from '@/lib/selection'

const folder = (id: string): SelectionItem => ({ type: 'folder', id })
const file = (id: string): SelectionItem => ({ type: 'file', id })
// The list as the page shows it: folders first, then files.
const order = [folder('d1'), folder('d2'), file('f1'), file('f2'), file('f3')]
const sel = (fileIds: string[] = [], folderIds: string[] = []): Selection => ({ fileIds: new Set(fileIds), folderIds: new Set(folderIds) })
const click = (item: SelectionItem, options: { anchor?: SelectionItem | null; shift?: boolean; ctrl?: boolean; current?: Selection } = {}) =>
  clickSelection({ order, anchor: options.anchor ?? null, item, shiftKey: options.shift ?? false, ctrlOrMeta: options.ctrl ?? false, current: options.current ?? emptySelection() })

describe('toggleId', () => {
  it('adds a missing id and removes a present one, without touching the original set', () => {
    const original = new Set(['a'])
    expect([...toggleId(original, 'b')]).toEqual(['a', 'b'])
    expect([...toggleId(original, 'a')]).toEqual([])
    expect([...original]).toEqual(['a'])
  })
})

describe('selectAll and toggleAll', () => {
  it('selectAll picks every visible row', () => {
    expect(selectAll(['f1', 'f2'], ['d1'])).toEqual(sel(['f1', 'f2'], ['d1']))
  })

  it('toggleAll selects everything visible when something is missing', () => {
    expect(toggleAll(['f1', 'f2'], ['d1'], sel(['f1'], []))).toEqual(sel(['f1', 'f2'], ['d1']))
  })

  it('toggleAll clears when everything visible is already selected', () => {
    expect(toggleAll(['f1', 'f2'], ['d1'], sel(['f1', 'f2'], ['d1']))).toEqual(emptySelection())
  })

  it('toggleAll ignores selected rows that are no longer visible when judging "all selected"', () => {
    expect(toggleAll(['f1'], [], sel(['f1', 'gone'], ['old']))).toEqual(emptySelection())
  })

  it('toggleAll over an empty list stays empty instead of reporting everything selected', () => {
    expect(toggleAll([], [], emptySelection())).toEqual(emptySelection())
  })

  it('toggleAll counts a folder-only list as visible', () => {
    expect(toggleAll([], ['d1'], emptySelection())).toEqual(sel([], ['d1']))
  })
})

describe('clickSelection', () => {
  it('a plain click selects just that row and drops the rest, files and folders alike', () => {
    const result = click(file('f2'), { current: sel(['f1'], ['d1']) })
    expect(result.selection).toEqual(sel(['f2'], []))
    expect(result.anchor).toEqual(file('f2'))
    expect(click(folder('d2'), { current: sel(['f1'], ['d1']) }).selection).toEqual(sel([], ['d2']))
  })

  it('Ctrl/Cmd+click toggles that row and keeps the other kind of selection', () => {
    const added = click(file('f2'), { ctrl: true, current: sel(['f1'], ['d1']) })
    expect(added.selection).toEqual(sel(['f1', 'f2'], ['d1']))
    expect(added.anchor).toEqual(file('f2'))
    expect(click(file('f1'), { ctrl: true, current: sel(['f1'], ['d1']) }).selection).toEqual(sel([], ['d1']))
    expect(click(folder('d2'), { ctrl: true, current: sel(['f1'], ['d1']) }).selection).toEqual(sel(['f1'], ['d1', 'd2']))
  })

  it('Shift+click selects the range from the anchor, in either direction, across folders and files', () => {
    expect(click(file('f1'), { shift: true, anchor: folder('d2') }).selection).toEqual(sel(['f1'], ['d2']))
    expect(click(folder('d1'), { shift: true, anchor: file('f2') }).selection).toEqual(sel(['f1', 'f2'], ['d1', 'd2']))
  })

  it('Shift+click replaces the previous selection and keeps the anchor for the next range', () => {
    const result = click(file('f3'), { shift: true, anchor: file('f2'), current: sel(['f1'], ['d1']) })
    expect(result.selection).toEqual(sel(['f2', 'f3'], []))
    expect(result.anchor).toEqual(file('f2'))
  })

  it('Shift+click without an anchor behaves like a plain click and sets the anchor', () => {
    const result = click(file('f2'), { shift: true })
    expect(result.selection).toEqual(sel(['f2'], []))
    expect(result.anchor).toEqual(file('f2'))
  })

  it('Shift+click with an anchor that left the list falls back to a plain click', () => {
    const result = click(file('f2'), { shift: true, anchor: file('gone'), current: sel(['f1'], []) })
    expect(result.selection).toEqual(sel(['f2'], []))
    expect(result.anchor).toEqual(file('f2'))
  })

  it('Shift+Ctrl+click with a usable anchor still selects the range', () => {
    expect(click(file('f2'), { shift: true, ctrl: true, anchor: file('f1') }).selection).toEqual(sel(['f1', 'f2'], []))
  })

  it('does not change the selection it was given', () => {
    const current = sel(['f1'], ['d1'])
    click(file('f2'), { ctrl: true, current })
    click(file('f2'), { current })
    expect(current).toEqual(sel(['f1'], ['d1']))
  })
})
