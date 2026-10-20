import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle, XCircle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { useI18n } from '@/i18n/I18nProvider'

export function GoogleConnectedPage() {
  const { t } = useI18n()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const status = params.get('status') ?? 'success'
  const ok = status === 'success'
  const provider = params.get('provider') === 'onedrive' ? 'onedrive' : 'google'

  useEffect(() => {
    window.opener?.postMessage({ type: 'GOOGLE_CONNECTED', status, provider }, window.location.origin)
    const timer = window.setTimeout(() => {
      if (window.opener) window.close()
      else navigate('/settings')
    }, 800)
    return () => window.clearTimeout(timer)
  }, [navigate, status, provider])

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5">
      <Card className="w-full max-w-sm p-6 text-center">
        {ok ? <CheckCircle className="mx-auto h-10 w-10 text-emerald-500" /> : <XCircle className="mx-auto h-10 w-10 text-red-500" />}
        <h1 className="mt-4 text-xl font-extrabold">{ok ? t(provider === 'onedrive' ? 'googleConnected.okOneDrive' : 'googleConnected.ok') : t('googleConnected.fail')}</h1>
        <p className="mt-2 text-sm text-slate-500">{ok ? t('googleConnected.okHint') : t('googleConnected.failHint')}</p>
      </Card>
    </main>
  )
}
