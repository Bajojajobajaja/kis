import { createIdempotencyKey, withIdempotencyRetry } from './idempotency'
import type { EntityRecord } from './model'

const INVENTORY_STOCK_API_BASE = '/svc/inventory-stock'

const inventoryStockSyncSignatures = new Map<string, string>()
const inventoryStockSyncInFlight = new Map<string, Promise<void>>()
const inventoryStockPresenceChecks = new Map<string, Promise<void>>()

export type InventoryStockUpsertRequest = {
  sku: string
  location: string
  on_hand: number
  reserved: number
  min_qty: number
  max_qty: number
  reorder_point: number
}

type InventoryStockServiceItem = {
  sku: string
  location: string
  on_hand: number
  reserved: number
  min_qty: number
  max_qty: number
  reorder_point: number
}

function normalizeSKU(value: string): string {
  return value.trim().toUpperCase()
}

function normalizeLocation(value: string): string {
  return value.trim()
}

function parseNonNegativeInteger(value: string | undefined): number {
  const parsed = Number((value ?? '').trim())
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0
  }
  return Math.floor(parsed)
}

async function requestJSON<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(input, init)
  if (!response.ok) {
    let errorMessage = `${response.status} ${response.statusText}`
    try {
      const payload = (await response.json()) as { error?: string }
      if (payload.error) {
        errorMessage = payload.error
      }
    } catch {
      // ignore response parsing errors for non-json failures
    }
    throw new Error(errorMessage)
  }
  return (await response.json()) as T
}

export function buildInventoryStockUpsertRequest(
  values: Record<string, string>,
): InventoryStockUpsertRequest {
  const sku = normalizeSKU(values.sku ?? '')
  const location = normalizeLocation(values.warehouse ?? '')
  if (!sku) {
    throw new Error('У складской позиции должен быть заполнен SKU.')
  }
  if (!location) {
    throw new Error('У складской позиции должен быть заполнен склад.')
  }

  const available = parseNonNegativeInteger(values.available)
  const reserved = parseNonNegativeInteger(values.reserved)
  const minQty = parseNonNegativeInteger(values.min)

  return {
    sku,
    location,
    on_hand: available + reserved,
    reserved,
    min_qty: minQty,
    max_qty: 0,
    reorder_point: minQty,
  }
}

function buildInventoryStockSyncSignature(request: InventoryStockUpsertRequest): string {
  return JSON.stringify(request)
}

function buildInventoryStockServiceItemSignature(item: InventoryStockServiceItem): string {
  return buildInventoryStockSyncSignature({
    sku: normalizeSKU(item.sku),
    location: normalizeLocation(item.location),
    on_hand: item.on_hand,
    reserved: item.reserved,
    min_qty: item.min_qty,
    max_qty: item.max_qty,
    reorder_point: item.reorder_point,
  })
}

async function fetchInventoryStockItems(sku: string): Promise<InventoryStockServiceItem[]> {
  return requestJSON<InventoryStockServiceItem[]>(
    `${INVENTORY_STOCK_API_BASE}/stock?sku=${encodeURIComponent(sku)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    },
  )
}

export async function upsertInventoryStockValues(
  values: Record<string, string>,
  syncKey?: string,
): Promise<void> {
  const request = buildInventoryStockUpsertRequest(values)
  const signature = buildInventoryStockSyncSignature(request)
  const resolvedSyncKey = syncKey?.trim() || `${request.sku}@${request.location}`

  if (inventoryStockSyncSignatures.get(resolvedSyncKey) === signature) {
    return
  }

  const dedupeKey = `${resolvedSyncKey}:${signature}`
  const inFlight = inventoryStockSyncInFlight.get(dedupeKey)
  if (inFlight) {
    await inFlight
    return
  }
  const idempotencyKey = createIdempotencyKey(`stock-sync-${resolvedSyncKey}`)

  const requestPromise = withIdempotencyRetry(() =>
    requestJSON(
      `${INVENTORY_STOCK_API_BASE}/stock`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(request),
      },
    ),
  )
    .then(() => {
      inventoryStockSyncSignatures.set(resolvedSyncKey, signature)
    })
    .finally(() => {
      if (inventoryStockSyncInFlight.get(dedupeKey) === requestPromise) {
        inventoryStockSyncInFlight.delete(dedupeKey)
      }
    })

  inventoryStockSyncInFlight.set(dedupeKey, requestPromise)
  await requestPromise
}

export async function upsertInventoryStockRecord(record: EntityRecord): Promise<void> {
  await upsertInventoryStockValues(record.values, record.id)
}

export async function reconcileInventoryStockRecords(records: EntityRecord[]): Promise<void> {
  await Promise.all(
    records.map(async (record) => {
      const request = buildInventoryStockUpsertRequest(record.values)
      const syncKey = record.id
      const existingSignature = inventoryStockSyncSignatures.get(syncKey)
      const localSignature = buildInventoryStockSyncSignature(request)
      if (existingSignature === localSignature) {
        return
      }

      const presenceKey = `${request.sku}@${request.location}`
      const inFlight = inventoryStockPresenceChecks.get(presenceKey)
      if (inFlight) {
        await inFlight
        return
      }

      const presencePromise = (async () => {
        const items = await fetchInventoryStockItems(request.sku)
        const existing = items.find(
          (item) =>
            normalizeSKU(item.sku) === request.sku &&
            normalizeLocation(item.location).toLowerCase() === request.location.toLowerCase(),
        )

        if (existing) {
          inventoryStockSyncSignatures.set(syncKey, buildInventoryStockServiceItemSignature(existing))
          return
        }

        await upsertInventoryStockValues(record.values, syncKey)
      })().finally(() => {
        if (inventoryStockPresenceChecks.get(presenceKey) === presencePromise) {
          inventoryStockPresenceChecks.delete(presenceKey)
        }
      })

      inventoryStockPresenceChecks.set(presenceKey, presencePromise)
      await presencePromise
    }),
  )
}
