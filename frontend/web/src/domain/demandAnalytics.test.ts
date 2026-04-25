import { describe, expect, it } from 'vitest'

import { buildCarDemandAnalytics, buildPartsDemandAnalytics } from './demandAnalytics'
import type { EntityRecord } from './model'
import type { ServicePartsUsageRecord } from './servicePartsUsageApi'

function buildRecord(
  id: string,
  status: string,
  values: Record<string, string> = {},
): EntityRecord {
  return {
    id,
    title: id,
    subtitle: '',
    status,
    values,
    history: [],
    related: [],
  }
}

describe('demandAnalytics', () => {
  it('aggregates closed deals by model and by vehicle', () => {
    const cars = [
      buildRecord('CAR-1', 'active', {
        vin: 'VIN-1',
        brand: 'Toyota',
        model: 'Camry',
      }),
      buildRecord('CAR-2', 'active', {
        vin: 'VIN-2',
        brand: 'Toyota',
        model: 'Camry',
      }),
    ]

    const deals = [
      buildRecord('DL-1', 'closed', {
        carRecordId: 'CAR-1',
        amount: '2 100 000',
      }),
      buildRecord('DL-2', 'closed', {
        carRecordId: 'CAR-2',
        amount: '2 200 000',
      }),
      buildRecord('DL-3', 'new', {
        carRecordId: 'CAR-2',
        amount: '2 400 000',
      }),
    ]

    const analytics = buildCarDemandAnalytics(deals, cars)

    expect(analytics.models).toEqual([
      {
        key: 'Toyota::Camry',
        label: 'Toyota Camry',
        salesCount: 2,
        revenue: 4300000,
      },
    ])
    expect(analytics.vehicles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'CAR-1',
          salesCount: 1,
          revenue: 2100000,
        }),
        expect.objectContaining({
          key: 'CAR-2',
          salesCount: 1,
          revenue: 2200000,
        }),
      ]),
    )
  })

  it('aggregates writeoff usages into parts demand', () => {
    const usages: ServicePartsUsageRecord[] = [
      {
        id: 'u-1',
        workorder_id: 'WO-1',
        part_code: 'PART-OIL',
        quantity: 2,
        action: 'writeoff',
        created_at: '2026-03-28T10:00:00Z',
      },
      {
        id: 'u-2',
        workorder_id: 'WO-2',
        part_code: 'PART-OIL',
        quantity: 1,
        action: 'writeoff',
        created_at: '2026-03-28T12:00:00Z',
      },
      {
        id: 'u-3',
        workorder_id: 'WO-3',
        part_code: 'PART-FILTER',
        quantity: 4,
        action: 'reserve',
        created_at: '2026-03-28T13:00:00Z',
      },
    ]

    const stockRecords = [
      buildRecord('STK-1', 'normal', {
        sku: 'PART-OIL',
      }),
    ]
    stockRecords[0].title = 'Oil'

    expect(buildPartsDemandAnalytics(usages, stockRecords)).toEqual([
      {
        key: 'PART-OIL',
        title: 'Oil',
        quantity: 3,
        operations: 2,
      },
    ])
  })
})
