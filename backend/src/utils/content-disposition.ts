export function contentDisposition(type: 'inline' | 'attachment', fileName: string) {
  const name = fileName.replaceAll('"', '')
  const asciiName = name.replace(/[^\x20-\x7e]/g, '_')
  if (asciiName === name) return `${type}; filename="${name}"`
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${type}; filename="${asciiName}"; filename*=UTF-8''${encoded}`
}
