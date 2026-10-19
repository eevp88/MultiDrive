import { Clock, Download, Edit3, Eye } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { FileTable } from '@/components/drive/FileTable'
import { MetricCard } from '@/components/drive/MetricCard'
import { PageHeader } from '@/components/drive/PageHeader'
import { files } from '@/data/drive-data'
import { useI18n } from '@/i18n/I18nProvider'
import type { MessageKey } from '@/i18n/en'

const activities: Array<{ text: MessageKey; time: MessageKey; icon: typeof Eye }> = [
  { text: 'recent.act1', time: 'recent.act1Time', icon: Eye },
  { text: 'recent.act2', time: 'recent.act2Time', icon: Edit3 },
  { text: 'recent.act3', time: 'recent.act3Time', icon: Download },
]

export function RecentPage() {
  const { t } = useI18n()
  return (
    <>
      <PageHeader title={t('recent.title')} description={t('recent.description')} />
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <MetricCard label={t('recent.openedToday')} value="8" icon={Eye} />
        <MetricCard label={t('recent.modified')} value="4" icon={Edit3} />
        <MetricCard label={t('recent.downloads')} value="2" icon={Download} />
      </div>
      <Card className="mt-8 p-5">
        <h2 className="font-extrabold">{t('recent.activity')}</h2>
        <div className="mt-4 grid gap-3">
          {activities.map((activity) => (
            <div key={activity.text} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-blue-600 shadow-sm"><activity.icon className="h-4 w-4" /></div>
              <div className="flex-1"><p className="font-semibold">{t(activity.text)}</p><p className="text-sm text-slate-500">{t(activity.time)}</p></div>
              <Clock className="h-4 w-4 text-slate-400" />
            </div>
          ))}
        </div>
      </Card>
      <FileTable files={files} mode="recent" />
    </>
  )
}
