import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileNameFromContentDisposition, saveBlob } from '@/lib/download'

describe('fileNameFromContentDisposition', () => {
  it.each([
    [null, null],
    ['', null],
    ['attachment', null],
    ['attachment; filename="report.pdf"', 'report.pdf'],
    ['attachment; filename=report.pdf', 'report.pdf'],
    ['attachment; filename=report.pdf; size=3', 'report.pdf'],
    ["attachment; filename*=UTF-8''Informe%20t%C3%A9cnico.pdf", 'Informe técnico.pdf'],
    ['attachment; filename="fallback.pdf"; filename*=UTF-8\'\'real%20name.pdf', 'real name.pdf'],
    ["attachment; filename*=UTF-8''bad%E0%A4%A.pdf; filename=\"plain.pdf\"", 'plain.pdf'],
  ])('reads %j as %j', (header, expected) => {
    expect(fileNameFromContentDisposition(header)).toBe(expected)
  })
})

describe('saveBlob', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('clicks a temporary link with the file name, removes it, and revokes the URL later', () => {
    vi.useFakeTimers()
    const createObjectURL = vi.fn(() => 'blob:fake')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('a.txt')
      expect(this.href).toBe('blob:fake')
    })

    saveBlob(new Blob(['x']), 'a.txt')

    expect(click).toHaveBeenCalledTimes(1)
    expect(document.querySelector('a[download]')).toBeNull()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10_000)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  })
})
