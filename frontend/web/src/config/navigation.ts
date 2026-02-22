import type { SubsystemSlug } from '../domain/model'
import { subsystems } from '../domain/subsystems'

export type SubsystemNavItem = {
  slug: SubsystemSlug
  title: string
  summary: string
  metricLabel: string
  metricValue: string
}

export const subsystemNav: SubsystemNavItem[] = subsystems.map((item) => ({
  slug: item.slug,
  title: item.title,
  summary: item.summary,
  metricLabel: 'Сущностей',
  metricValue: String(item.tabs.length),
}))
