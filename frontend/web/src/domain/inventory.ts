import { formatMoneyString } from './formatters'
import type { EntityRecord } from './model'

export const INVENTORY_STOCK_STORE_KEY = 'inventory/stock'
export const INVENTORY_PURCHASES_STORE_KEY = 'inventory/purchases'
export const INVENTORY_DOCUMENTS_STORE_KEY = 'inventory/documents'
export const FINANCE_INVOICES_STORE_KEY = 'finance/invoices'

export const INVENTORY_PURCHASE_RECEIVED_STATUS = 'received'

type EntityValues = EntityRecord | Record<string, string>

function valuesOf(entity: EntityValues): Record<string, string> {
  const maybeRecord = entity as EntityRecord
  return typeof maybeRecord.values === 'object' && maybeRecord.values !== null
    ? maybeRecord.values
    : (entity as Record<string, string>)
}

function parseCount(value: string | undefined): number {
  const normalized = (value ?? '').replace(/\s+/g, '')
  const parsed = Number(normalized)
  return Number.isNaN(parsed) ? 0 : parsed
}

function hasNumericInput(value: string | undefined): boolean {
  return /\d/.test(value ?? '')
}

export function normalizeInventoryPurchaseQuantity(value: string | undefined): string {
  if (!hasNumericInput(value)) {
    return ''
  }
  return String(parseCount(value))
}

export function normalizeInventoryPurchaseUnitPrice(value: string | undefined): string {
  return formatMoneyString(value ?? '')
}

export function computeInventoryPurchaseAmount(
  unitPriceValue: string | undefined,
  quantityValue: string | undefined,
): string {
  if (!hasNumericInput(unitPriceValue) || !hasNumericInput(quantityValue)) {
    return ''
  }

  const unitPrice = parseCount(unitPriceValue)
  const quantity = parseCount(quantityValue)
  return formatMoneyString(String(unitPrice * quantity))
}

export function normalizeInventoryPurchaseValues(
  values: Record<string, string>,
): Record<string, string> {
  const quantity = normalizeInventoryPurchaseQuantity(values.quantity)
  const unitPrice = normalizeInventoryPurchaseUnitPrice(values.unitPrice)
  return {
    ...values,
    quantity,
    unitPrice,
    amount: computeInventoryPurchaseAmount(unitPrice, quantity),
  }
}

export function getInventoryPurchaseQuantity(entity: EntityValues): number {
  const values = valuesOf(entity)
  if (hasNumericInput(values.quantity)) {
    return parseCount(values.quantity)
  }
  return hasNumericInput(values.amount) ? 1 : 0
}

export function getInventoryPurchaseUnitPrice(entity: EntityValues): number {
  const values = valuesOf(entity)
  if (hasNumericInput(values.unitPrice)) {
    return parseCount(values.unitPrice)
  }

  const quantity = getInventoryPurchaseQuantity(values)
  if (quantity <= 0) {
    return 0
  }

  return Math.round(parseCount(values.amount) / quantity)
}

export function findLatestInventoryPurchase(
  purchaseRecords: EntityRecord[],
  stockItemId: string,
  excludedRecordId?: string,
): EntityRecord | undefined {
  const normalizedStockItemId = stockItemId.trim()
  if (!normalizedStockItemId) {
    return undefined
  }

  return purchaseRecords.find(
    (record) =>
      record.id !== excludedRecordId &&
      record.status !== 'cancelled' &&
      record.values.stockItemId === normalizedStockItemId,
  )
}

export function findLatestInventoryPurchaseUnitPrice(
  purchaseRecords: EntityRecord[],
  stockItemId: string,
  excludedRecordId?: string,
): string {
  const latestPurchase = findLatestInventoryPurchase(
    purchaseRecords,
    stockItemId,
    excludedRecordId,
  )
  if (!latestPurchase) {
    return ''
  }

  return normalizeInventoryPurchaseUnitPrice(
    String(getInventoryPurchaseUnitPrice(latestPurchase)),
  )
}

export function getInventoryStockAvailable(entity: EntityValues): number {
  return parseCount(valuesOf(entity).available)
}

export function getInventoryStockReserved(entity: EntityValues): number {
  return parseCount(valuesOf(entity).reserved)
}

export function getInventoryStockMinimum(entity: EntityValues): number {
  return parseCount(valuesOf(entity).min)
}

export function computeInventoryStockStatus(
  available: number,
  minimum: number,
): 'normal' | 'low' | 'critical' {
  if (available <= 0 || (minimum > 0 && available < minimum)) {
    return 'critical'
  }

  const lowThreshold = minimum > 0 ? minimum + Math.max(2, Math.ceil(minimum * 0.2)) : 3
  if (available <= lowThreshold) {
    return 'low'
  }

  return 'normal'
}

export function computeInventoryStockStatusFromValues(
  values: Record<string, string>,
): 'normal' | 'low' | 'critical' {
  return computeInventoryStockStatus(
    getInventoryStockAvailable(values),
    getInventoryStockMinimum(values),
  )
}

export function buildInventoryStockReference(record: EntityRecord): string {
  const sku = (record.values.sku ?? '').trim()
  return sku ? `${record.id} / ${record.title} / ${sku}` : `${record.id} / ${record.title}`
}

export function buildInventoryStockOptionLabel(record: EntityRecord): string {
  const warehouse = (record.values.warehouse ?? '').trim()
  const available = getInventoryStockAvailable(record)
  const parts = [
    buildInventoryStockReference(record),
    warehouse ? `склад ${warehouse}` : '',
    `доступно ${available}`,
  ].filter(Boolean)
  return parts.join(' / ')
}

export function resolveInventoryStockValue(
  stockItemId: string,
  stockRecords: EntityRecord[],
): string {
  if (!stockItemId.trim()) {
    return '-'
  }

  const record = stockRecords.find((item) => item.id === stockItemId)
  return record ? buildInventoryStockReference(record) : stockItemId
}

export function findInventoryPurchaseDocument(
  documentRecords: EntityRecord[],
  purchaseId: string,
): EntityRecord | undefined {
  return documentRecords.find((record) => record.values.purchaseId === purchaseId)
}

export function findInventoryPurchaseInvoice(
  invoiceRecords: EntityRecord[],
  purchaseId: string,
): EntityRecord | undefined {
  return invoiceRecords.find((record) => record.values.purchaseId === purchaseId)
}

export function isInventoryPurchaseInvoiceLocked(invoiceStatus: string): boolean {
  return invoiceStatus === 'paid'
}

export function canCancelInventoryPurchase(invoiceRecord?: EntityRecord): boolean {
  if (!invoiceRecord) {
    return true
  }

  const paidAmount = Number((invoiceRecord.values.paidAmount ?? '').replace(/\s+/g, ''))
  return !isInventoryPurchaseInvoiceLocked(invoiceRecord.status) && !(Number.isFinite(paidAmount) && paidAmount > 0)
}

export function isOpenInventoryPurchaseStatus(status: string): boolean {
  return status !== 'closed' && status !== 'cancelled'
}

export function countOpenInventoryPurchases(
  purchaseRecords: EntityRecord[],
  stockItemId: string,
): number {
  return purchaseRecords.filter(
    (record) =>
      record.values.stockItemId === stockItemId &&
      isOpenInventoryPurchaseStatus(record.status),
  ).length
}

export function buildInventoryPurchaseTitle(stockTitle: string): string {
  return `Закупка: ${stockTitle}`
}
