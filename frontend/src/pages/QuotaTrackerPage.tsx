import { useEffect, useState } from 'react'
import { CheckCircle, Cloud, Database, Filter, Gauge, Link2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/drive/PageHeader'
import { apiFetch, formatBytes } from '@/lib/api'
import { connectUrlPath, providerName, type ConnectableProvider } from '@/lib/providers'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n/I18nProvider'

type StorageSummary = { totalBytes: string; usedBytes: string; availableBytes: string }
type ConnectedAccount = { id: string; email: string; displayName?: string | null; provider: string; status: string; storageAccount?: { totalBytes: string | null; usedBytes: string; availableBytes: string | null; lastSyncedAt: string | null } | null }
type RoutingMode = 'most_available' | 'round_robin' | 'priority'
type RoutingPolicy = { mode: RoutingMode; priorityAccountIds: string[]; roundRobinCursor: number }

type Translate = ReturnType<typeof useI18n>['t']

function providerLabel(provider: string, t: Translate) {
  return providerName(provider, t('settings.s3Name'))
}

function ProviderIcon({ provider }: { provider: string }) {
  const Icon = provider === 's3' ? Database : Cloud
  return <Icon className="h-6 w-6" />
}

function storageLimitLabel(account: ConnectedAccount, t: Translate) {
  if (account.provider === 's3' && account.storageAccount?.totalBytes === null) return t('settings.unlimited')
  return formatBytes(account.storageAccount?.totalBytes)
}

function availableLabel(account: ConnectedAccount, t: Translate) {
  if (account.provider === 's3' && account.storageAccount?.availableBytes === null) return t('settings.unlimited')
  return formatBytes(account.storageAccount?.availableBytes)
}

function pct(account: ConnectedAccount) {
  const total = Number(account.storageAccount?.totalBytes ?? 0)
  const used = Number(account.storageAccount?.usedBytes ?? 0)
  return total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
}

function statusColor(percent: number) {
  if (percent >= 80) return 'bg-red-500 text-red-600'
  if (percent >= 50) return 'bg-yellow-400 text-yellow-600'
  return 'bg-emerald-500 text-emerald-600'
}

export function QuotaTrackerPage() {
  const { t, translateError } = useI18n()
  const [summary, setSummary] = useState<StorageSummary | null>(null)
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  const [routingPolicy, setRoutingPolicy] = useState<RoutingPolicy>({ mode: 'most_available', priorityAccountIds: [], roundRobinCursor: 0 })
  const [message, setMessage] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null)

  async function load() {
    const [summaryData, accountData, policyData] = await Promise.all([
      apiFetch<StorageSummary>('/storage/summary'),
      apiFetch<{ accounts: ConnectedAccount[] }>('/connected-accounts'),
      apiFetch<{ policy: RoutingPolicy }>('/storage/routing-policy'),
    ])
    setSummary(summaryData)
    setAccounts(accountData.accounts)
    setRoutingPolicy(policyData.policy)
  }

  async function refresh() {
    setRefreshing(true)
    try {
      await load()
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    load().catch((error) => setMessage(translateError(error, 'quota.loadFailed')))
  }, [])

  useEffect(() => {
    if (!autoRefresh) return
    const timer = window.setInterval(() => load().catch(() => undefined), 35_000)
    return () => window.clearInterval(timer)
  }, [autoRefresh])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.data?.type !== 'GOOGLE_CONNECTED') return
      const oneDrive = event.data.provider === 'onedrive'
      setMessage(event.data.status === 'success' ? t(oneDrive ? 'settings.oneDriveConnected' : 'settings.driveConnected') : t(oneDrive ? 'settings.oneDriveConnectFailed' : 'settings.driveConnectFailed'))
      load().catch(() => undefined)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [t])

  async function connectDrive(provider: ConnectableProvider = 'google') {
    const popup = window.open('', 'google-drive-connect', 'width=540,height=720')
    if (popup) {
      popup.document.write(`<html><head><title>${t('settings.popupTitle')}</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc;color:#64748b;}</style></head><body><div style="text-align:center;"><h2>${provider === 'onedrive' ? t('settings.popupHeadingMicrosoft') : t('settings.popupHeading')}</h2><p>${t('settings.popupWait')}</p></div></body></html>`)
    }
    try {
      const data = await apiFetch<{ url: string }>(connectUrlPath(provider))
      if (popup) {
        popup.location.href = data.url
      } else {
        window.location.href = data.url
      }
    } catch (e) {
      if (popup) popup.close()
      console.error('Failed to start Google Drive connection from Quota Tracker', e)
    }
  }

  async function sync(accountId: string) {
    setSyncingAccountId(accountId)
    try {
      await apiFetch(`/connected-accounts/${accountId}/sync-quota`, { method: 'POST' })
      await load()
    } finally {
      setSyncingAccountId(null)
    }
  }

  async function saveRoutingPolicy(nextPolicy: RoutingPolicy) {
    setRoutingPolicy(nextPolicy)
    const data = await apiFetch<{ policy: RoutingPolicy }>('/storage/routing-policy', { method: 'PATCH', body: JSON.stringify({ mode: nextPolicy.mode, priorityAccountIds: nextPolicy.priorityAccountIds }) })
    setRoutingPolicy(data.policy)
    setMessage(t('quota.policyUpdated'))
  }

  function orderedAccounts() {
    const byId = new Map(accounts.map((account) => [account.id, account]))
    const ordered = routingPolicy.priorityAccountIds.map((id) => byId.get(id)).filter((account): account is ConnectedAccount => Boolean(account))
    const orderedIds = new Set(ordered.map((account) => account.id))
    return [...ordered, ...accounts.filter((account) => !orderedIds.has(account.id))]
  }

  function moveAccount(accountId: string, direction: -1 | 1) {
    const ids = orderedAccounts().map((account) => account.id)
    const index = ids.indexOf(accountId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= ids.length) return
    const nextIds = [...ids]
    const [item] = nextIds.splice(index, 1)
    nextIds.splice(target, 0, item)
    saveRoutingPolicy({ ...routingPolicy, priorityAccountIds: nextIds }).catch((error) => setMessage(translateError(error, 'quota.policyFailed')))
  }

  return (
    <>
      <PageHeader title={t('nav.quota')} description={t('quota.description')} actions={<><Button variant="outline" onClick={() => setAutoRefresh(!autoRefresh)}><CheckCircle className="h-4 w-4" />{autoRefresh ? t('quota.autoRefreshOn') : t('quota.autoRefreshOff')}</Button><Button variant="outline" onClick={refresh} disabled={refreshing}><RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />{refreshing ? t('quota.refreshing') : t('quota.refresh')}</Button><Button variant="outline" onClick={() => connectDrive('onedrive')}><Link2 className="h-4 w-4" />{t('settings.connectOneDrive')}</Button><Button onClick={() => connectDrive('google')}><Link2 className="h-4 w-4" />{t('settings.connectDrive')}</Button></>} />
      {message ? <p className="mt-5 rounded-xl bg-blue-50 p-3 text-sm text-blue-700">{message}</p> : null}

      <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        <Card className="p-5"><p className="text-sm text-slate-500">{t('quota.totalStorage')}</p><p className="mt-2 text-2xl font-extrabold">{formatBytes(summary?.totalBytes)}</p></Card>
        <Card className="p-5"><p className="text-sm text-slate-500">{t('quota.usedStorage')}</p><p className="mt-2 text-2xl font-extrabold">{formatBytes(summary?.usedBytes)}</p></Card>
        <Card className="p-5"><p className="text-sm text-slate-500">{t('quota.available')}</p><p className="mt-2 text-2xl font-extrabold">{formatBytes(summary?.availableBytes)}</p></Card>
        <Card className="p-5"><p className="text-sm text-slate-500">{t('quota.accounts')}</p><p className="mt-2 text-2xl font-extrabold">{accounts.length}</p></Card>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button variant="outline"><Filter className="h-4 w-4" />{t('quota.allProviders')}</Button>
        <Button variant="outline">{t('filters.allAccounts')}</Button>
        <Button variant="soft"><Gauge className="h-4 w-4" />{t('quota.modeMostAvailable')}</Button>
      </div>

      <Card className="mt-6 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-extrabold">{t('quota.routingTitle')}</h2>
            <p className="mt-1 text-sm text-slate-500">{t('quota.routingDesc')}</p>
          </div>
          <label className="grid gap-2 text-sm font-semibold lg:w-64">{t('quota.routingMode')}<select className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm" value={routingPolicy.mode} onChange={(event) => saveRoutingPolicy({ ...routingPolicy, mode: event.target.value as RoutingMode }).catch((error) => setMessage(translateError(error, 'quota.policyFailed')))}><option value="most_available">{t('quota.modeMostAvailable')}</option><option value="round_robin">{t('quota.modeRoundRobin')}</option><option value="priority">{t('quota.modePriority')}</option></select></label>
        </div>
        <div className="mt-4 grid gap-3">
          {orderedAccounts().map((account, index) => <div key={account.id} className="flex flex-col gap-3 rounded-xl bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-blue-600"><ProviderIcon provider={account.provider} /></div>
              <div><p className="font-semibold">{account.displayName || account.email}</p><p className="text-sm text-slate-500">{providerLabel(account.provider, t)} · {t('sidebar.used', { size: formatBytes(account.storageAccount?.usedBytes) })} · {t('quota.free', { size: availableLabel(account, t) })}</p></div>
            </div>
            <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => moveAccount(account.id, -1)} disabled={index === 0}>{t('quota.up')}</Button><Button variant="outline" size="sm" onClick={() => moveAccount(account.id, 1)} disabled={index === accounts.length - 1}>{t('quota.down')}</Button></div>
          </div>)}
          {accounts.length === 0 ? <p className="text-sm text-slate-500">{t('quota.connectToRoute')}</p> : null}
        </div>
      </Card>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        {accounts.length === 0 ? (
          <Card className="col-span-full p-8 text-center">
            <Cloud className="mx-auto h-10 w-10 text-blue-600" />
            <h2 className="mt-4 text-xl font-extrabold">{t('quota.noDrives')}</h2>
            <p className="mt-2 text-sm text-slate-500">{t('quota.noDrivesDesc')}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button onClick={() => connectDrive('google')}><Link2 className="h-4 w-4" />{t('settings.connectDrive')}</Button>
              <Button variant="outline" onClick={() => connectDrive('onedrive')}><Link2 className="h-4 w-4" />{t('settings.connectOneDrive')}</Button>
            </div>
          </Card>
        ) : accounts.map((account) => {
          const percent = pct(account)
          const color = statusColor(percent)
          return (
            <Card key={account.id} className="overflow-hidden p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white"><ProviderIcon provider={account.provider} /></div>
                  <div><h2 className="font-extrabold">{providerLabel(account.provider, t)}</h2><p className="text-sm text-slate-500">{account.email}</p></div>
                </div>
                <div className="flex gap-2"><Button variant="outline" size="icon" onClick={() => sync(account.id)} disabled={syncingAccountId === account.id}><RefreshCw className={syncingAccountId === account.id ? 'h-5 w-5 animate-spin' : 'h-5 w-5'} /></Button></div>
              </div>
              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 font-semibold"><span className={cn('h-3 w-3 rounded-full', color.split(' ')[0])} />{t('quota.storageLabel')}</span>
                  <span className="font-bold">{percent}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100"><div className={cn('h-full rounded-full', color.split(' ')[0])} style={{ width: `${percent}%` }} /></div>
                <div className="mt-3 flex items-center justify-between text-sm text-slate-500"><span>{formatBytes(account.storageAccount?.usedBytes)} / {storageLimitLabel(account, t)}</span><span>{t('quota.availableAmount', { size: availableLabel(account, t) })}</span></div>
              </div>
            </Card>
          )
        })}
      </div>
    </>
  )
}
