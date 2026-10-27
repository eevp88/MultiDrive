import { describe, expect, it } from 'vitest'
import { contentDisposition, effectiveDisposition } from './content-disposition.js'

describe('contentDisposition', () => {
  it('uses a plain filename for ASCII names', () => {
    expect(contentDisposition('attachment', 'report.pdf')).toBe('attachment; filename="report.pdf"')
    expect(contentDisposition('inline', 'photo.png')).toBe('inline; filename="photo.png"')
  })

  it('adds an ASCII fallback and an RFC 5987 name for accented names', () => {
    const header = contentDisposition('attachment', 'Presentación ñandú.pdf')
    expect(header).toContain('filename="Presentaci_n _and_.pdf"')
    expect(header).toContain("filename*=UTF-8''Presentaci%C3%B3n%20%C3%B1and%C3%BA.pdf")
  })

  it('only ever produces header-safe ASCII', () => {
    // A non-ASCII byte in a header value makes Node throw ERR_INVALID_CHAR, which was the original 500.
    expect(contentDisposition('attachment', '日本語.txt')).toMatch(/^[\x20-\x7e]+$/)
  })

  it('drops double quotes so the name cannot close the quoted string', () => {
    expect(contentDisposition('attachment', 'a"b.txt')).toBe('attachment; filename="ab.txt"')
  })

  it('percent-encodes the characters encodeURIComponent leaves alone', () => {
    const header = contentDisposition('attachment', "é'(x)*.txt")
    expect(header).toContain("%27%28x%29%2A.txt")
  })
})

describe('effectiveDisposition', () => {
  it.each([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/heic',
    'video/mp4',
    'audio/mpeg',
    'application/pdf',
    'text/plain',
    'text/plain; charset=utf-8',
    'IMAGE/PNG',
    '  application/pdf ',
  ])('keeps inline for %s', (mime) => {
    expect(effectiveDisposition('inline', mime)).toBe('inline')
  })

  it.each([
    'text/html',
    'image/svg+xml',
    'application/xhtml+xml',
    'text/xml',
    'application/xml',
    'application/javascript',
    'application/octet-stream',
    'application/x-shockwave-flash',
    '',
  ])('forces a download for %s', (mime) => {
    expect(effectiveDisposition('inline', mime)).toBe('attachment')
  })

  it('never turns an attachment request into inline', () => {
    expect(effectiveDisposition('attachment', 'image/png')).toBe('attachment')
    expect(effectiveDisposition('attachment', 'text/html')).toBe('attachment')
  })
})
