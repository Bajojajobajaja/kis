import {
  resolveStoreReferenceLabel,
  type EntityRecordGetter,
} from './entityReferences'
import type { EntityFieldOptionsSource, EntityRecord } from './model'
import {
  accessRoleLabels,
  accessRolePermissionProfiles,
  accessRoleSubsystemSummaries,
  getRoleByRecordId,
  platformRoleRecordIds,
} from './rbac'

export const PLATFORM_USERS_STORE_KEY = 'platform/users'
export const PLATFORM_ROLES_STORE_KEY = 'platform/roles'

export const PLATFORM_USER_ACCESS_ROLE_FIELD_KEY = 'accessRole'
export const PLATFORM_USER_BUSINESS_ROLE_FIELD_KEY = 'businessRoleId'
export const PLATFORM_ROLE_ADMIN_ID = platformRoleRecordIds.administrator
export const PLATFORM_ROLE_SALES_ID = platformRoleRecordIds.sales
export const PLATFORM_ROLE_MECHANIC_ID = platformRoleRecordIds.mechanic
export const PLATFORM_ROLE_ANALYST_ID = platformRoleRecordIds.analyst

export const SALES_DEPARTMENT = 'Продажи'
export const SERVICE_DEPARTMENT = 'Сервис и склад'
export const PLATFORM_DEPARTMENT = 'Платформа'
export const FINANCE_DEPARTMENT = 'Финансы'

const roleDepartments: Record<string, string> = {
  [PLATFORM_ROLE_ADMIN_ID]: PLATFORM_DEPARTMENT,
  [PLATFORM_ROLE_SALES_ID]: SALES_DEPARTMENT,
  [PLATFORM_ROLE_MECHANIC_ID]: SERVICE_DEPARTMENT,
  [PLATFORM_ROLE_ANALYST_ID]: FINANCE_DEPARTMENT,
}

export const PLATFORM_USER_REFERENCE_SOURCE: EntityFieldOptionsSource = {
  type: 'store',
  storeKey: PLATFORM_USERS_STORE_KEY,
  valueKey: 'id',
  labelKey: 'title',
}

export const PLATFORM_ROLE_REFERENCE_SOURCE: EntityFieldOptionsSource = {
  type: 'store',
  storeKey: PLATFORM_ROLES_STORE_KEY,
  valueKey: 'id',
  labelKey: 'title',
}

export function isSalesManagerUser(record: EntityRecord): boolean {
  return (
    record.status === 'active' &&
    (record.values[PLATFORM_USER_BUSINESS_ROLE_FIELD_KEY] ?? '').trim() === PLATFORM_ROLE_SALES_ID
  )
}

export function isServiceUser(record: EntityRecord): boolean {
  return (
    record.status === 'active' &&
    (record.values[PLATFORM_USER_BUSINESS_ROLE_FIELD_KEY] ?? '').trim() === PLATFORM_ROLE_MECHANIC_ID
  )
}

export function isServiceMasterUser(record: EntityRecord): boolean {
  return isServiceUser(record)
}

export function resolvePlatformUserLabel(
  value: string,
  getRecords: EntityRecordGetter,
  fallbackText?: string,
): string {
  return resolveStoreReferenceLabel(
    PLATFORM_USER_REFERENCE_SOURCE,
    value,
    getRecords,
    fallbackText,
  )
}

export function resolvePlatformRoleLabel(
  value: string,
  getRecords: EntityRecordGetter,
  fallbackText?: string,
): string {
  return resolveStoreReferenceLabel(
    PLATFORM_ROLE_REFERENCE_SOURCE,
    value,
    getRecords,
    fallbackText,
  )
}

export function getPlatformDepartmentForRoleId(roleId: string): string {
  return roleDepartments[roleId] ?? ''
}

export function normalizePlatformUserValues(
  values: Record<string, string>,
): Record<string, string> {
  const {
    accessRole: _legacyAccessRole,
    role: _legacyRole,
    ...restValues
  } = values
  const businessRoleId = (restValues[PLATFORM_USER_BUSINESS_ROLE_FIELD_KEY] ?? '').trim()
  const businessRoleIdText =
    businessRoleId ? '' : (restValues.businessRoleIdText ?? '').trim()
  const department =
    getPlatformDepartmentForRoleId(businessRoleId) || (restValues.department ?? '').trim()

  return {
    ...restValues,
    businessRoleId,
    businessRoleIdText,
    department,
  }
}

export function buildPlatformUserSubtitle(
  values: Record<string, string>,
  getRecords?: EntityRecordGetter,
): string {
  const businessRoleId = (values[PLATFORM_USER_BUSINESS_ROLE_FIELD_KEY] ?? '').trim()
  const department =
    getPlatformDepartmentForRoleId(businessRoleId) || (values.department ?? '').trim()
  const businessRole =
    getRecords
      ? resolvePlatformRoleLabel(
          businessRoleId,
          getRecords,
          values.businessRoleIdText,
        )
      : (values.businessRoleIdText ?? '').trim() || businessRoleId

  return [businessRole, department].filter(Boolean).join(' • ')
}

export function buildPlatformRoleSubtitle(values: Record<string, string>): string {
  const scope = (values.subsystems ?? values.scope ?? '').trim()
  const owner = (values.owner ?? '').trim()
  return [scope, owner].filter(Boolean).join(' • ')
}

export function buildPlatformRoleValues(
  roleId: string,
  users: number,
): Record<string, string> {
  const role = getRoleByRecordId(roleId)
  if (!role) {
    return {
      owner: 'Security Team',
      users: String(users),
    }
  }

  return {
    owner: 'Security Team',
    users: String(users),
    permissionProfile: accessRolePermissionProfiles[role],
    subsystems: accessRoleSubsystemSummaries[role],
    scope:
      role === 'administrator'
        ? 'All'
        : role === 'sales'
          ? 'CRM'
          : role === 'mechanic'
            ? 'Service, Inventory'
            : 'Finance',
    permissions: accessRoleLabels[role],
  }
}
