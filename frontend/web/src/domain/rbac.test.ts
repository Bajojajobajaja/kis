import { describe, expect, it } from 'vitest'

import {
  canAccessStore,
  canAccessSubsystem,
  canRolePerform,
  getActionDeniedReason,
  getDefaultPath,
  getDefaultPathForSubsystem,
} from './rbac'

describe('rbac', () => {
  it('uses role-aware subsystem access and landing paths', () => {
    expect(canAccessSubsystem('administrator', 'platform')).toBe(true)
    expect(canAccessSubsystem('sales', 'crm-sales')).toBe(true)
    expect(canAccessSubsystem('sales', 'finance')).toBe(false)
    expect(canAccessStore('mechanic', 'inventory/stock')).toBe(true)
    expect(canAccessStore('analyst', 'service/orders')).toBe(false)

    expect(getDefaultPath('administrator')).toBe('/crm-sales/clients')
    expect(getDefaultPath('mechanic')).toBe('/service/orders')
    expect(getDefaultPathForSubsystem('analyst', 'finance')).toBe('/finance/analytics')
    expect(getDefaultPathForSubsystem('sales', 'finance')).toBe('/crm-sales/clients')
  })

  it('allows sales only inside crm-sales workstores', () => {
    expect(canRolePerform('sales', 'create', 'crm-sales/deals')).toBe(true)
    expect(canRolePerform('sales', 'edit', 'crm-sales/documents')).toBe(true)
    expect(canRolePerform('sales', 'create', 'finance/invoices')).toBe(false)
    expect(canRolePerform('sales', 'writeoff', 'inventory/stock')).toBe(false)
  })

  it('allows mechanics to work in service and inventory including writeoff', () => {
    expect(canRolePerform('mechanic', 'create', 'service/orders')).toBe(true)
    expect(canRolePerform('mechanic', 'edit', 'inventory/purchases')).toBe(true)
    expect(canRolePerform('mechanic', 'writeoff', 'inventory/stock')).toBe(true)
    expect(canRolePerform('mechanic', 'create', 'crm-sales/deals')).toBe(false)
  })

  it('keeps analysts limited to finance reports while platform roles stay read-only', () => {
    expect(canRolePerform('analyst', 'create', 'finance/reports')).toBe(true)
    expect(canRolePerform('analyst', 'post', 'finance/reports')).toBe(true)
    expect(canRolePerform('analyst', 'create', 'finance/invoices')).toBe(false)
    expect(canRolePerform('administrator', 'edit', 'platform/roles')).toBe(false)
    expect(getActionDeniedReason('administrator', 'edit', 'platform/roles')).toContain('только для просмотра')
  })
})
