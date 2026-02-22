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
  const normalizedVIN = normalizeVIN(next[VIN_FIELD_KEY] ?? '')
  next[VIN_FIELD_KEY] = normalizedVIN

  for (const key of DEAL_CAR_BASE_KEYS) {
    delete next[key]
  }
  for (const key of resolveDealCarValueKeys(cars)) {
    delete next[key]
  }

  if (!normalizedVIN) {
    return next
  }

  const car = cars.find((item) => normalizeVIN(item.values[VIN_FIELD_KEY] ?? '') === normalizedVIN)
  if (!car) {
    return next
  }

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

