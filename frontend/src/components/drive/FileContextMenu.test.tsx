import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { FileItem } from '@/data/drive-data'
import { en } from '@/i18n/en'
import { renderWithI18n } from '@/test/render'
import { FileContextMenu } from './FileContextMenu'

const file: FileItem = { id: 'f1', name: 'report.pdf', date: 'today', size: '2.00 MB', access: 'Private', kind: 'pdf', shared: 0, folderName: 'Taxes' }

function setup(overrides: Partial<FileItem> | null = {}) {
  const handlers = { onClose: vi.fn(), onView: vi.fn(), onDownload: vi.fn(), onRename: vi.fn(), onMove: vi.fn(), onDetails: vi.fn(), onShare: vi.fn(), onCopyLink: vi.fn(), onInvite: vi.fn(), onDelete: vi.fn() }
  const view = renderWithI18n(<FileContextMenu x={50} y={50} file={overrides === null ? null : { ...file, ...overrides }} {...handlers} />)
  return { handlers, ...view }
}

describe('FileContextMenu', () => {
  it('renders nothing without a file', () => {
    const { container } = setup(null)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the file name, size and folder', () => {
    setup()
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    expect(screen.getByText('2.00 MB')).toBeInTheDocument()
    expect(screen.getByText('Taxes')).toBeInTheDocument()
  })

  it('shows the root label when the file is not in a folder', () => {
    setup({ folderName: null })
    expect(screen.getByText(en['fileMenu.root'])).toBeInTheDocument()
  })

  it.each([
    ['action.preview', 'onView'],
    ['action.download', 'onDownload'],
    ['action.rename', 'onRename'],
    ['action.move', 'onMove'],
    ['action.details', 'onDetails'],
    ['action.shareLink', 'onShare'],
    ['action.copyLink', 'onCopyLink'],
    ['action.invite', 'onInvite'],
    ['action.delete', 'onDelete'],
  ] as const)('runs only %s -> %s when clicked', async (labelKey, handlerName) => {
    const user = userEvent.setup()
    const { handlers } = setup()

    await user.click(screen.getByRole('button', { name: new RegExp(`^${en[labelKey]}`) }))

    for (const [name, handler] of Object.entries(handlers)) {
      expect(handler).toHaveBeenCalledTimes(name === handlerName ? 1 : 0)
    }
  })

  it('closes from the backdrop', async () => {
    const user = userEvent.setup()
    const { handlers } = setup()

    await user.click(screen.getByRole('button', { name: en['fileMenu.close'] }))

    expect(handlers.onClose).toHaveBeenCalledTimes(1)
  })
})
