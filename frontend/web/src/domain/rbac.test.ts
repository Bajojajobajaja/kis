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
    expect(canAccessSubsystem('sales', 'finance')).toBe(true)
    expect(canAccessStore('mechanic', 'inventory/stock')).toBe(true)
    expect(canAccessStore('analyst', 'service/orders')).toBe(false)

    expect(getDefaultPath('administrator')).toBe('/crm-sales/clients')
    expect(getDefaultPath('mechanic')).toBe('/service/orders')
    expect(getDefaultPathForSubsystem('analyst', 'finance')).toBe('/finance/analytics')
    expect(getDefaultPathForSubsystem('sales', 'finance')).toBe('/finance/invoices')
  })

  it('allows sales inside crm-sales and finance workstores', () => {
    expect(canRolePerform('sales', 'create', 'crm-sales/deals')).toBe(true)
    expect(canRolePerform('sales', 'edit', 'crm-sales/documents')).toBe(true)
    expect(canRolePerform('sales', 'create', 'finance/invoices')).toBe(true)
    expect(canRolePerform('sales', 'create', 'finance/payments')).toBe(true)
    expect(canRolePerform('sales', 'writeoff', 'inventory/stock')).toBe(false)
  })

  it('allows mechanics to work in service, inventory and finance including writeoff', () => {
    expect(canRolePerform('mechanic', 'create', 'service/orders')).toBe(true)
    expect(canRolePerform('mechanic', 'edit', 'inventory/purchases')).toBe(true)
    expect(canRolePerform('mechanic', 'writeoff', 'inventory/stock')).toBe(true)
    expect(canRolePerform('mechanic', 'create', 'finance/payments')).toBe(true)
    expect(canRolePerform('mechanic', 'create', 'crm-sales/deals')).toBe(false)
  })

  it('lets warehouse keepers work in inventory and finance including writeoff', () => {
    expect(canAccessSubsystem('warehouse', 'inventory')).toBe(true)
    expect(canAccessSubsystem('warehouse', 'finance')).toBe(true)
    expect(canAccessSubsystem('warehouse', 'service')).toBe(false)
    expect(canAccessSubsystem('warehouse', 'crm-sales')).toBe(false)
    expect(getDefaultPath('warehouse')).toBe('/inventory/stock')
    expect(getDefaultPathForSubsystem('warehouse', 'finance')).toBe('/finance/invoices')
    expect(canRolePerform('warehouse', 'create', 'inventory/purchases')).toBe(true)
    expect(canRolePerform('warehouse', 'edit', 'inventory/stock')).toBe(true)
    expect(canRolePerform('warehouse', 'writeoff', 'inventory/stock')).toBe(true)
    expect(canRolePerform('warehouse', 'create', 'finance/invoices')).toBe(true)
    expect(canRolePerform('warehouse', 'create', 'service/orders')).toBe(false)
    expect(canRolePerform('warehouse', 'create', 'crm-sales/deals')).toBe(false)
  })

  it('lets analysts work across finance while platform roles stay read-only', () => {
    expect(canRolePerform('analyst', 'create', 'finance/reports')).toBe(true)
    expect(canRolePerform('analyst', 'post', 'finance/reports')).toBe(true)
    expect(canRolePerform('analyst', 'create', 'finance/invoices')).toBe(true)
    expect(canRolePerform('analyst', 'create', 'finance/payments')).toBe(true)
    expect(canRolePerform('administrator', 'edit', 'platform/roles')).toBe(false)
    expect(getActionDeniedReason('administrator', 'edit', 'platform/roles')).toContain('только для просмотра')
  })
})
