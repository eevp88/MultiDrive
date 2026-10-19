import { Archive, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FileTable } from '@/components/drive/FileTable'
import { MetricCard } from '@/components/drive/MetricCard'
import { PageHeader } from '@/components/drive/PageHeader'
import { archivedFiles } from '@/data/drive-data'
import { useI18n } from '@/i18n/I18nProvider'

export function ArchivedPage() {
  const { t } = useI18n()
  return (
    <>
      <PageHeader title={t('archived.title')} description={t('archived.description')} actions={<><Button variant="outline"><RotateCcw className="h-4 w-4" />{t('archived.restore')}</Button><Button variant="danger"><Trash2 className="h-4 w-4" />{t('archived.deletePermanently')}</Button></>} />
      <Card className="mt-8 border-orange-200 bg-orange-50 p-4 text-sm text-orange-700">
        {t('archived.notice')}
      </Card>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <MetricCard label={t('archived.items')} value="3" icon={Archive} />
        <MetricCard label={t('archived.recoverable')} value="3" icon={RotateCcw} />
        <MetricCard label={t('archived.saved')} value="2.6 MB" icon={Trash2} />
      </div>
      <FileTable files={archivedFiles} mode="archived" />
    </>
  )
}
