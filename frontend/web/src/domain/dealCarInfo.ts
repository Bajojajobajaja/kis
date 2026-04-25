import type { EntityRecord } from './model'

export const DEALS_STORE_KEY = 'crm-sales/deals'
export const CARS_STORE_KEY = 'crm-sales/cars'
export const VIN_FIELD_KEY = 'vin'

const DEAL_CAR_BASE_KEYS = ['carRecordId', 'carRecordTitle', 'carRecordSubtitle', 'carRecordStatus']
const DEAL_CAR_FALLBACK_VALUE_KEYS = [
  'brand',
  'model',
  'year',
  'plateNumber',
  'mileage',
  'color',
  'ownerClient',
  'note',
]

function normalizeVIN(value: string): string {
  return value.trim().toUpperCase()
}

function resolveCarByReference(reference: string, cars: EntityRecord[]): EntityRecord | undefined {
  const trimmedReference = reference.trim()
  if (!trimmedReference) {
    return undefined
  }

  return (
    cars.find((item) => item.id === trimmedReference) ??
    cars.find((item) => normalizeVIN(item.values[VIN_FIELD_KEY] ?? '') === normalizeVIN(trimmedReference))
  )
}

function toCarValueKey(rawKey: string): string {
  if (!rawKey) {
    return 'carValue'
  }
  return `car${rawKey[0].toUpperCase()}${rawKey.slice(1)}`
}

function uniqueKeys(keys: string[]): string[] {
  return Array.from(new Set(keys))
}

function resolveDealCarValueKeys(cars: EntityRecord[]): string[] {
  const fromCars = cars.flatMap((car) => Object.keys(car.values).map(toCarValueKey))
  const fallback = DEAL_CAR_FALLBACK_VALUE_KEYS.map(toCarValueKey)
  return uniqueKeys([...fromCars, ...fallback])
}

export function enrichDealValuesWithCarInfo(
  values: Record<string, string>,
  cars: EntityRecord[],
): Record<string, string> {
  const next = { ...values }
  const carReference = (next[VIN_FIELD_KEY] ?? '').trim()

  for (const key of DEAL_CAR_BASE_KEYS) {
    delete next[key]
  }
  for (const key of resolveDealCarValueKeys(cars)) {
    delete next[key]
  }

  if (!carReference) {
    return next
  }

  const car = resolveCarByReference(carReference, cars)
  if (!car) {
    return next
  }

  next[VIN_FIELD_KEY] = car.id

  next.carRecordId = car.id
  next.carRecordTitle = car.title
  next.carRecordSubtitle = car.subtitle
  next.carRecordStatus = car.status

  for (const [rawKey, rawValue] of Object.entries(car.values)) {
    next[toCarValueKey(rawKey)] = rawValue
  }

  if (!next.client?.trim() && car.values.ownerClient?.trim()) {
    next.client = car.values.ownerClient.trim()
  }

  return next
}

export function prefillDealAmountFromCarInfo(
  previousValues: Record<string, string>,
  nextValues: Record<string, string>,
): Record<string, string> {
  const previousAmount = (previousValues.amount ?? '').trim()
  const previousCarPrice = (previousValues.carPrice ?? '').trim()
  const nextCarPrice = (nextValues.carPrice ?? '').trim()

  if (!nextCarPrice) {
    return nextValues
  }

  if (!previousAmount || previousAmount === previousCarPrice) {
    return { ...nextValues, amount: nextCarPrice }
  }

  return nextValues
}

