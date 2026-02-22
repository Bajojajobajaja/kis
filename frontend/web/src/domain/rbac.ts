import type { ActionKey, Role } from './model'

const allActions: ActionKey[] = [
  'create',
  'edit',
  'archive',
  'close',
  'assign',
  'post',
  'cancel',
  'writeoff',
  'reopen',
]

const rolePermissions: Record<Role, ActionKey[]> = {
  admin: allActions,
  manager: ['create', 'edit', 'archive', 'close', 'assign', 'post', 'cancel', 'reopen'],
  accountant: ['create', 'edit', 'post', 'cancel', 'close', 'reopen'],
  viewer: [],
}

const actionLabels: Record<ActionKey, string> = {
  create: 'создание',
  edit: 'редактирование',
  archive: 'архивация',
  close: 'закрытие',
  assign: 'назначение',
  post: 'проведение',
  cancel: 'отмена',
  writeoff: 'списание',
  reopen: 'переоткрытие',
}

export const roleLabels: Record<Role, string> = {
  admin: 'Администратор',
  manager: 'Менеджер',
  accountant: 'Бухгалтер',
  viewer: 'Наблюдатель',
}

export function canRolePerform(role: Role, action: ActionKey): boolean {
  return rolePermissions[role].includes(action)
}

export function getActionDeniedReason(role: Role, action: ActionKey): string {
  if (canRolePerform(role, action)) {
    return ''
  }

  if (role === 'viewer') {
    return 'Роль "Наблюдатель" имеет доступ только на просмотр.'
  }

  return `У роли "${roleLabels[role]}" нет права на ${actionLabels[action]}.`
}
