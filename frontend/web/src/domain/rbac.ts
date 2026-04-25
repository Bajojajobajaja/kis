import type { AccessRole, ActionKey, EntityFieldOption, EntityStoreKey, SubsystemSlug } from './model'

const fullAccessActions: ActionKey[] = [
  'create',
  'edit',
  'delete',
  'archive',
  'close',
  'assign',
  'post',
  'cancel',
  'writeoff',
  'reopen',
]

const workingActions: ActionKey[] = [
  'create',
  'edit',
  'delete',
  'archive',
  'close',
  'assign',
  'post',
  'cancel',
  'reopen',
]

const mechanicActions: ActionKey[] = [...workingActions, 'writeoff']
const analystReportActions: ActionKey[] = ['create', 'edit', 'post', 'archive', 'reopen']

const actionLabels: Record<ActionKey, string> = {
  create: 'создание',
  edit: 'редактирование',
  delete: 'удаление',
  archive: 'архивация',
  close: 'закрытие',
  assign: 'назначение',
  post: 'проведение',
  cancel: 'отмена',
  writeoff: 'списание',
  reopen: 'переоткрытие',
}

export const accessRoleLabels: Record<AccessRole, string> = {
  administrator: 'Администратор',
  sales: 'Менеджер по продажам',
  mechanic: 'Механик',
  analyst: 'Аналитик',
}

export const roleLabels = accessRoleLabels

export const platformRoleRecordIds: Record<AccessRole, string> = {
  administrator: 'RLB-ADMIN',
  sales: 'RLB-SALES',
  mechanic: 'RLB-MECHANIC',
  analyst: 'RLB-ANALYST',
}

const roleSubsystemAccess: Record<AccessRole, SubsystemSlug[]> = {
  administrator: ['crm-sales', 'service', 'inventory', 'finance', 'platform'],
  sales: ['crm-sales'],
  mechanic: ['service', 'inventory'],
  analyst: ['finance'],
}

const roleDefaultPaths: Record<AccessRole, string> = {
  administrator: '/crm-sales/clients',
  sales: '/crm-sales/clients',
  mechanic: '/service/orders',
  analyst: '/finance/analytics',
}

const subsystemLabels: Record<SubsystemSlug, string> = {
  'crm-sales': 'CRM и продажи',
  service: 'Сервис и ремонт',
  inventory: 'Склад и закупки',
  finance: 'Финансы и отчетность',
  platform: 'Платформенные сервисы',
}

const subsystemDefaultPaths: Record<SubsystemSlug, string> = {
  'crm-sales': '/crm-sales/clients',
  service: '/service/orders',
  inventory: '/inventory/stock',
  finance: '/finance/invoices',
  platform: '/platform/users',
}

export const accessRolePermissionProfiles: Record<AccessRole, string> = {
  administrator: 'Полный доступ',
  sales: 'Рабочий доступ',
  mechanic: 'Рабочий доступ + списание',
  analyst: 'Отчеты и аналитика',
}

export const accessRoleSubsystemSummaries: Record<AccessRole, string> = {
  administrator: 'CRM, Сервис, Склад, Финансы, Платформа',
  sales: 'CRM',
  mechanic: 'Сервис, Склад',
  analyst: 'Финансы',
}

export const accessRoleOptions: EntityFieldOption[] = Object.entries(accessRoleLabels).map(
  ([value, label]) => ({
    value,
    label,
  }),
)

export function isAccessRole(value: string): value is AccessRole {
  return (
    value === 'administrator' ||
    value === 'sales' ||
    value === 'mechanic' ||
    value === 'analyst'
  )
}

export function formatAccessRoleLabel(value: string): string {
  return isAccessRole(value) ? accessRoleLabels[value] : value
}

export function getRoleRecordId(role: AccessRole): string {
  return platformRoleRecordIds[role]
}

export function getRoleByRecordId(recordId: string): AccessRole | undefined {
  return (Object.entries(platformRoleRecordIds) as Array<[AccessRole, string]>).find(
    ([, candidateRecordId]) => candidateRecordId === recordId,
  )?.[0]
}

export function getAccessibleSubsystems(role: AccessRole): SubsystemSlug[] {
  return roleSubsystemAccess[role]
}

export function canAccessSubsystem(role: AccessRole, subsystemSlug: SubsystemSlug): boolean {
  return roleSubsystemAccess[role].includes(subsystemSlug)
}

export function getDefaultPath(role: AccessRole): string {
  return roleDefaultPaths[role]
}

export function getDefaultPathForSubsystem(
  role: AccessRole,
  subsystemSlug: SubsystemSlug,
): string {
  if (!canAccessSubsystem(role, subsystemSlug)) {
    return getDefaultPath(role)
  }
  if (role === 'analyst' && subsystemSlug === 'finance') {
    return '/finance/analytics'
  }
  return subsystemDefaultPaths[subsystemSlug]
}

export function getSubsystemSlugFromStoreKey(storeKey: string): SubsystemSlug | undefined {
  const [subsystemSlug] = storeKey.split('/')
  if (
    subsystemSlug === 'crm-sales' ||
    subsystemSlug === 'service' ||
    subsystemSlug === 'inventory' ||
    subsystemSlug === 'finance' ||
    subsystemSlug === 'platform'
  ) {
    return subsystemSlug
  }
  return undefined
}

export function canAccessStore(role: AccessRole, storeKey: string): boolean {
  const subsystemSlug = getSubsystemSlugFromStoreKey(storeKey)
  return subsystemSlug ? canAccessSubsystem(role, subsystemSlug) : false
}

function isStoreReadOnlyForRole(role: AccessRole, storeKey: EntityStoreKey): boolean {
  if (storeKey === 'platform/roles') {
    return true
  }
  return role === 'analyst' && storeKey.startsWith('finance/') && storeKey !== 'finance/reports'
}

export function canRolePerform(
  role: AccessRole,
  action: ActionKey,
  storeKey: EntityStoreKey,
): boolean {
  if (!canAccessStore(role, storeKey) || isStoreReadOnlyForRole(role, storeKey)) {
    return false
  }

  if (role === 'administrator') {
    return fullAccessActions.includes(action)
  }
  if (role === 'sales') {
    return workingActions.includes(action)
  }
  if (role === 'mechanic') {
    return mechanicActions.includes(action)
  }
  if (role === 'analyst') {
    return storeKey === 'finance/reports' && analystReportActions.includes(action)
  }
  return false
}

export function getActionDeniedReason(
  role: AccessRole,
  action: ActionKey,
  storeKey: EntityStoreKey,
): string {
  if (canRolePerform(role, action, storeKey)) {
    return ''
  }

  const subsystemSlug = getSubsystemSlugFromStoreKey(storeKey)
  if (subsystemSlug && !canAccessSubsystem(role, subsystemSlug)) {
    return `Роль "${accessRoleLabels[role]}" не имеет доступа к разделу "${subsystemLabels[subsystemSlug]}".`
  }

  if (storeKey === 'platform/roles') {
    return 'Каталог системных ролей доступен только для просмотра.'
  }

  if (role === 'analyst' && storeKey.startsWith('finance/')) {
    return 'Роль "Аналитик" может изменять только отчеты и аналитику финансов.'
  }

  return `У роли "${accessRoleLabels[role]}" нет права на ${actionLabels[action]}.`
}
