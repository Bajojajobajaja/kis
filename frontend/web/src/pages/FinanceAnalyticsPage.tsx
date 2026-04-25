import { Navigate, useParams } from 'react-router-dom'

import { useAuth } from '../auth/AuthContext'
import { getSubsystemBySlug } from '../domain/subsystems'
import { FinanceAnalyticsDashboard } from './FinanceAnalyticsDashboard'

export function FinanceAnalyticsPage() {
  const { subsystemSlug } = useParams()
  const { getLandingPath } = useAuth()

  if (subsystemSlug !== 'finance') {
    return <Navigate to={getLandingPath()} replace />
  }

  const subsystem = getSubsystemBySlug('finance')
  if (!subsystem) {
    return <Navigate to={getLandingPath()} replace />
  }

  return (
    <FinanceAnalyticsDashboard
      item={{
        slug: subsystem.slug,
        title: subsystem.title,
        summary: subsystem.summary,
        metricLabel: 'Сущностей',
        metricValue: String(subsystem.tabs.length + 1),
      }}
    />
  )
}
