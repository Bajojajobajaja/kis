import { describe, expect, it } from 'vitest'

import {
  SALE_OWNER_DEAL_ID_FIELD,
  SALE_PREVIOUS_OWNER_CLIENT_FIELD,
  synchronizeCarStatuses,
  type EntityStoreSnapshot,
} from './carStatusSync'
import type { EntityRecord } from './model'

function buildRecord(
  id: string,
  status: string,
  values: Record<string, string> = {},
  related: EntityRecord['related'] = [],
): EntityRecord {
  return {
    id,
    title: id,
    subtitle: '',
    status,
    values,
    history: [],
    related,
  }
}

describe('synchronizeCarStatuses', () => {
  it('derives sold, in_service, archived and active statuses from related records', () => {
    const store: EntityStoreSnapshot = {
      'crm-sales/cars': [
        buildRecord('CAR-0001', 'active', { vin: 'VIN-001' }),
        buildRecord('CAR-0002', 'active', { vin: 'VIN-002' }),
        buildRecord('CAR-0003', 'archived', { vin: 'VIN-003' }),
        buildRecord('CAR-0004', 'sold', { vin: 'VIN-004' }),
      ],
      'crm-sales/deals': [
        buildRecord('DL-0001', 'closed', { vin: 'VIN-001' }),
        buildRecord('DL-0002', 'closed', {}, [
          {
            id: 'rel-deal-car',
            label: 'Автомобиль',
            value: 'CAR-0003',
            storeKey: 'crm-sales/cars',
            recordId: 'CAR-0003',
          },
        ]),
      ],
      'service/orders': [
        buildRecord('WO-0001', 'opened', { vin: 'CAR-0001' }),
        buildRecord('WO-0002', 'in_progress', { vin: 'VIN-002' }),
      ],
    }

    const synced = synchronizeCarStatuses(store)
    const cars = synced['crm-sales/cars']

    expect(cars.find((record) => record.id === 'CAR-0001')?.status).toBe('sold')
    expect(cars.find((record) => record.id === 'CAR-0002')?.status).toBe('in_service')
    expect(cars.find((record) => record.id === 'CAR-0003')?.status).toBe('archived')
    expect(cars.find((record) => record.id === 'CAR-0004')?.status).toBe('active')
  })

  it('supports status-change hooks for automatic history updates', () => {
    const store: EntityStoreSnapshot = {
      'crm-sales/cars': [buildRecord('CAR-0001', 'active', { vin: 'VIN-001' })],
      'crm-sales/deals': [],
      'service/orders': [buildRecord('WO-0001', 'diagnostics', { carRecordId: 'CAR-0001' })],
    }

    const synced = synchronizeCarStatuses(store, {
      onStatusChange: (record, nextStatus) => ({
        ...record,
        status: nextStatus,
        history: [
          {
            id: 'h-1',
            at: '2026-03-13 12:00',
            text: `auto:${nextStatus}`,
          },
        ],
      }),
    })

    expect(synced['crm-sales/cars'][0].status).toBe('in_service')
    expect(synced['crm-sales/cars'][0].history).toEqual([
      {
        id: 'h-1',
        at: '2026-03-13 12:00',
        text: 'auto:in_service',
      },
    ])
  })

  it('transfers the owner to the buyer on sale and restores it after reopen', () => {
    const soldStore: EntityStoreSnapshot = {
      'crm-sales/cars': [
        buildRecord('CAR-0001', 'active', {
          vin: 'VIN-001',
          ownerClient: 'CL-SELLER',
        }),
      ],
      'crm-sales/deals': [
        buildRecord('DL-0001', 'closed', {
          client: 'CL-BUYER',
          carRecordId: 'CAR-0001',
        }),
      ],
      'service/orders': [],
    }

    const soldSynced = synchronizeCarStatuses(soldStore)
    const soldCar = soldSynced['crm-sales/cars'][0]
    expect(soldCar.status).toBe('sold')
    expect(soldCar.values.ownerClient).toBe('CL-BUYER')
    expect(soldCar.values[SALE_OWNER_DEAL_ID_FIELD]).toBe('DL-0001')
    expect(soldCar.values[SALE_PREVIOUS_OWNER_CLIENT_FIELD]).toBe('CL-SELLER')

    const reopenedStore: EntityStoreSnapshot = {
      ...soldSynced,
      'crm-sales/deals': [
        buildRecord('DL-0001', 'new', {
          client: 'CL-BUYER',
          carRecordId: 'CAR-0001',
        }),
      ],
    }

    const reopenedSynced = synchronizeCarStatuses(reopenedStore)
    const reopenedCar = reopenedSynced['crm-sales/cars'][0]
    expect(reopenedCar.status).toBe('active')
    expect(reopenedCar.values.ownerClient).toBe('CL-SELLER')
    expect(reopenedCar.values[SALE_OWNER_DEAL_ID_FIELD]).toBeUndefined()
    expect(reopenedCar.values[SALE_PREVIOUS_OWNER_CLIENT_FIELD]).toBeUndefined()
  })
})
