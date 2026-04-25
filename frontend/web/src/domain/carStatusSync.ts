import { CARS_STORE_KEY, DEALS_STORE_KEY, VIN_FIELD_KEY } from './dealCarInfo'
import { SERVICE_ORDERS_STORE_KEY } from './finance'
import type { EntityRecord } from './model'

export type EntityStoreSnapshot = Record<string, EntityRecord[]>

const CAR_STATUS_ACTIVE = 'active'
const CAR_STATUS_ARCHIVED = 'archived'
const CAR_STATUS_IN_SERVICE = 'in_service'
const CAR_STATUS_SOLD = 'sold'
const CLOSED_STATUS = 'closed'

export const SALE_OWNER_DEAL_ID_FIELD = 'saleOwnerDealId'
export const SALE_PREVIOUS_OWNER_CLIENT_FIELD = 'salePreviousOwnerClient'

type DerivedCarState = {
  status: string
  soldDeal?: EntityRecord
}

function normalizeVIN(value: string): string {
  return value.trim().toUpperCase()
}

function collectCarIdentifiers(car: EntityRecord): Set<string> {
  const identifiers = new Set<string>()
  const recordId = car.id.trim()
  const vin = normalizeVIN(car.values[VIN_FIELD_KEY] ?? '')

  if (recordId) {
    identifiers.add(recordId)
  }
  if (vin) {
    identifiers.add(vin)
  }

  return identifiers
}

function findRelatedCarId(record: EntityRecord): string {
  return (
    record.related.find((item) => item.storeKey === CARS_STORE_KEY && item.recordId?.trim())?.recordId?.trim() ??
    ''
  )
}

function resolveLinkedCarIds(record: EntityRecord, cars: EntityRecord[]): string[] {
  const resolved = new Set<string>()
  const relatedCarId = findRelatedCarId(record)
  const technicalCarId = (record.values.carRecordId ?? '').trim()
  const reference = (record.values[VIN_FIELD_KEY] ?? '').trim()
  const normalizedReference = normalizeVIN(reference)

  if (relatedCarId) {
    resolved.add(relatedCarId)
  }
  if (technicalCarId) {
    resolved.add(technicalCarId)
  }

  for (const car of cars) {
    const identifiers = collectCarIdentifiers(car)
    if (reference && identifiers.has(reference)) {
      resolved.add(car.id)
      continue
    }
    if (normalizedReference && identifiers.has(normalizedReference)) {
      resolved.add(car.id)
    }
  }

  return [...resolved]
}

function deriveCarStates(store: EntityStoreSnapshot): Map<string, DerivedCarState> {
  const cars = store[CARS_STORE_KEY] ?? []
  const soldDealsByCarID = new Map<string, EntityRecord>()
  const serviceCars = new Set<string>()

  for (const deal of store[DEALS_STORE_KEY] ?? []) {
    if (deal.status !== CLOSED_STATUS) {
      continue
    }
    for (const carId of resolveLinkedCarIds(deal, cars)) {
      soldDealsByCarID.set(carId, deal)
    }
  }

  for (const workorder of store[SERVICE_ORDERS_STORE_KEY] ?? []) {
    if (workorder.status === CLOSED_STATUS) {
      continue
    }
    for (const carId of resolveLinkedCarIds(workorder, cars)) {
      serviceCars.add(carId)
    }
  }

  return new Map(
    cars.map((car) => {
      if (car.status === CAR_STATUS_ARCHIVED) {
        return [car.id, { status: CAR_STATUS_ARCHIVED } satisfies DerivedCarState]
      }

      const soldDeal = soldDealsByCarID.get(car.id)
      if (soldDeal) {
        return [car.id, { status: CAR_STATUS_SOLD, soldDeal } satisfies DerivedCarState]
      }

      if (serviceCars.has(car.id)) {
        return [car.id, { status: CAR_STATUS_IN_SERVICE } satisfies DerivedCarState]
      }

      return [car.id, { status: CAR_STATUS_ACTIVE } satisfies DerivedCarState]
    }),
  )
}

function buildSyncedCarValues(
  car: EntityRecord,
  soldDeal?: EntityRecord,
): Record<string, string> {
  const nextValues = { ...car.values }
  const currentOwner = (car.values.ownerClient ?? '').trim()
  const currentSaleDealID = (car.values[SALE_OWNER_DEAL_ID_FIELD] ?? '').trim()
  const previousOwner = (car.values[SALE_PREVIOUS_OWNER_CLIENT_FIELD] ?? '').trim()

  if (soldDeal) {
    const buyer = (soldDeal.values.client ?? '').trim()
    if (buyer) {
      nextValues.ownerClient = buyer
    }
    nextValues[SALE_OWNER_DEAL_ID_FIELD] = soldDeal.id

    if (currentSaleDealID !== soldDeal.id && currentOwner && currentOwner !== buyer) {
      nextValues[SALE_PREVIOUS_OWNER_CLIENT_FIELD] = currentOwner
    } else if (previousOwner && previousOwner !== buyer) {
      nextValues[SALE_PREVIOUS_OWNER_CLIENT_FIELD] = previousOwner
    } else {
      delete nextValues[SALE_PREVIOUS_OWNER_CLIENT_FIELD]
    }

    return nextValues
  }

  if (currentSaleDealID) {
    if (previousOwner) {
      nextValues.ownerClient = previousOwner
    }
    delete nextValues[SALE_OWNER_DEAL_ID_FIELD]
    delete nextValues[SALE_PREVIOUS_OWNER_CLIENT_FIELD]
  }

  return nextValues
}

function areSameValues(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if ((left[key] ?? '') !== (right[key] ?? '')) {
      return false
    }
  }
  return true
}

export function deriveCarStatuses(store: EntityStoreSnapshot): Map<string, string> {
  const derivedStates = deriveCarStates(store)
  return new Map(
    [...derivedStates.entries()].map(([carID, state]) => [carID, state.status]),
  )
}

export function synchronizeCarStatuses(
  store: EntityStoreSnapshot,
  options: {
    onStatusChange?: (record: EntityRecord, nextStatus: string) => EntityRecord
    onSync?: (record: EntityRecord, nextStatus: string, nextValues: Record<string, string>) => EntityRecord
  } = {},
): EntityStoreSnapshot {
  const cars = store[CARS_STORE_KEY] ?? []
  if (cars.length === 0) {
    return store
  }

  const nextStates = deriveCarStates(store)
  let changed = false

  const nextCars = cars.map((car) => {
    const nextState = nextStates.get(car.id)
    const nextStatus = nextState?.status ?? car.status
    const nextValues = buildSyncedCarValues(car, nextState?.soldDeal)
    const statusChanged = nextStatus !== car.status
    const valuesChanged = !areSameValues(nextValues, car.values)

    if (!statusChanged && !valuesChanged) {
      return car
    }

    changed = true
    if (options.onSync) {
      return options.onSync(car, nextStatus, nextValues)
    }

    if (options.onStatusChange) {
      const syncedRecord = options.onStatusChange(car, nextStatus)
      return {
        ...syncedRecord,
        status: nextStatus,
        values: nextValues,
      }
    }

    return {
      ...car,
      status: nextStatus,
      values: nextValues,
    }
  })

  if (!changed) {
    return store
  }

  return {
    ...store,
    [CARS_STORE_KEY]: nextCars,
  }
}
