import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { HardDrive } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { apiFetch } from '@/lib/api'
import { setAuthSession, type AuthUser } from '@/lib/auth'
import { useI18n } from '@/i18n/I18nProvider'

type AuthResponse = { accessToken: string; refreshToken: string; user: AuthUser }

export function GoogleAuthPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { t, translateError } = useI18n()
  const [message, setMessage] = useState(t('googleAuth.completing'))
  const token = params.get('token')
  const status = params.get('status')

  useEffect(() => {
    if (status === 'error' || !token) {
      setMessage(t('googleAuth.failed'))
      return
    }

    apiFetch<AuthResponse>('/auth/google/exchange', { method: 'POST', skipAuth: true, body: JSON.stringify({ token }) })
      .then((data) => {
        setAuthSession(data.accessToken, data.refreshToken, data.user)
        navigate('/all-files', { replace: true })
      })
      .catch((error) => setMessage(translateError(error, 'googleAuth.failed')))
  }, [navigate, status, token, t, translateError])

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5">
      <Card className="w-full max-w-sm p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white"><HardDrive className="h-6 w-6" /></div>
        <h1 className="mt-4 text-xl font-extrabold">{t('googleAuth.title')}</h1>
        <p className="mt-2 text-sm text-slate-500">{message}</p>
      </Card>
    </main>
  )
}
