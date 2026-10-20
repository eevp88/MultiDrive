import { decryptText, encryptText } from './crypto.js'

// A share link has to be shown again later, so the raw token is kept, but encrypted: a database dump or a read-only
// SQL leak must not hand out working links. Lookups never need it; they use the stored hash.
//
// Encrypted values look like `iv:tag:data`. Raw tokens are base64url and can never contain a colon, which is how the
// two formats are told apart while rows written before encryption still exist.

export function sealShareToken(token: string) {
  return encryptText(token)
}

export function isSealedShareToken(stored: string) {
  return stored.includes(':')
}

// Returns null when the link cannot be rebuilt: no token was stored (shares created before tokens were kept) or the
// value cannot be decrypted (TOKEN_ENCRYPTION_KEY changed).
export function openShareToken(stored: string | null) {
  if (!stored) return null
  if (!isSealedShareToken(stored)) return stored
  try {
    return decryptText(stored)
  } catch {
    return null
  }
}
