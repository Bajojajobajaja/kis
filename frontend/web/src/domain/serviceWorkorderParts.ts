import { computeInventoryStockStatusFromValues } from './inventory'
import { createIdempotencyKey, isIdempotencyConflictError, withIdempotencyRetry } from './idempotency'
import type { EntityRecord } from './model'

const SERVICE_WORKORDERS_API_BASE = '/svc/service-workorders'
const SERVICE_PARTS_USAGE_API_BASE = '/svc/service-parts-usage'
const INVENTORY_STOCK_API_BASE = '/svc/inventory-stock'
const SERVICE_WORKORDERS_HEADERS = {
  'X-Role': 'service_manager',
  'X-User-ID': 'web-ui',
}
const serviceWorkorderUpsertInFlight = new Map<string, Promise<void>>()
const serviceWorkorderStatusUpdateInFlight = new Map<string, Promise<ServiceWorkorderRecord>>()
const serviceWorkorderCloseInFlight = new Map<string, Promise<ServiceWorkorderCloseResponse>>()
const workorderPartsPlanSaveInFlight = new Map<string, Promise<WorkorderPartsPlanResponse>>()
const workorderPartsWriteoffInFlight = new Map<string, Promise<WorkorderPartsWriteoffResponse>>()

export type WorkorderPartDraftLine = {
  key: string
  sku: string
  title: string
  quantity: string
  availableQuantity: number
  missingQuantity: number
  state: string
  procurementRequestId: string
}

export type WorkorderPartPlanLine = {
  sku: string
  title: string
  quantity: number
  available_quantity: number
  missing_quantity: number
  state: string
  procurement_request_id?: string
}

export type WorkorderProcurementRequest = {
  id: string
  workorder_id: string
  part_code: string
  sku?: string
  missing_quantity: number
  quantity?: number
  status: string
  source?: string
}

export type WorkorderPartsWriteoffResponse = {
  workorder_id: string
  result: 'written_off' | 'waiting_parts'
  workorder_status: string
  issued_lines: WorkorderPartPlanLine[]
  shortages: WorkorderPartPlanLine[]
  procurement_requests: WorkorderProcurementRequest[]
}

export type WorkorderPartsPlanResponse = {
  workorder_id: string
  lines: WorkorderPartPlanLine[]
}

export type ServiceWorkorderSyncPayload = {
  id: string
  client_id: string
  client_name: string
  vehicle_vin: string
  assignee: string
  deadline: string
  status: string
}

export type ServiceWorkorderUpsertRequest = Omit<ServiceWorkorderSyncPayload, 'id'>

export type ServiceWorkorderRecord = {
  id: string
  status: string
  released_at?: string
}

export type ServiceWorkorderCloseStep = {
  name: string
  status: string
  note?: string
}

export type ServiceWorkorderCloseResponse = {
  saga: string
  result: 'completed' | 'failed' | 'compensated'
  steps: ServiceWorkorderCloseStep[]
  workorder: ServiceWorkorderRecord
}

export type ServiceWorkorderClosePreparation =
  | 'already_closed'
  | 'close_directly'
  | 'prepare_before_close'
  | 'blocked'

export type InventoryStockServiceItem = {
  id: string
  sku: string
  location: string
  on_hand: number
  reserved: number
  min_qty: number
  reorder_point: number
}

export type WorkorderPartPlanInputLine = {
  sku: string
  title: string
  quantity: number
}

function nextDraftKey(): string {
  return `part-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

function normalizeSKU(value: string): string {
  return value.trim().toUpperCase()
}

function sanitizeSKU(value: string): string {
  return normalizeSKU(value).replace(/[^A-Z0-9]/g, '')
}

export function resolveServiceWorkorderClosePreparation(
  status: string,
): ServiceWorkorderClosePreparation {
  const normalizedStatus = status.trim().toLowerCase()

  switch (normalizedStatus) {
    case 'closed':
      return 'already_closed'
    case 'ready':
    case 'released':
      return 'close_directly'
    case '':
    case 'opened':
    case 'accepted':
    case 'diagnostics':
    case 'in_progress':
    case 'waiting_parts':
    case 'compensated':
      return 'prepare_before_close'
    default:
      return 'blocked'
  }
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value.trim())
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0
  }
  return Math.floor(parsed)
}

function parseNonNegativeInteger(value: string | undefined): number {
  const parsed = Number((value ?? '').trim())
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0
  }
  return Math.floor(parsed)
}

function toRFC3339Date(raw: string): string {
  const value = raw.trim()
  if (!value) {
    return ''
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T12:00:00Z`
  }
  return value
}

function resolveVIN(record: EntityRecord, carRecords: EntityRecord[]): string {
  const rawValue = (record.values.vin ?? '').trim()
  const referencedCar = carRecords.find((car) => car.id === rawValue)
  if (referencedCar) {
    return (referencedCar.values.vin ?? '').trim().toUpperCase()
  }
  const rawText = (record.values.vinText ?? '').trim()
  if (rawValue.startsWith('CAR-')) {
    return rawText.toUpperCase()
  }
  return (rawText || rawValue).toUpperCase()
}

function resolveClientValue(value: string, customText: string): { id: string; name: string } {
  const trimmedValue = value.trim()
  const trimmedText = customText.trim()
  if (trimmedValue.startsWith('CL-')) {
    return {
      id: trimmedValue,
      name: trimmedText,
    }
  }
  return {
    id: '',
    name: trimmedText || trimmedValue,
  }
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

async function requestServiceWorkordersJSON<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<T> {
  return requestJSON<T>(input, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...SERVICE_WORKORDERS_HEADERS,
      ...(init.headers ?? {}),
    },
  })
}

async function fetchServiceWorkorderOrNull(
  workorderId: string,
): Promise<ServiceWorkorderRecord | null> {
  const response = await fetch(
    `${SERVICE_WORKORDERS_API_BASE}/workorders/${encodeURIComponent(workorderId)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...SERVICE_WORKORDERS_HEADERS,
      },
    },
  )

  if (response.status === 404) {
    return null
  }

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

  return (await response.json()) as ServiceWorkorderRecord
}

export function createEmptyWorkorderPartDraftLine(): WorkorderPartDraftLine {
  return {
    key: nextDraftKey(),
    sku: '',
    title: '',
    quantity: '1',
    availableQuantity: 0,
    missingQuantity: 0,
    state: 'draft',
    procurementRequestId: '',
  }
}

export function toDraftWorkorderPartLines(lines: WorkorderPartPlanLine[]): WorkorderPartDraftLine[] {
  if (lines.length === 0) {
    return [createEmptyWorkorderPartDraftLine()]
  }
  return lines.map((line) => ({
    key: nextDraftKey(),
    sku: line.sku,
    title: line.title,
    quantity: String(line.quantity),
    availableQuantity: line.available_quantity,
    missingQuantity: line.missing_quantity,
    state: line.state,
    procurementRequestId: line.procurement_request_id ?? '',
  }))
}

export function applyWorkorderPartDraftLinePreview(
  line: WorkorderPartDraftLine,
  stockRecords: EntityRecord[],
): WorkorderPartDraftLine {
  const exactRecord = findExactInventoryStockRecord(line.sku, stockRecords)
  const suggestedRecord = exactRecord
    ? undefined
    : findSuggestedInventoryStockRecord(line.sku, line.title, stockRecords)
  const resolvedRecord = exactRecord ?? suggestedRecord
  if (!resolvedRecord) {
    const quantity = parsePositiveInteger(line.quantity)
    return {
      ...line,
      sku: normalizeSKU(line.sku),
      availableQuantity: 0,
      missingQuantity: quantity,
    }
  }

  const canonicalSKU = normalizeSKU(resolvedRecord.values.sku ?? line.sku)
  const canonicalTitle = resolvedRecord.title.trim() || line.title.trim() || canonicalSKU
  if (line.state === 'written_off') {
    return {
      ...line,
      sku: canonicalSKU,
      title: canonicalTitle,
    }
  }

  const availableQuantity = parseNonNegativeInteger(resolvedRecord.values.available)
  const quantity = parsePositiveInteger(line.quantity)
  return {
    ...line,
    sku: canonicalSKU,
    title: canonicalTitle,
    availableQuantity,
    missingQuantity: Math.max(quantity - availableQuantity, 0),
  }
}

export function normalizeWorkorderPartDraftLines(
  lines: WorkorderPartDraftLine[],
): WorkorderPartPlanInputLine[] {
  const grouped = new Map<string, WorkorderPartPlanInputLine>()

  for (const line of lines) {
    const sku = normalizeSKU(line.sku)
    const quantity = parsePositiveInteger(line.quantity)
    if (!sku || quantity <= 0) {
      continue
    }

    const existing = grouped.get(sku)
    if (existing) {
      existing.quantity += quantity
      if (!existing.title && line.title.trim()) {
        existing.title = line.title.trim()
      }
      continue
    }

    grouped.set(sku, {
      sku,
      title: line.title.trim() || sku,
      quantity,
    })
  }

  return [...grouped.values()].sort((left, right) => left.sku.localeCompare(right.sku))
}

function findExactInventoryStockRecord(
  sku: string,
  stockRecords: EntityRecord[],
): EntityRecord | undefined {
  const normalizedSKU = normalizeSKU(sku)
  return stockRecords.find(
    (item) => normalizeSKU(item.values.sku ?? '') === normalizedSKU,
  )
}

function findSuggestedInventoryStockRecord(
  sku: string,
  title: string,
  stockRecords: EntityRecord[],
): EntityRecord | undefined {
  const normalizedTitle = title.trim().toLowerCase()
  const sanitizedInputSKU = sanitizeSKU(sku)

  const titleMatches = normalizedTitle
    ? stockRecords.filter((item) => item.title.trim().toLowerCase() === normalizedTitle)
    : []
  if (titleMatches.length === 1) {
    return titleMatches[0]
  }

  if (!sanitizedInputSKU) {
    return undefined
  }

  const skuMatches = stockRecords.filter((item) => {
    const candidateSKU = sanitizeSKU(item.values.sku ?? '')
    return Boolean(candidateSKU) &&
      (sanitizedInputSKU.includes(candidateSKU) || candidateSKU.includes(sanitizedInputSKU))
  })
  if (skuMatches.length === 1) {
    return skuMatches[0]
  }
  return undefined
}

export function prepareWorkorderPartPlanLines(
  lines: WorkorderPartDraftLine[],
  stockRecords: EntityRecord[],
): WorkorderPartPlanInputLine[] {
  const normalizedLines = normalizeWorkorderPartDraftLines(lines)

  return normalizedLines.map((line) => {
    const exactRecord = findExactInventoryStockRecord(line.sku, stockRecords)
    if (!exactRecord) {
      const suggestedRecord = findSuggestedInventoryStockRecord(line.sku, line.title, stockRecords)
      if (suggestedRecord) {
        const suggestedSKU = normalizeSKU(suggestedRecord.values.sku ?? '')
        throw new Error(`SKU "${line.sku}" не найден на складе. Используйте "${suggestedSKU}".`)
      }
      throw new Error(`SKU "${line.sku}" не найден на складе.`)
    }

    const canonicalSKU = normalizeSKU(exactRecord.values.sku ?? '')
    const canonicalTitle = exactRecord.title.trim() || line.title || canonicalSKU

    return {
      sku: canonicalSKU,
      title: canonicalTitle,
      quantity: line.quantity,
    }
  })
}

export function buildServiceWorkorderSyncPayload(
  record: EntityRecord,
  carRecords: EntityRecord[],
): ServiceWorkorderSyncPayload {
  const client = resolveClientValue(record.values.client ?? '', record.values.clientText ?? '')
  const masterValue = (record.values.master ?? '').trim()
  const masterText = (record.values.masterText ?? '').trim()
  return {
    id: record.id,
    client_id: client.id,
    client_name: client.name,
    vehicle_vin: resolveVIN(record, carRecords),
    assignee: masterText || masterValue,
    deadline: toRFC3339Date(record.values.eta ?? ''),
    status: record.status,
  }
}

export function buildServiceWorkorderUpsertRequest(
  payload: ServiceWorkorderSyncPayload,
): ServiceWorkorderUpsertRequest {
  const { id: _id, ...request } = payload
  return request
}

function buildServiceWorkorderUpsertDedupeKey(payload: ServiceWorkorderSyncPayload): string {
  return `${payload.id}:${JSON.stringify(buildServiceWorkorderUpsertRequest(payload))}`
}

export function resolveWorkorderPartTitle(sku: string, stockRecords: EntityRecord[]): string {
  const normalizedSKU = normalizeSKU(sku)
  if (!normalizedSKU) {
    return ''
  }
  return (
    stockRecords.find((item) => normalizeSKU(item.values.sku ?? '') === normalizedSKU)?.title ?? ''
  )
}

export function buildInventoryStockProjection(
  serviceItem: InventoryStockServiceItem,
  existingRecord?: EntityRecord,
  fallbackTitle?: string,
) {
  const available = Math.max(serviceItem.on_hand - serviceItem.reserved, 0)
  const values = {
    ...(existingRecord?.values ?? {}),
    sku: serviceItem.sku,
    available: String(available),
    reserved: String(serviceItem.reserved),
    min: String(serviceItem.min_qty || serviceItem.reorder_point || 0),
    warehouse: serviceItem.location,
  }
  return {
    title: existingRecord?.title ?? fallbackTitle?.trim() ?? serviceItem.sku,
    subtitle: existingRecord?.subtitle ?? `Склад: ${serviceItem.location}`,
    values,
    status: computeInventoryStockStatusFromValues(values),
  }
}

export function buildWorkorderPartsStatusNote(response: WorkorderPartsWriteoffResponse): string {
  if (response.result === 'waiting_parts') {
    return `Списание материалов остановлено: создано заявок в закупку ${response.procurement_requests.length}.`
  }
  return `Материалы списаны по заказ-наряду ${response.workorder_id}.`
}

export async function upsertServiceWorkorder(payload: ServiceWorkorderSyncPayload): Promise<void> {
  const dedupeKey = buildServiceWorkorderUpsertDedupeKey(payload)
  const inFlight = serviceWorkorderUpsertInFlight.get(dedupeKey)
  if (inFlight) {
    await inFlight
    return
  }

  const requestBody = JSON.stringify(buildServiceWorkorderUpsertRequest(payload))
  const idempotencyKey = createIdempotencyKey(`wo-upsert-${payload.id}`)

  const requestPromise = withIdempotencyRetry(
    () =>
      requestServiceWorkordersJSON<ServiceWorkorderSyncPayload>(
        `${SERVICE_WORKORDERS_API_BASE}/workorders/${encodeURIComponent(payload.id)}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: requestBody,
        },
      ).then(() => undefined),
  ).finally(() => {
    if (serviceWorkorderUpsertInFlight.get(dedupeKey) === requestPromise) {
      serviceWorkorderUpsertInFlight.delete(dedupeKey)
    }
  })

  serviceWorkorderUpsertInFlight.set(dedupeKey, requestPromise)
  await requestPromise
}

export async function ensureServiceWorkorder(
  payload: ServiceWorkorderSyncPayload,
): Promise<ServiceWorkorderRecord> {
  const existing = await fetchServiceWorkorderOrNull(payload.id)
  if (existing) {
    return existing
  }

  try {
    await upsertServiceWorkorder(payload)
  } catch (error) {
    if (!isIdempotencyConflictError(error)) {
      throw error
    }
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const synced = await fetchServiceWorkorderOrNull(payload.id)
    if (synced) {
      return synced
    }
  }

  throw new Error(`Не удалось синхронизировать заказ-наряд ${payload.id} с service-workorders.`)
}

export async function updateServiceWorkorderStatus(
  workorderId: string,
  status: string,
): Promise<ServiceWorkorderRecord> {
  const normalizedStatus = status.trim().toLowerCase()
  const dedupeKey = `${workorderId}:${normalizedStatus}`
  const inFlight = serviceWorkorderStatusUpdateInFlight.get(dedupeKey)
  if (inFlight) {
    return inFlight
  }
  const idempotencyKey = createIdempotencyKey(`wo-status-${workorderId}-${normalizedStatus}`)

  const requestPromise = withIdempotencyRetry(() =>
    requestServiceWorkordersJSON<ServiceWorkorderRecord>(
      `${SERVICE_WORKORDERS_API_BASE}/workorders/${encodeURIComponent(workorderId)}/status`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ status: normalizedStatus }),
      },
    ),
  ).finally(() => {
    if (serviceWorkorderStatusUpdateInFlight.get(dedupeKey) === requestPromise) {
      serviceWorkorderStatusUpdateInFlight.delete(dedupeKey)
    }
  })

  serviceWorkorderStatusUpdateInFlight.set(dedupeKey, requestPromise)
  return requestPromise
}

export async function closeServiceWorkorder(
  workorderId: string,
): Promise<ServiceWorkorderCloseResponse> {
  const inFlight = serviceWorkorderCloseInFlight.get(workorderId)
  if (inFlight) {
    return inFlight
  }
  const idempotencyKey = createIdempotencyKey(`wo-close-${workorderId}`)

  const requestPromise = withIdempotencyRetry(() =>
    requestServiceWorkordersJSON<ServiceWorkorderCloseResponse>(
      `${SERVICE_WORKORDERS_API_BASE}/workorders/${encodeURIComponent(workorderId)}/close`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: '{}',
      },
    ),
  ).finally(() => {
    if (serviceWorkorderCloseInFlight.get(workorderId) === requestPromise) {
      serviceWorkorderCloseInFlight.delete(workorderId)
    }
  })

  serviceWorkorderCloseInFlight.set(workorderId, requestPromise)
  return requestPromise
}

export async function fetchWorkorderPartsPlan(workorderId: string): Promise<WorkorderPartsPlanResponse> {
  return requestJSON<WorkorderPartsPlanResponse>(
    `${SERVICE_PARTS_USAGE_API_BASE}/workorders/${encodeURIComponent(workorderId)}/parts-plan`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    },
  )
}

export async function saveWorkorderPartsPlan(
  workorderId: string,
  lines: WorkorderPartPlanInputLine[],
): Promise<WorkorderPartsPlanResponse> {
  const payload = JSON.stringify({ lines })
  const dedupeKey = `${workorderId}:${payload}`
  const inFlight = workorderPartsPlanSaveInFlight.get(dedupeKey)
  if (inFlight) {
    return inFlight
  }
  const idempotencyKey = createIdempotencyKey(`parts-plan-${workorderId}`)

  const requestPromise = withIdempotencyRetry(() =>
    requestJSON<WorkorderPartsPlanResponse>(
      `${SERVICE_PARTS_USAGE_API_BASE}/workorders/${encodeURIComponent(workorderId)}/parts-plan`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: payload,
      },
    ),
  ).finally(() => {
    if (workorderPartsPlanSaveInFlight.get(dedupeKey) === requestPromise) {
      workorderPartsPlanSaveInFlight.delete(dedupeKey)
    }
  })

  workorderPartsPlanSaveInFlight.set(dedupeKey, requestPromise)
  return requestPromise
}

export async function writeoffWorkorderParts(
  workorderId: string,
): Promise<WorkorderPartsWriteoffResponse> {
  const inFlight = workorderPartsWriteoffInFlight.get(workorderId)
  if (inFlight) {
    return inFlight
  }
  const idempotencyKey = createIdempotencyKey(`parts-writeoff-${workorderId}`)

  const requestPromise = withIdempotencyRetry(() =>
    requestJSON<WorkorderPartsWriteoffResponse>(
      `${SERVICE_PARTS_USAGE_API_BASE}/workorders/${encodeURIComponent(workorderId)}/writeoff`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
      },
    ),
  ).finally(() => {
    if (workorderPartsWriteoffInFlight.get(workorderId) === requestPromise) {
      workorderPartsWriteoffInFlight.delete(workorderId)
    }
  })

  workorderPartsWriteoffInFlight.set(workorderId, requestPromise)
  return requestPromise
}

export async function fetchInventoryStockBySKU(
  sku: string,
): Promise<InventoryStockServiceItem | null> {
  const normalizedSKU = normalizeSKU(sku)
  if (!normalizedSKU) {
    return null
  }
  const items = await requestJSON<InventoryStockServiceItem[]>(
    `${INVENTORY_STOCK_API_BASE}/stock?sku=${encodeURIComponent(normalizedSKU)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    },
  )
  return items[0] ?? null
}
