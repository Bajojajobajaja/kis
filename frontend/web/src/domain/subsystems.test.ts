import { describe, expect, it } from 'vitest'

import { subsystems } from './subsystems'

describe('subsystems', () => {
  it('finalizes tabs without runtime action maps and with valid workflow transitions', () => {
    for (const subsystem of subsystems) {
      for (const tab of subsystem.tabs) {
        expect('actionStatusMap' in tab).toBe(false)

        const statusKeys = new Set(tab.statuses.map((status) => status.key))
        for (const [statusKey, actions] of Object.entries(tab.statusActions ?? {})) {
          expect(statusKeys.has(statusKey)).toBe(true)
          for (const action of actions ?? []) {
            if (action.nextStatus) {
              expect(statusKeys.has(action.nextStatus)).toBe(true)
            }
          }
        }
      }
    }
  })

  it('keeps crm-sales cars statuses system-driven instead of manual assign or close actions', () => {
    const carsTab = subsystems
      .find((subsystem) => subsystem.slug === 'crm-sales')
      ?.tabs.find((tab) => tab.slug === 'cars')

    expect(carsTab).toBeDefined()
    expect(carsTab?.actions.some((action) => action.key === 'assign')).toBe(false)
    expect(carsTab?.actions.some((action) => action.key === 'close')).toBe(false)
  })

  it('hides status ui for crm-sales clients and keeps card actions statusless', () => {
    const clientsTab = subsystems
      .find((subsystem) => subsystem.slug === 'crm-sales')
      ?.tabs.find((tab) => tab.slug === 'clients')

    expect(clientsTab).toBeDefined()
    expect(clientsTab?.hideStatusUi).toBe(true)
    expect(clientsTab?.statusActions?.active?.map((action) => action.key)).toEqual(['edit', 'delete'])
    expect(clientsTab?.statusActions?.paused?.map((action) => action.key)).toEqual(['edit', 'delete'])
    expect(clientsTab?.statusActions?.archived?.map((action) => action.key)).toEqual(['edit', 'delete'])
  })

  it('keeps platform roles as a read-only system catalog', () => {
    const rolesTab = subsystems
      .find((subsystem) => subsystem.slug === 'platform')
      ?.tabs.find((tab) => tab.slug === 'roles')

    expect(rolesTab).toBeDefined()
    expect(rolesTab?.actions).toEqual([])
    expect(rolesTab?.createFields).toEqual([])
    expect(rolesTab?.statusActions).toEqual({})
  })
})
