export type ConnectableProvider = 'google' | 'onedrive'

// Display name of a storage provider. S3 accounts use a translated name, so the caller passes it in.
export function providerName(provider: string | undefined, s3Name = 'S3 Storage') {
  if (provider === 's3') return s3Name
  if (provider === 'onedrive') return 'OneDrive'
  return 'Google Drive'
}

export function connectUrlPath(provider: ConnectableProvider) {
  return provider === 'onedrive' ? '/connected-accounts/onedrive/connect-url' : '/connected-accounts/google/connect-url'
}
