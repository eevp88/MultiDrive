// The app used to be called 9Drive and prefixed its browser storage keys with `9drive`.
// Move those values to the `multidrive` prefix once, so nobody is signed out or loses preferences.
const LEGACY_PREFIX = /^9drive([.:])/

export function migrateLegacyStorageKeys() {
  try {
    for (const key of Object.keys(localStorage)) {
      const match = LEGACY_PREFIX.exec(key)
      if (!match) continue
      const value = localStorage.getItem(key)
      const nextKey = key.replace(LEGACY_PREFIX, `multidrive${match[1]}`)
      if (value !== null && localStorage.getItem(nextKey) === null) localStorage.setItem(nextKey, value)
      localStorage.removeItem(key)
    }
  } catch {
    // Storage can be blocked; the app then simply starts with defaults.
  }
}
