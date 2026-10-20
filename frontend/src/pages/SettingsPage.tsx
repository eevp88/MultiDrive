import { useEffect, useState, useRef, type FormEvent } from 'react'
import { Bell, Cloud, Database, Globe, HardDrive, Link2, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DummyModal } from '@/components/drive/DummyModal'
import { PageHeader } from '@/components/drive/PageHeader'
import { apiFetch, formatBytes } from '@/lib/api'
import { getGravatarUrl } from '@/lib/gravatar'
import { getStoredUser } from '@/lib/auth'
import { useI18n } from '@/i18n/I18nProvider'

type ConnectedAccount = { id: string; provider: string; email: string; displayName?: string | null; status: string; storageAccount?: { totalBytes: string | null; usedBytes: string; availableBytes: string | null; lastSyncedAt: string | null } | null }

type Translate = ReturnType<typeof useI18n>['t']

function providerLabel(provider: string, t: Translate) {
  if (provider === 's3') return t('settings.s3Name')
  return 'Google Drive'
}

function storageLimitLabel(account: ConnectedAccount, t: Translate) {
  if (account.provider === 's3' && account.storageAccount?.totalBytes === null) return t('settings.unlimited')
  return formatBytes(account.storageAccount?.totalBytes)
}

function availableLabel(account: ConnectedAccount, t: Translate) {
  if (account.provider === 's3' && account.storageAccount?.availableBytes === null) return t('settings.unlimited')
  return formatBytes(account.storageAccount?.availableBytes)
}

export function SettingsPage() {
  const { t, translateError } = useI18n()
  const user = getStoredUser()
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  // Instance-wide controls (OAuth credentials, updates, backups) are backend-restricted to admins; this only hides them.
  const [isAdmin, setIsAdmin] = useState(user?.role === 'admin')
  const [message, setMessage] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [s3Open, setS3Open] = useState(false)
  const [connectingS3, setConnectingS3] = useState(false)
  const [s3Form, setS3Form] = useState({ name: '', bucket: '', region: 'us-east-1', endpoint: '', accessKeyId: '', secretAccessKey: '', forcePathStyle: false, quotaBytes: '' })
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null)
  const [disconnectingAccountId, setDisconnectingAccountId] = useState<string | null>(null)
  const [accountToDisconnect, setAccountToDisconnect] = useState<ConnectedAccount | null>(null)
  const [profileImageUrl, setProfileImageUrl] = useState('')
  const [avatarError, setAvatarError] = useState(false)
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [updatingSystem, setUpdatingSystem] = useState(false)
  const [updateModalOpen, setUpdateModalOpen] = useState(false)
  const [updateModalTitle, setUpdateModalTitle] = useState('')

  // Google OAuth Config states
  const [googleClientId, setGoogleClientId] = useState('')
  const [googleClientSecret, setGoogleClientSecret] = useState('')
  const [googleRedirectUri, setGoogleRedirectUri] = useState('')
  const [defaultRedirectUri, setDefaultRedirectUri] = useState('')
  const [hasSecret, setHasSecret] = useState(false)
  const [savingGoogleConfig, setSavingGoogleConfig] = useState(false)
  const [showGoogleHelp, setShowGoogleHelp] = useState(false)

  // Live log polling states
  const [isPollingLog, setIsPollingLog] = useState(false)
  const [updateLog, setUpdateLog] = useState('')
  const [updateFinished, setUpdateFinished] = useState(false)
  const [updateSuccess, setUpdateSuccess] = useState<boolean | null>(null)
  const [reconnectCount, setReconnectCount] = useState(0)
  const logContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isPollingLog) return

    let intervalId: any
    let active = true

    async function fetchLog() {
      try {
        const data = await apiFetch<{ log: string }>('/system/update-log')
        if (!active) return

        setUpdateLog(data.log)
        setReconnectCount(0)

        if (data.log.includes('=== System Update Completed:')) {
          setUpdateFinished(true)
          setUpdateSuccess(true)
          setIsPollingLog(false)
          setUpdateModalTitle(t('settings.updateStatusDone'))
        }
      } catch (err) {
        if (!active) return
        setReconnectCount((prev) => prev + 1)
      }
    }

    fetchLog()
    intervalId = setInterval(fetchLog, 2000)

    return () => {
      active = false
      clearInterval(intervalId)
    }
  }, [isPollingLog])

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [updateLog])

  async function runSystemUpdate() {
    setUpdatingSystem(true)
    setMessage('')
    setUpdateLog(t('settings.updateInit') + '\n')
    setUpdateFinished(false)
    setUpdateSuccess(null)
    setReconnectCount(0)
    setUpdateModalTitle(t('settings.updateStatusUpdating'))
    setUpdateModalOpen(true)

    try {
      await apiFetch<{ message: string }>('/system/update', { method: 'POST' })
      setIsPollingLog(true)
    } catch (error) {
      setUpdateModalTitle(t('settings.updateStatusFailed'))
      const errMsg = translateError(error, 'settings.updateInitFailed')
      setUpdateLog((prev) => prev + '\n' + t('settings.updateError', { error: errMsg }))
      setUpdateFinished(true)
      setUpdateSuccess(false)
    } finally {
      setUpdatingSystem(false)
    }
  }

  async function saveGoogleConfig(event: FormEvent) {
    event.preventDefault()
    setSavingGoogleConfig(true)
    setMessage('')
    try {
      const res = await apiFetch<{ message: string }>('/system/google-config', {
        method: 'POST',
        body: JSON.stringify({
          clientId: googleClientId,
          clientSecret: googleClientSecret || undefined,
          redirectUri: googleRedirectUri || defaultRedirectUri,
        }),
      })
      setMessage(res.message || t('settings.googleSaved'))
      setHasSecret(true)
      setGoogleClientSecret('')
    } catch (error) {
      setMessage(translateError(error, 'settings.googleSaveFailed'))
    } finally {
      setSavingGoogleConfig(false)
    }
  }

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? accounts[0] ?? null

  async function load() {
    const data = await apiFetch<{ accounts: ConnectedAccount[] }>('/connected-accounts')
    setAccounts(data.accounts)

    const me = await apiFetch<{ user: { role?: string } }>('/auth/me').catch(() => null)
    const admin = me?.user.role === 'admin'
    setIsAdmin(admin)
    if (!admin) return

    try {
      const configData = await apiFetch<{ exists: boolean; clientId: string; redirectUri: string; hasSecret: boolean; defaultRedirectUri: string }>('/system/google-config')
      if (configData.exists) {
        setGoogleClientId(configData.clientId || '')
        setGoogleRedirectUri(configData.redirectUri || '')
        setHasSecret(configData.hasSecret || false)
      }
      setDefaultRedirectUri(configData.defaultRedirectUri || '')
    } catch (e) {
      console.error('Failed to load global Google config', e)
    }
  }

  useEffect(() => {
    load().catch((error) => setMessage(translateError(error, 'settings.loadFailed')))
  }, [])

  useEffect(() => {
    setAvatarError(false)
    getGravatarUrl(user?.email, 96).then(setProfileImageUrl).catch(() => setProfileImageUrl(''))
  }, [user?.email])

  useEffect(() => {
    if (accounts.length === 0) {
      setSelectedAccountId('')
      return
    }
    if (!accounts.some((account) => account.id === selectedAccountId)) setSelectedAccountId(accounts[0].id)
  }, [accounts, selectedAccountId])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.data?.type !== 'GOOGLE_CONNECTED') return
      setMessage(event.data.status === 'success' ? t('settings.driveConnected') : t('settings.driveConnectFailed'))
      load().then(() => {
        window.dispatchEvent(new Event('9drive:storage-changed'))
      }).catch(() => undefined)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [t])

  async function connectDrive() {
    setConnecting(true)
    setMessage('')
    const popup = window.open('', 'google-drive-connect', 'width=540,height=720')
    if (popup) {
      popup.document.write(`<html><head><title>${t('settings.popupTitle')}</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc;color:#64748b;}</style></head><body><div style="text-align:center;"><h2>${t('settings.popupHeading')}</h2><p>${t('settings.popupWait')}</p></div></body></html>`)
    }
    try {
      const data = await apiFetch<{ url: string }>('/connected-accounts/google/connect-url')
      if (popup) {
        popup.location.href = data.url
      } else {
        window.location.href = data.url
      }
    } catch (error) {
      if (popup) popup.close()
      setMessage(translateError(error, 'settings.driveStartFailed'))
    } finally {
      setConnecting(false)
    }
  }

  async function sync(accountId: string) {
    setSyncingAccountId(accountId)
    try {
      await apiFetch(`/connected-accounts/${accountId}/sync-quota`, { method: 'POST' })
      await load()
      window.dispatchEvent(new Event('9drive:storage-changed'))
    } finally {
      setSyncingAccountId(null)
    }
  }

  async function disconnect() {
    if (!accountToDisconnect) return
    setDisconnectingAccountId(accountToDisconnect.id)
    setMessage('')
    try {
      await apiFetch(`/connected-accounts/${accountToDisconnect.id}`, { method: 'DELETE' })
      setAccountToDisconnect(null)
      setMessage(t('settings.disconnected'))
      await load()
      window.dispatchEvent(new Event('9drive:storage-changed'))
    } catch (error) {
      setMessage(translateError(error, 'settings.disconnectFailed'))
    } finally {
      setDisconnectingAccountId(null)
    }
  }

  async function connectS3(event: FormEvent) {
    event.preventDefault()
    setConnectingS3(true)
    setMessage('')
    try {
      await apiFetch('/connected-accounts/s3', { method: 'POST', body: JSON.stringify({ ...s3Form, endpoint: s3Form.endpoint || undefined, quotaBytes: s3Form.quotaBytes || null }) })
      setS3Open(false)
      setS3Form({ name: '', bucket: '', region: 'us-east-1', endpoint: '', accessKeyId: '', secretAccessKey: '', forcePathStyle: false, quotaBytes: '' })
      setMessage(t('settings.s3Connected'))
      await load()
      window.dispatchEvent(new Event('9drive:storage-changed'))
    } catch (error) {
      setMessage(translateError(error, 'settings.s3ConnectFailed'))
    } finally {
      setConnectingS3(false)
    }
  }

  return (
    <>
      <PageHeader title={t('nav.settings')} description={t('settings.description')} actions={<><Button variant="outline" size="sm" onClick={() => setS3Open(true)}><Database className="h-4 w-4" />{t('settings.connectS3')}</Button><Button size="sm" onClick={connectDrive} disabled={connecting}><Link2 className="h-4 w-4" />{connecting ? t('settings.connecting') : t('settings.connectDrive')}</Button></>} />
      {message ? <p className="mt-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-700">{message}</p> : null}
      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="grid gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-3.5">
              {!profileImageUrl || avatarError ? (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-lg font-bold text-white shadow-sm border border-blue-400/20 sm:h-14 sm:w-14">
                  {(user?.name ?? user?.email ?? 'U').trim().charAt(0).toUpperCase()}
                </div>
              ) : (
                <img
                  src={profileImageUrl}
                  alt={t('sidebar.avatarAlt')}
                  className="h-12 w-12 rounded-xl object-cover sm:h-14 sm:w-14"
                  onError={() => setAvatarError(true)}
                />
              )}
              <div className="flex-1"><h2 className="text-lg font-bold">{user?.name ?? t('sidebar.userFallback')}</h2><p className="text-xs text-slate-500 mt-0.5">{user?.email ?? '-'}</p></div>
            </div>
          </Card>

          <Card className="overflow-hidden p-3.5">
            <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2.5"><Cloud className="h-5 w-5 text-blue-600" /><h2 className="text-[16px] font-bold">Google Drive</h2></div>
                <p className="mt-1 text-[13px] text-slate-500">{t('settings.driveDesc')}</p>
              </div>
              <Button className="w-full sm:w-32" size="sm" onClick={connectDrive} disabled={connecting}><Link2 className="h-4 w-4" />{connecting ? t('settings.opening') : t('settings.connectDrive')}</Button>
            </div>
          </Card>

          <Card className="overflow-hidden p-3.5">
            <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2.5"><Database className="h-5 w-5 text-blue-600" /><h2 className="text-[16px] font-bold">{t('settings.s3Title')}</h2></div>
                <p className="mt-1 text-[13px] text-slate-500">{t('settings.s3Desc')}</p>
              </div>
              <Button className="w-full sm:w-32" size="sm" variant="outline" onClick={() => setS3Open(true)}><Database className="h-4 w-4" />{t('settings.connectS3')}</Button>
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="text-[16px] font-bold">{t('settings.connectedTitle')}</h2>
            <div className="mt-3.5 grid gap-3">
              {accounts.length === 0 ? <p className="text-xs text-slate-500">{t('settings.noAccounts')}</p> : <>
                <label className="grid gap-1.5 text-xs font-semibold text-slate-500">{t('settings.chooseAccount')}<select className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none" value={selectedAccount?.id ?? ''} onChange={(event) => setSelectedAccountId(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{providerLabel(account.provider, t)} - {account.displayName || account.email} ({account.status})</option>)}</select></label>
                {selectedAccount ? <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0"><p className="break-all font-semibold text-sm">{selectedAccount.displayName || selectedAccount.email}</p><p className="text-xs text-slate-500 mt-0.5">{providerLabel(selectedAccount.provider, t)} · {selectedAccount.status}</p></div>
                    <div className="grid grid-cols-2 gap-2 sm:flex"><Button className="w-full" size="sm" variant="outline" onClick={() => sync(selectedAccount.id)} disabled={syncingAccountId === selectedAccount.id}><RefreshCw className={syncingAccountId === selectedAccount.id ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />{syncingAccountId === selectedAccount.id ? t('files.syncing') : t('files.sync')}</Button><Button className="w-full" size="sm" variant="danger" onClick={() => setAccountToDisconnect(selectedAccount)}><Trash2 className="h-4 w-4" />{t('settings.disconnect')}</Button></div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-xl bg-white dark:bg-slate-950 p-2 border border-slate-100 dark:border-slate-800"><p className="font-extrabold text-slate-950">{formatBytes(selectedAccount.storageAccount?.usedBytes)}</p><p className="mt-0.5 text-[10px] text-slate-500">{t('settings.used')}</p></div>
                    <div className="rounded-xl bg-white dark:bg-slate-950 p-2 border border-slate-100 dark:border-slate-800"><p className="font-extrabold text-slate-950">{storageLimitLabel(selectedAccount, t)}</p><p className="mt-0.5 text-[10px] text-slate-500">{t('settings.total')}</p></div>
                    <div className="rounded-xl bg-white dark:bg-slate-950 p-2 border border-slate-100 dark:border-slate-800"><p className="font-extrabold text-slate-950">{availableLabel(selectedAccount, t)}</p><p className="mt-0.5 text-[10px] text-slate-500">{t('settings.free')}</p></div>
                  </div>
                </div> : null}
              </>}
            </div>
          </Card>

          {isAdmin ? <>
          <Card className="p-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-4">
              <div className="flex items-center gap-2.5">
                <Cloud className="h-5 w-5 text-blue-600" />
                <h2 className="text-[17px] font-bold">{t('settings.oauthTitle')}</h2>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs font-semibold"
                type="button"
                onClick={() => setShowGoogleHelp(!showGoogleHelp)}
              >
                {showGoogleHelp ? t('settings.hideGuide') : t('settings.setupGuide')}
              </Button>
            </div>

            {showGoogleHelp && (
              <div className="mb-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 p-3.5 text-[13px] leading-relaxed text-slate-600 border border-slate-100 dark:border-slate-800">
                <p className="font-bold text-slate-800 dark:text-slate-200 mb-1.5">{t('settings.guideHow')}</p>
                <ol className="list-decimal pl-4 space-y-1.5">
                  <li>{t('settings.guide1Pre')} <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Google Cloud Console</a>.</li>
                  <li>{t('settings.guide2Pre')} <strong>Google Drive API</strong> {t('settings.guide2Post')}</li>
                  <li>{t('settings.guide3Pre')} <strong>APIs & Services &gt; Credentials</strong>{t('settings.guide3Mid')} <strong>Create Credentials &gt; OAuth client ID</strong>.</li>
                  <li>{t('settings.guide4Pre')} <strong>Web application</strong>.</li>
                  <li>{t('settings.guide5Pre')} <strong>Authorized redirect URIs</strong>:
                    <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] bg-white dark:bg-slate-950 p-1.5 rounded border border-slate-200 dark:border-slate-800 select-all overflow-x-auto">
                      {googleRedirectUri || defaultRedirectUri}
                    </div>
                  </li>
                  <li>{t('settings.guide6Pre')} <strong>Client ID</strong> {t('settings.guide6And')} <strong>Client Secret</strong> {t('settings.guide6Post')}</li>
                </ol>
              </div>
            )}

            <form onSubmit={saveGoogleConfig} className="grid gap-3.5">
              <label className="grid gap-1.5 text-xs font-bold text-slate-500">
                Client ID
                <input
                  className="h-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 text-sm focus:border-blue-600 focus:outline-none"
                  placeholder={t('settings.clientIdPlaceholder')}
                  value={googleClientId}
                  onChange={(e) => setGoogleClientId(e.target.value)}
                  required
                />
              </label>

              <label className="grid gap-1.5 text-xs font-bold text-slate-500">
                Client Secret {hasSecret && <span className="font-normal text-emerald-600">{t('settings.alreadyConfigured')}</span>}
                <input
                  className="h-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 text-sm focus:border-blue-600 focus:outline-none"
                  type="password"
                  placeholder={hasSecret ? "••••••••••••••••••••••••" : t('settings.secretPlaceholder')}
                  value={googleClientSecret}
                  onChange={(e) => setGoogleClientSecret(e.target.value)}
                  required={!hasSecret}
                />
              </label>

              <label className="grid gap-1.5 text-xs font-bold text-slate-500">
                {t('settings.redirectUri')}
                <input
                  className="h-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 text-sm focus:border-blue-600 focus:outline-none"
                  placeholder={defaultRedirectUri}
                  value={googleRedirectUri}
                  onChange={(e) => setGoogleRedirectUri(e.target.value)}
                />
              </label>

              <div className="flex justify-end mt-1">
                <Button type="submit" disabled={savingGoogleConfig} size="sm">
                  {savingGoogleConfig ? t('settings.saving') : t('settings.saveCreds')}
                </Button>
              </div>
            </form>
          </Card>

          <Card className="overflow-hidden p-3.5">
            <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2.5">
                  <RefreshCw className="h-5 w-5 text-blue-600" />
                  <h2 className="text-[16px] font-bold">{t('settings.updateTitle')}</h2>
                </div>
                <p className="mt-1 text-[13px] text-slate-500">
                  {t('settings.updateDesc')}
                </p>
              </div>
              <Button
                className="w-full sm:w-32"
                variant="outline"
                size="sm"
                onClick={runSystemUpdate}
                disabled={updatingSystem}
              >
                <RefreshCw className={updatingSystem ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                {updatingSystem ? t('settings.updating') : t('settings.updateBtn')}
              </Button>
            </div>
          </Card>
          </> : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 lg:gap-3">
          <Card className="p-4"><HardDrive className="h-5 w-5 text-blue-600" /><h2 className="mt-2 text-[14px] font-bold">{t('settings.storageCard')}</h2><p className="mt-1 text-[12px] text-slate-500">{t('settings.connectedAccounts', { count: accounts.length })}</p></Card>
          <Card className="p-4"><Bell className="h-5 w-5 text-blue-600" /><h2 className="mt-2 text-[14px] font-bold">{t('settings.notifications')}</h2><p className="mt-1 text-[12px] text-slate-500">{t('settings.notificationsDesc')}</p></Card>
          <Card className="p-4"><Globe className="h-5 w-5 text-blue-600" /><h2 className="mt-2 text-[14px] font-bold">{t('settings.region')}</h2><p className="mt-1 text-[12px] text-slate-500">{t('settings.regionDesc')}</p></Card>
        </div>
      </div>
      <DummyModal open={s3Open} title={t('settings.s3ModalTitle')} description={t('settings.s3ModalDesc')} onClose={() => setS3Open(false)}>
        <form className="grid gap-4" onSubmit={connectS3}>
          <input className="h-11 rounded-xl border border-slate-200 px-3 text-sm" placeholder={t('settings.s3Display')} value={s3Form.name} onChange={(event) => setS3Form({ ...s3Form, name: event.target.value })} required />
          <input className="h-11 rounded-xl border border-slate-200 px-3 text-sm" placeholder={t('settings.s3Bucket')} value={s3Form.bucket} onChange={(event) => setS3Form({ ...s3Form, bucket: event.target.value })} required />
          <input className="h-11 rounded-xl border border-slate-200 px-3 text-sm" placeholder={t('settings.s3Region')} value={s3Form.region} onChange={(event) => setS3Form({ ...s3Form, region: event.target.value })} required />
          <input className="h-11 rounded-xl border border-slate-200 px-3 text-sm" placeholder={t('settings.s3Endpoint')} value={s3Form.endpoint} onChange={(event) => setS3Form({ ...s3Form, endpoint: event.target.value })} />
          <input className="h-11 rounded-xl border border-slate-200 px-3 text-sm" placeholder={t('settings.s3AccessKey')} value={s3Form.accessKeyId} onChange={(event) => setS3Form({ ...s3Form, accessKeyId: event.target.value })} required />
          <input className="h-11 rounded-xl border border-slate-200 px-3 text-sm" placeholder={t('settings.s3Secret')} type="password" value={s3Form.secretAccessKey} onChange={(event) => setS3Form({ ...s3Form, secretAccessKey: event.target.value })} required />
          <input className="h-11 rounded-xl border border-slate-200 px-3 text-sm" placeholder={t('settings.s3Quota')} inputMode="numeric" value={s3Form.quotaBytes} onChange={(event) => setS3Form({ ...s3Form, quotaBytes: event.target.value })} />
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={s3Form.forcePathStyle} onChange={(event) => setS3Form({ ...s3Form, forcePathStyle: event.target.checked })} />{t('settings.s3PathStyle')}</label>
          <div className="grid gap-3 sm:flex sm:justify-end"><Button variant="outline" type="button" onClick={() => setS3Open(false)} disabled={connectingS3}>{t('common.cancel')}</Button><Button type="submit" disabled={connectingS3}>{connectingS3 ? t('settings.connecting') : t('settings.connectS3')}</Button></div>
        </form>
      </DummyModal>
      <DummyModal open={Boolean(accountToDisconnect)} title={t('settings.disconnectTitle')} description={t('settings.disconnectDesc')} onClose={() => setAccountToDisconnect(null)}>
        <div className="grid gap-4">
          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
            <p className="font-semibold text-slate-950">{accountToDisconnect?.email}</p>
            <p className="mt-1">{t('settings.usedStorage', { size: formatBytes(accountToDisconnect?.storageAccount?.usedBytes) })}</p>
          </div>
          <div className="grid gap-3 sm:flex sm:justify-end">
            <Button variant="outline" onClick={() => setAccountToDisconnect(null)} disabled={Boolean(disconnectingAccountId)}>{t('common.cancel')}</Button>
            <Button variant="danger" onClick={disconnect} disabled={Boolean(disconnectingAccountId)}><Trash2 className="h-4 w-4" />{disconnectingAccountId ? t('settings.disconnecting') : t('settings.disconnect')}</Button>
          </div>
        </div>
      </DummyModal>

      <DummyModal
        open={updateModalOpen}
        title={updateModalTitle}
        description={
          updateFinished
            ? (updateSuccess ? t('settings.updateDescDone') : t('settings.updateDescFailed'))
            : t('settings.updateDescLive')
        }
        className="max-w-2xl"
        onClose={() => {
          if (!updateFinished) {
            if (!confirm(t('settings.updateCloseConfirm'))) {
              return
            }
          }
          setUpdateModalOpen(false)
          setIsPollingLog(false)
          if (updateFinished && updateSuccess) {
            window.location.reload()
          }
        }}
      >
        <div className="grid gap-4">
          <div
            ref={logContainerRef}
            className="relative rounded-xl bg-slate-950 p-4 font-mono text-xs text-slate-300 leading-relaxed border border-slate-800 h-80 overflow-y-auto select-text"
          >
            <pre className="whitespace-pre-wrap">{updateLog}</pre>
            {!updateFinished && (
              <div className="mt-3 flex items-center gap-2 text-blue-400">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                <span>
                  {reconnectCount > 0
                    ? t('settings.reconnecting', { count: reconnectCount })
                    : t('settings.installing')}
                </span>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (!updateFinished) {
                  if (!confirm(t('settings.updateCloseConfirm'))) return
                }
                setUpdateModalOpen(false)
                setIsPollingLog(false)
                if (updateFinished && updateSuccess) {
                  window.location.reload()
                }
              }}
            >
              {t('common.close')}
            </Button>
            {updateFinished && updateSuccess && (
              <Button onClick={() => window.location.reload()}>
                {t('settings.reloadPage')}
              </Button>
            )}
          </div>
        </div>
      </DummyModal>
    </>
  )
}
