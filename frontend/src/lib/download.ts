// Reads the file name the server chose (RFC 6266 / 5987), so an exported Google Doc keeps its .pdf extension.
export function fileNameFromContentDisposition(header: string | null) {
  if (!header) return null
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header)
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim())
    } catch {
      // Fall through to the plain filename.
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"/i.exec(header) ?? /filename\s*=\s*([^;]+)/i.exec(header)
  return plain ? plain[1].trim() : null
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoking right after click() can cut the download short in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
