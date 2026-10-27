import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { UploadProvider, useUpload, type UploadProgressFile, type UploadProgressState } from '@/context/UploadContext'
import { en } from '@/i18n/en'
import { I18nProvider } from '@/i18n/I18nProvider'
import { UploadPanel } from './UploadPanel'

type Controls = ReturnType<typeof useUpload>

// Puts the real provider into a chosen state, so the panel is tested against what the app really renders.
function Seed({ state, onReady }: { state: UploadProgressState; onReady: (controls: Controls) => void }) {
  const controls = useUpload()
  useEffect(() => {
    controls.setUploadProgress(state)
    onReady(controls)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

const row = (overrides: Partial<UploadProgressFile>): UploadProgressFile => ({ id: 'u1', name: 'a.txt', size: 2048, percent: 40, status: 'uploading', ...overrides })
const progress = (files: UploadProgressFile[], overrides: Partial<UploadProgressState> = {}): UploadProgressState => ({ open: true, fileName: files[0]?.name ?? '', percent: files[0]?.percent ?? 0, status: 'uploading', files, ...overrides })

function setup(state: UploadProgressState) {
  localStorage.setItem('multidrive.language', 'en')
  let controls: Controls | undefined
  const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider><UploadProvider>{children}</UploadProvider></I18nProvider>
  const view = render(<><Seed state={state} onReady={(value) => { controls = value }} /><UploadPanel /></>, { wrapper })
  return { ...view, controls: () => controls! }
}

describe('UploadPanel', () => {
  it('renders nothing while the panel is closed', () => {
    const { container } = setup(progress([row({})], { open: false }))
    expect(container).toBeEmptyDOMElement()
  })

  it('shows each file with its name, size, percent and status', () => {
    setup(progress([row({ name: 'a.txt', percent: 40 }), row({ id: 'u2', name: 'b.txt', percent: 0, status: 'queued', size: 0 })]))

    expect(screen.getByText('a.txt')).toBeInTheDocument()
    expect(screen.getByText('40%')).toBeInTheDocument()
    expect(screen.getByText('2.00 KB')).toBeInTheDocument()
    expect(screen.getByText(en['upload.statusUploading'])).toBeInTheDocument()
    expect(screen.getByText(en['upload.statusQueued'])).toBeInTheDocument()
    expect(screen.getByText('0 of 2 files')).toBeInTheDocument()
  })

  it.each([
    ['done', en['upload.complete']],
    ['partial', en['upload.completeWithErrors']],
    ['error', en['upload.failed']],
    ['cancelled', en['upload.cancelled']],
    ['uploading', en['upload.uploadingFiles']],
  ] as const)('titles a %s upload', (status, title) => {
    setup(progress([row({})], { status, percent: 50 }))
    expect(screen.getByText(title)).toBeInTheDocument()
  })

  it('says the server is processing once the bytes are nearly all sent', () => {
    setup(progress([row({ percent: 99 })], { percent: 99 }))
    expect(screen.getByText(en['upload.processingServer'])).toBeInTheDocument()
    expect(screen.getByText(en['upload.statusProcessing'])).toBeInTheDocument()
  })

  it('offers Retry only for failed or cancelled files', () => {
    setup(progress([row({ id: 'u1', status: 'error' }), row({ id: 'u2', status: 'cancelled' }), row({ id: 'u3', status: 'done' }), row({ id: 'u4', status: 'uploading' })]))
    expect(screen.getAllByRole('button', { name: en['upload.retry'] })).toHaveLength(2)
  })

  it('offers a per-file Cancel only for files in progress or waiting', () => {
    setup(progress([row({ id: 'u1', status: 'uploading' }), row({ id: 'u2', status: 'queued' }), row({ id: 'u3', status: 'done' }), row({ id: 'u4', status: 'error' })]))
    expect(screen.getAllByRole('button', { name: en['upload.cancel'] })).toHaveLength(2)
  })

  it('collapses and expands the file list', async () => {
    const user = userEvent.setup()
    setup(progress([row({})]))

    await user.click(screen.getByRole('button', { name: en['upload.togglePanel'] }))
    expect(screen.queryByText('a.txt')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: en['upload.togglePanel'] }))
    expect(screen.getByText('a.txt')).toBeInTheDocument()
  })

  it('closes a finished panel straight away, without asking', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm')
    const { container } = setup(progress([row({ status: 'done', percent: 100 })], { status: 'done' }))

    await user.click(screen.getByRole('button', { name: en['upload.closePanel'] }))

    expect(confirm).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })

  it('asks before closing while files are still uploading, and keeps the panel when declined', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    setup(progress([row({ status: 'uploading' })]))

    await user.click(screen.getByRole('button', { name: en['upload.closePanel'] }))

    expect(confirm).toHaveBeenCalledWith(en['upload.confirmCancel'])
    expect(screen.getByText('a.txt')).toBeInTheDocument()
  })

  it('cancels the uploads and closes when the user confirms', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { container } = setup(progress([row({ id: 'u1', status: 'queued' })]))

    await user.click(screen.getByRole('button', { name: en['upload.closePanel'] }))

    expect(container).toBeEmptyDOMElement()
  })

  it('a per-file Cancel marks a waiting file as cancelled', async () => {
    const user = userEvent.setup()
    setup(progress([row({ id: 'u1', status: 'queued' })]))

    await user.click(screen.getByRole('button', { name: en['upload.cancel'] }))

    expect(within(screen.getByText('a.txt').closest('div')!.parentElement!).getByText(en['upload.statusCancelled'])).toBeInTheDocument()
  })
})
