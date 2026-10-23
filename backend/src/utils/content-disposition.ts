export function contentDisposition(type: 'inline' | 'attachment', fileName: string) {
  const name = fileName.replaceAll('"', '')
  const asciiName = name.replace(/[^\x20-\x7e]/g, '_')
  if (asciiName === name) return `${type}; filename="${name}"`
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${type}; filename="${asciiName}"; filename*=UTF-8''${encoded}`
}

// Types a browser shows without running anything. A file of any other type (HTML, SVG, XML, scripts...) is only ever sent as
// a download: shown inline it would run in the origin of the API, which is the origin of the app when both share a domain,
// with access to what the app keeps in the browser. SVG is not listed on purpose; an <img> still draws it.
const inlineSafeMimeType = /^(image\/(png|jpe?g|gif|webp|avif|bmp|heic|heif|x-icon|vnd\.microsoft\.icon)|video\/[\w.+-]+|audio\/[\w.+-]+|application\/pdf|text\/plain)\s*(;.*)?$/i

export function effectiveDisposition(requested: 'inline' | 'attachment', mimeType: string) {
  return requested === 'inline' && !inlineSafeMimeType.test(mimeType.trim()) ? 'attachment' : requested
}
