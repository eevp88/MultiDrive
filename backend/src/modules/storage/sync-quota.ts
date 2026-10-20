import { syncGoogleQuota } from '../google/google.service.js'
import { syncMicrosoftQuota } from '../microsoft/microsoft.service.js'
import { syncS3Quota } from '../s3/s3.service.js'

// One place that knows how each provider reports its quota.
export function syncQuotaForAccount(account: { id: string; provider: string }) {
  if (account.provider === 's3') return syncS3Quota(account.id)
  if (account.provider === 'onedrive') return syncMicrosoftQuota(account.id)
  return syncGoogleQuota(account.id)
}
