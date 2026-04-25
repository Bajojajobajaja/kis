import type {
  EntityActionDefinition,
  EntityStatusActionDefinition,
  EntityStatusDefinition,
  EntityTabDefinition,
} from './model'
import { getSubsystemBySlug } from './subsystems'

export function getTabByRoute(
  subsystemSlug: string | undefined,
  tabSlug: string | undefined,
): EntityTabDefinition | undefined {
  if (!subsystemSlug || !tabSlug) {
    return undefined
  }
  return getSubsystemBySlug(subsystemSlug)?.tabs.find((tab) => tab.slug === tabSlug)
}

export function getStatusDefinition(
  tab: EntityTabDefinition,
  status: string,
): EntityStatusDefinition | undefined {
  return tab.statuses.find((entityStatus) => entityStatus.key === status)
}

export function isClosedStatus(tab: EntityTabDefinition, status: string): boolean {
  return Boolean(getStatusDefinition(tab, status)?.closed)
}

export function getActionDefinition(
  tab: EntityTabDefinition,
  actionKey: string,
): EntityActionDefinition | undefined {
  return tab.actions.find((action) => action.key === actionKey)
}

export function getAvailableActions(
  tab: EntityTabDefinition,
  status: string,
): EntityStatusActionDefinition[] {
  return tab.statusActions?.[status] ?? []
}
