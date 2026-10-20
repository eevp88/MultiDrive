import { useEffect, useState } from 'react'
import { Clock, FileArchive, Folder, Trash2, Users, UserCheck } from 'lucide-react'
import { MetricCard } from '@/components/drive/MetricCard'
import { PageHeader } from '@/components/drive/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { apiFetch, formatBytes, formatDate } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n/I18nProvider'

type InviteTarget = { id: string; name: string; type: 'file' | 'folder'; mimeType?: string; sizeBytes?: string }
type Invite = {
  id: string
  email: string
  role: string
  status: string
  targetType: 'file' | 'folder'
  targetId: string
  target: InviteTarget | null
  createdAt: string
  acceptedAt: string | null
  user: { id: string; name: string; email: string } | null
}

function ResourceIcon({ type }: { type: 'file' | 'folder' }) {
  return type === 'folder' ? <Folder className="h-5 w-5 text-blue-600" /> : <FileArchive className="h-5 w-5 text-blue-600" />
}

export function SharedPage() {
  const { t, tDynamic, translateError, language } = useI18n()
  const [sentInvites, setSentInvites] = useState<Invite[]>([])
  const [receivedInvites, setReceivedInvites] = useState<Invite[]>([])
  const [message, setMessage] = useState('')
  const pendingCount = sentInvites.filter((invite) => invite.status === 'pending').length
  const acceptedCount = sentInvites.filter((invite) => invite.status === 'accepted').length

  async function loadInvites() {
    const data = await apiFetch<{ sent: Invite[]; received: Invite[] }>('/invites')
    setSentInvites(data.sent)
    setReceivedInvites(data.received)
  }

  useEffect(() => {
    loadInvites().catch((error) => setMessage(translateError(error, 'shared.loadFailed')))
    window.addEventListener('multidrive:invites-changed', loadInvites)
    return () => window.removeEventListener('multidrive:invites-changed', loadInvites)
  }, [])

  async function revokeInvite(id: string) {
    await apiFetch(`/invites/${id}`, { method: 'DELETE' })
    await loadInvites()
  }

  return (
    <>
      <PageHeader title={t('shared.title')} description={t('shared.description')} />
      {message ? <p className="mt-5 rounded-xl bg-blue-50 p-3 text-sm text-blue-700">{message}</p> : null}
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <MetricCard label={t('shared.metricResources')} value={String(sentInvites.length + receivedInvites.length)} icon={Users} />
        <MetricCard label={t('shared.metricAccepted')} value={String(acceptedCount)} icon={UserCheck} />
        <MetricCard label={t('shared.metricPending')} value={String(pendingCount)} icon={Clock} />
      </div>

      <Card className="mt-8 p-5">
        <h2 className="font-extrabold">{t('shared.withYou')}</h2>
        <div className="mt-4 grid gap-3">
          {receivedInvites.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">{t('shared.withYouEmpty')}</p> : receivedInvites.map((invite) => (
            <div key={invite.id} className="flex flex-col gap-3 rounded-xl bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <ResourceIcon type={invite.targetType} />
                <div className="min-w-0"><p className="truncate font-semibold text-slate-950">{invite.target?.name ?? t('shared.unavailable')}</p><p className="text-sm text-slate-500 capitalize">{tDynamic(`enum.${invite.targetType}`, invite.targetType)} • {tDynamic(`enum.${invite.role}`, invite.role)}{invite.target?.sizeBytes ? ` • ${formatBytes(invite.target.sizeBytes)}` : ''}</p></div>
              </div>
              <span className={cn('w-fit rounded-full px-3 py-1 text-xs font-bold capitalize', invite.status === 'accepted' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>{tDynamic(`enum.${invite.status}`, invite.status)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-6 p-5">
        <h2 className="font-extrabold">{t('shared.youShared')}</h2>
        <div className="mt-4 grid gap-3">
          {sentInvites.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">{t('shared.youSharedEmpty')}</p> : sentInvites.map((invite) => (
            <div key={invite.id} className="flex flex-col gap-3 rounded-xl bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <ResourceIcon type={invite.targetType} />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-950">{invite.target?.name ?? t('shared.unavailable')}</p>
                  <p className="break-all text-sm text-slate-500">{t('shared.sharedWith', { email: invite.email })}</p>
                  <p className="mt-1 text-xs text-slate-500">{t('shared.invited', { date: formatDate(invite.createdAt, language) })}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white px-3 py-1 text-xs font-bold capitalize text-slate-600">{tDynamic(`enum.${invite.role}`, invite.role)}</span>
                <span className={cn('rounded-full px-3 py-1 text-xs font-bold capitalize', invite.status === 'accepted' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>{tDynamic(`enum.${invite.status}`, invite.status)}</span>
                <Button variant="danger" size="sm" onClick={() => revokeInvite(invite.id)}><Trash2 className="h-4 w-4" />{t('shared.revoke')}</Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}
