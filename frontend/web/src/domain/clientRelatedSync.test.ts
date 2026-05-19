import { describe, expect, it } from 'vitest'

import {
  CARS_STORE_KEY,
  CLIENTS_STORE_KEY,
  DEALS_STORE_KEY,
  SERVICE_APPOINTMENTS_STORE_KEY,
  SERVICE_ORDERS_STORE_KEY,
  synchronizeClientRelated,
} from './clientRelatedSync'
import type { EntityRecord } from './model'

function makeRecord(
  id: string,
  title: string,
  values: Record<string, string>,
  subtitle = '',
): EntityRecord {
  return {
    id,
    title,
    subtitle,
    status: 'active',
    values,
    history: [],
    related: [],
  }
}

function baseStore() {
  const client = makeRecord('CL-1', 'ООО Тест', { phone: '+7 000 000-00-00' })
  const car = makeRecord(
    'CAR-1',
    'Toyota Camry',
    { vin: 'VIN-CAMRY', ownerClient: 'ООО Тест' },
  )
  return {
    [CLIENTS_STORE_KEY]: [client],
    [CARS_STORE_KEY]: [car],
    [DEALS_STORE_KEY]: [] as EntityRecord[],
    [SERVICE_ORDERS_STORE_KEY]: [] as EntityRecord[],
    [SERVICE_APPOINTMENTS_STORE_KEY]: [] as EntityRecord[],
  }
}

describe('synchronizeClientRelated', () => {
  it('links a client to a car by ownerClient', () => {
    const store = baseStore()
    const next = synchronizeClientRelated(store)
    const client = next[CLIENTS_STORE_KEY][0]
    expect(client.related).toHaveLength(1)
    expect(client.related[0]).toMatchObject({
      storeKey: CARS_STORE_KEY,
      recordId: 'CAR-1',
      label: 'Автомобиль',
    })
  })

  it('links a client to deals via car id, VIN, or client name match', () => {
    const store = baseStore()
    store[DEALS_STORE_KEY] = [
      makeRecord('DL-1', 'Сделка по carRecordId', { carRecordId: 'CAR-1' }),
      makeRecord('DL-2', 'Сделка по VIN', { vin: 'VIN-CAMRY' }),
      makeRecord('DL-3', 'Сделка по имени клиента', { client: 'ООО Тест' }),
    ]
    const next = synchronizeClientRelated(store)
    const dealIds = next[CLIENTS_STORE_KEY][0].related
      .filter((r) => r.storeKey === DEALS_STORE_KEY)
      .map((r) => r.recordId)
    expect(dealIds.sort()).toEqual(['DL-1', 'DL-2', 'DL-3'])
  })

  it('links a client to workorders only by car VIN (not by client name)', () => {
    const store = baseStore()
    store[SERVICE_ORDERS_STORE_KEY] = [
      makeRecord('WO-1', 'ТО', { vin: 'VIN-CAMRY' }),
      makeRecord('WO-2', 'Чужой авто', { vin: 'VIN-OTHER', client: 'ООО Тест' }),
    ]
    const next = synchronizeClientRelated(store)
    const woIds = next[CLIENTS_STORE_KEY][0].related
      .filter((r) => r.storeKey === SERVICE_ORDERS_STORE_KEY)
      .map((r) => r.recordId)
    expect(woIds).toEqual(['WO-1'])
  })

  it('links a client to appointments only by car VIN', () => {
    const store = baseStore()
    store[SERVICE_APPOINTMENTS_STORE_KEY] = [
      makeRecord('AP-1', 'Запись', { vin: 'VIN-CAMRY' }),
      makeRecord('AP-2', 'Чужая запись', { vin: 'VIN-OTHER' }),
    ]
    const next = synchronizeClientRelated(store)
    const apIds = next[CLIENTS_STORE_KEY][0].related
      .filter((r) => r.storeKey === SERVICE_APPOINTMENTS_STORE_KEY)
      .map((r) => r.recordId)
    expect(apIds).toEqual(['AP-1'])
  })

  it('is idempotent: applying twice returns the same object reference', () => {
    const store = baseStore()
    store[DEALS_STORE_KEY] = [makeRecord('DL-1', 'Сделка', { carRecordId: 'CAR-1' })]
    const first = synchronizeClientRelated(store)
    const second = synchronizeClientRelated(first)
    expect(second).toBe(first)
    expect(second[CLIENTS_STORE_KEY]).toBe(first[CLIENTS_STORE_KEY])
  })

  it('rewrites stale related entries when underlying data disappears', () => {
    const store = baseStore()
    store[CLIENTS_STORE_KEY][0] = {
      ...store[CLIENTS_STORE_KEY][0],
      related: [
        {
          id: 'old',
          label: 'Сделка',
          value: 'DL-OLD',
          storeKey: DEALS_STORE_KEY,
          recordId: 'DL-OLD',
        },
      ],
    }
    const next = synchronizeClientRelated(store)
    const related = next[CLIENTS_STORE_KEY][0].related
    expect(related.find((r) => r.recordId === 'DL-OLD')).toBeUndefined()
    expect(related.find((r) => r.recordId === 'CAR-1')).toBeDefined()
  })

  it('produces stable rel ids that survive re-derivation', () => {
    const store = baseStore()
    const first = synchronizeClientRelated(store)
    const refreshed = {
      ...first,
      [CLIENTS_STORE_KEY]: [
        { ...first[CLIENTS_STORE_KEY][0], related: [] },
      ],
    }
    const second = synchronizeClientRelated(refreshed)
    expect(second[CLIENTS_STORE_KEY][0].related[0].id).toBe(
      first[CLIENTS_STORE_KEY][0].related[0].id,
    )
  })

  it('returns the input untouched when there are no clients', () => {
    const store = { [CARS_STORE_KEY]: [] as EntityRecord[] }
    expect(synchronizeClientRelated(store)).toBe(store)
  })
})
