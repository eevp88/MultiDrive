import { describe, expect, it } from 'vitest'
import { getPreviewKind, isSpreadsheetMimeType, officeViewerUrl } from '@/lib/preview'

describe('getPreviewKind', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['image/png', 'image'],
    ['application/vnd.google-apps.drawing', 'image'],
    ['video/mp4', 'video'],
    ['application/pdf', 'document'],
    ['application/vnd.google-apps.document', 'document'],
    ['application/vnd.google-apps.spreadsheet', 'document'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'office'],
    ['application/vnd.ms-excel', 'office'],
    ['application/zip', null],
    ['text/plain', null],
  ])('maps %j to %j', (mimeType, expected) => {
    expect(getPreviewKind(mimeType)).toBe(expected)
  })
})

describe('officeViewerUrl', () => {
  it('encodes the file URL so its own query string cannot leak into the viewer URL', () => {
    const url = officeViewerUrl('https://api.test/files/preview/abc?x=1&y=2')
    expect(url).toBe('https://view.officeapps.live.com/op/embed.aspx?src=https%3A%2F%2Fapi.test%2Ffiles%2Fpreview%2Fabc%3Fx%3D1%26y%3D2')
  })
})

describe('isSpreadsheetMimeType', () => {
  it.each([
    ['application/vnd.google-apps.spreadsheet', true],
    ['application/vnd.ms-excel', true],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', true],
    ['application/pdf', false],
    [undefined, false],
  ])('%j -> %s', (mimeType, expected) => {
    expect(isSpreadsheetMimeType(mimeType)).toBe(expected)
  })
})
