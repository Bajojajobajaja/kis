import { describe, expect, it } from 'vitest'

import {
  buildEntityRecordPath,
  getReferenceTextFieldKey,
  matchStoreReferenceRecords,
  resolveStoreReferenceLabel,
  resolveStoreReferencePath,
  setStoreReferenceCustomText,
  setStoreReferenceRecordId,
} from './entityReferences'
import type { EntityRecord } from './model'

const clients: EntityRecord[] = [
  {
    id: 'CL-0001',
    title: 'ООО Автопарк',
    subtitle: '',
    status: 'active',
    values: {},
    history: [],
    related: [],
  },
]

const cars: EntityRecord[] = [
  {
    id: 'CAR-0001',
    title: 'Toyota Camry',
    subtitle: '',
    status: 'active',
    values: { vin: 'VIN-001' },
    history: [],
    related: [],
  },
]

const getRecords = (storeKey: string) => {
  if (storeKey === 'crm-sales/clients') {
    return clients
  }
  if (storeKey === 'crm-sales/cars') {
    return cars
  }
  return []
}

describe('entityReferences', () => {
  it('stores selected references as record ids and clears fallback text', () => {
    const nextValues = setStoreReferenceRecordId(
      {
        client: '',
        [getReferenceTextFieldKey('client')]: 'ООО Автопарк',
      },
      'client',
      'CL-0001',
    )

    expect(nextValues.client).toBe('CL-0001')
    expect(nextValues.clientText).toBe('')
  })

  it('stores custom references in companion text fields', () => {
    const nextValues = setStoreReferenceCustomText({ client: 'CL-0001' }, 'client', 'Новый клиент')

    expect(nextValues.client).toBe('')
    expect(nextValues.clientText).toBe('Новый клиент')
  })

  it('resolves labels and paths from ids and legacy values', () => {
    const clientSource = {
      type: 'store',
      storeKey: 'crm-sales/clients',
      valueKey: 'id',
      labelKey: 'title',
    } as const
    const carSource = {
      type: 'store',
      storeKey: 'crm-sales/cars',
      valueKey: 'id',
      labelKey: 'vin',
    } as const

    expect(resolveStoreReferenceLabel(clientSource, 'CL-0001', getRecords)).toBe('ООО Автопарк')
    expect(resolveStoreReferencePath(clientSource, 'CL-0001', getRecords)).toBe(
      buildEntityRecordPath('crm-sales/clients', 'CL-0001'),
    )

    expect(matchStoreReferenceRecords(carSource, 'VIN-001', getRecords)).toHaveLength(1)
    expect(resolveStoreReferenceLabel(carSource, 'VIN-001', getRecords)).toBe('VIN-001')
  })
})
