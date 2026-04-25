import { VIN_FIELD_KEY } from './dealCarInfo'
import type { EntityRecord } from './model'
import type { ServicePartsUsageRecord } from './servicePartsUsageApi'

export type CarDemandModelItem = {
  key: string
  label: string
  salesCount: number
  revenue: number
}

export type CarDemandVehicleItem = {
  key: string
  carId: string
  label: string
  vin: string
  salesCount: number
  revenue: number
}

export type PartsDemandItem = {
  key: string
  title: string
  quantity: number
  operations: number
}

function parseMoney(value: string | undefined): number {
  const normalized = (value ?? '').replace(/\s+/g, '')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeVIN(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase()
}

function resolveDealCar(deal: EntityRecord, cars: EntityRecord[]): EntityRecord | undefined {
  const carRecordId = (deal.values.carRecordId ?? '').trim()
  if (carRecordId) {
    const byID = cars.find((car) => car.id === carRecordId)
    if (byID) {
      return byID
    }
  }

  const rawReference = (deal.values[VIN_FIELD_KEY] ?? '').trim()
  if (!rawReference) {
    return undefined
  }

  return cars.find((car) =>
    car.id === rawReference ||
    normalizeVIN(car.values[VIN_FIELD_KEY]) === normalizeVIN(rawReference),
  )
}

function compareDemand<T extends { salesCount?: number; revenue?: number; quantity?: number; label?: string; title?: string }>(
  left: T,
  right: T,
): number {
  const rightPrimary = right.salesCount ?? right.quantity ?? 0
  const leftPrimary = left.salesCount ?? left.quantity ?? 0
  if (rightPrimary !== leftPrimary) {
    return rightPrimary - leftPrimary
  }

  const rightRevenue = right.revenue ?? 0
  const leftRevenue = left.revenue ?? 0
  if (rightRevenue !== leftRevenue) {
    return rightRevenue - leftRevenue
  }

  return (left.label ?? left.title ?? '').localeCompare(right.label ?? right.title ?? '', 'ru')
}

export function buildCarDemandAnalytics(
  deals: EntityRecord[],
  cars: EntityRecord[],
): {
  models: CarDemandModelItem[]
  vehicles: CarDemandVehicleItem[]
} {
  const modelMap = new Map<string, CarDemandModelItem>()
  const vehicleMap = new Map<string, CarDemandVehicleItem>()

  for (const deal of deals) {
    if (deal.status !== 'closed') {
      continue
    }

    const car = resolveDealCar(deal, cars)
    const brand = (car?.values.brand ?? deal.values.carBrand ?? '').trim()
    const model = (car?.values.model ?? deal.values.carModel ?? '').trim()
    const carID = (car?.id ?? deal.values.carRecordId ?? '').trim()
    const carTitle = (car?.title ?? deal.values.carRecordTitle ?? deal.title).trim()
    const vin = normalizeVIN(car?.values[VIN_FIELD_KEY] ?? deal.values.carVin ?? deal.values[VIN_FIELD_KEY])
    const revenue = parseMoney(deal.values.amount)

    const modelLabel = [brand, model].filter(Boolean).join(' ').trim() || carTitle || vin || deal.id
    const modelKey = [brand, model].filter(Boolean).join('::') || modelLabel
    const vehicleKey = carID || vin || deal.id
    const vehicleLabel = carTitle || modelLabel

    const currentModel = modelMap.get(modelKey) ?? {
      key: modelKey,
      label: modelLabel,
      salesCount: 0,
      revenue: 0,
    }
    currentModel.salesCount += 1
    currentModel.revenue += revenue
    modelMap.set(modelKey, currentModel)

    const currentVehicle = vehicleMap.get(vehicleKey) ?? {
      key: vehicleKey,
      carId: carID,
      label: vehicleLabel,
      vin: vin || vehicleKey,
      salesCount: 0,
      revenue: 0,
    }
    currentVehicle.salesCount += 1
    currentVehicle.revenue += revenue
    if (!currentVehicle.vin && vin) {
      currentVehicle.vin = vin
    }
    vehicleMap.set(vehicleKey, currentVehicle)
  }

  return {
    models: [...modelMap.values()].sort(compareDemand),
    vehicles: [...vehicleMap.values()].sort(compareDemand),
  }
}

export function buildPartsDemandAnalytics(
  usages: ServicePartsUsageRecord[],
  stockRecords: EntityRecord[],
): PartsDemandItem[] {
  const partTitles = new Map<string, string>()
  for (const stockRecord of stockRecords) {
    const sku = (stockRecord.values.sku ?? '').trim().toUpperCase()
    if (!sku) {
      continue
    }
    partTitles.set(sku, stockRecord.title)
  }

  const demandMap = new Map<string, PartsDemandItem>()
  for (const usage of usages) {
    if ((usage.action ?? '').trim().toLowerCase() !== 'writeoff') {
      continue
    }

    const sku = (usage.part_code ?? '').trim().toUpperCase()
    if (!sku) {
      continue
    }

    const current = demandMap.get(sku) ?? {
      key: sku,
      title: partTitles.get(sku) ?? sku,
      quantity: 0,
      operations: 0,
    }
    current.quantity += Number(usage.quantity) || 0
    current.operations += 1
    demandMap.set(sku, current)
  }

  return [...demandMap.values()].sort(compareDemand)
}
