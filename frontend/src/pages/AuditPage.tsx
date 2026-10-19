import { useStore } from '../store/store'
import { Card, EmptyState, PageHeader } from '../components/ui'
import { formatDate } from '../lib/util'
import { useT } from '../lib/i18n'

export default function AuditPage() {
  const audit = useStore((s) => s.audit)
  const t = useT()
  return (
    <>
      <PageHeader eyebrow={t('Workspace')} title={t('Audit trail')} description={t('Actions recorded in this browser’s demo session (most recent first). A deployed system keeps this server-side.')} />
      <Card>
        {audit.length === 0 ? (
          <EmptyState title={t('No events yet')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs text-haze">
                <tr>
                  <th className="px-5 py-3 font-medium">{t('Time')}</th>
                  <th className="px-5 py-3 font-medium">{t('Actor')}</th>
                  <th className="px-5 py-3 font-medium">{t('Action')}</th>
                  <th className="px-5 py-3 font-medium">{t('Entity')}</th>
                  <th className="px-5 py-3 font-medium">{t('Detail')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {audit.slice(0, 200).map((a) => (
                  <tr key={a.id} className="align-top">
                    <td className="whitespace-nowrap px-5 py-2.5 font-mono text-xs text-haze">{formatDate(a.at, true)}</td>
                    <td className="whitespace-nowrap px-5 py-2.5">{a.actor}</td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-cyan">{a.action.replace(/_/g, ' ')}</td>
                    <td className="whitespace-nowrap px-5 py-2.5 font-mono text-xs text-haze">{a.entity} · {a.entityId.slice(-8)}</td>
                    <td className="px-5 py-2.5 text-haze">{a.detail ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
