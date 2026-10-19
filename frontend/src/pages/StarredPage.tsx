import { FileText, Star } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { FileTable } from '@/components/drive/FileTable'
import { MetricCard } from '@/components/drive/MetricCard'
import { PageHeader } from '@/components/drive/PageHeader'
import { files } from '@/data/drive-data'
import { useI18n } from '@/i18n/I18nProvider'

const starred = files.filter((file) => file.starredDate)

export function StarredPage() {
  const { t } = useI18n()
  return (
    <>
      <PageHeader title={t('nav.starred')} description={t('starred.description')} />
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <MetricCard label={t('starred.files')} value="3" icon={Star} />
        <MetricCard label={t('starred.quickOpens')} value="18" icon={FileText} />
        <MetricCard label={t('starred.folders')} value="1" icon={Star} />
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {starred.map((file) => (
          <Card key={file.name} className="p-5">
            <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
            <h2 className="mt-4 font-extrabold">{file.name}</h2>
            <p className="mt-1 text-sm text-slate-500">{t('starred.on', { date: file.starredDate ?? '' })}</p>
          </Card>
        ))}
      </div>
      <FileTable files={starred} mode="starred" />
    </>
  )
}
