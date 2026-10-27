import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseExifTime } from './exif-time.js'

describe('parseExifTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('reads an EXIF date as UTC', () => {
    expect(parseExifTime('2024:06:17 09:58:36')?.toISOString()).toBe('2024-06-17T09:58:36.000Z')
  })

  it('accepts a T separator and ignores trailing offsets', () => {
    expect(parseExifTime('2024:06:17T09:58:36+02:00')?.toISOString()).toBe('2024-06-17T09:58:36.000Z')
  })

  it.each([null, undefined, '', 'not a date', '2024-06-17 09:58:36', '2024:06:17'])('returns null for %s', (value) => {
    expect(parseExifTime(value as string | null | undefined)).toBeNull()
  })

  it('returns null for the junk cameras write', () => {
    expect(parseExifTime('0000:00:00 00:00:00')).toBeNull()
    expect(parseExifTime('1899:12:31 23:59:59')).toBeNull()
  })

  it('returns null for impossible parts instead of rolling them over', () => {
    expect(parseExifTime('2024:13:01 00:00:00')).toBeNull()
    expect(parseExifTime('2024:02:30 00:00:00')).toBeNull()
    expect(parseExifTime('2024:06:17 25:00:00')).toBeNull()
    expect(parseExifTime('2024:06:17 10:61:00')).toBeNull()
  })

  it('accepts a leap day only in a leap year', () => {
    expect(parseExifTime('2024:02:29 10:00:00')).not.toBeNull()
    expect(parseExifTime('2023:02:29 10:00:00')).toBeNull()
  })

  it('returns null for dates more than a day in the future', () => {
    expect(parseExifTime('2026:10:24 11:00:00')).not.toBeNull()
    expect(parseExifTime('2026:10:25 12:00:01')).toBeNull()
  })
})
