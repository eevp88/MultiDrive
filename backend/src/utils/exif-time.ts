// Drive reports `imageMediaMetadata.time` as an EXIF date, "YYYY:MM:DD HH:MM:SS", with no time zone. It is read as UTC, so the
// instant can be off by the camera's offset, which is fine for grouping a gallery by day or month.
// Cameras also write junk such as "0000:00:00 00:00:00" or a date in the future; those return null so the caller falls back to created_at.
export function parseExifTime(value: string | null | undefined): Date | null {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value ?? '')
  if (!match) return null
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number)
  if (year < 1900) return null
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  // Date.UTC rolls impossible parts over (month 13, day 40, hour 25), so compare them back.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  if (date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) return null
  if (date.getTime() > Date.now() + 24 * 60 * 60 * 1000) return null
  return date
}
