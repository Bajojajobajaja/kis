import {
  resolveStoreReferenceLabel,
  type EntityRecordGetter,
} from './entityReferences'
import { formatMoneyString } from './formatters'
import { INVENTORY_DOCUMENTS_STORE_KEY } from './inventory'
import type { EntityRecord } from './model'

export const FINANCE_INVOICES_STORE_KEY = 'finance/invoices'
export const FINANCE_PAYMENTS_STORE_KEY = 'finance/payments'
export const FINANCE_REPORTS_STORE_KEY = 'finance/reports'
export const FINANCE_DOCUMENTS_STORE_KEY = 'finance/documents'
export const CRM_SALES_DOCUMENTS_STORE_KEY = 'crm-sales/documents'
export const SERVICE_DOCUMENTS_STORE_KEY = 'service/documents'
export const SERVICE_ORDERS_STORE_KEY = 'service/orders'

const FINANCE_PROXY_FIELD = '__financeProxy'
const FINANCE_PROXY_SOURCE_STORE_FIELD = '__sourceStoreKey'
const FINANCE_PROXY_SOURCE_RECORD_FIELD = '__sourceRecordId'
const FINANCE_PROXY_PREFIX = 'FDP'

const financeDocumentSourceLabels: Record<string, string> = {
  [CRM_SALES_DOCUMENTS_STORE_KEY]: 'Продажи',
  [SERVICE_DOCUMENTS_STORE_KEY]: 'Сервис',
  [INVENTORY_DOCUMENTS_STORE_KEY]: 'Склад',
  [FINANCE_DOCUMENTS_STORE_KEY]: 'Финансы',
}

const FINANCE_COUNTERPARTY_SOURCE = {
  type: 'store',
  storeKey: 'crm-sales/clients',
  valueKey: 'id',
  labelKey: 'title',
} as const

type RecordGetter = EntityRecordGetter

export type FinanceInvoiceContext = {
  dealId?: string
  purchaseId?: string
  stockItemId?: string
}

function parseMoney(value: string | undefined): number {
  const normalized = (value ?? '').replace(/\s+/g, '')
  const parsed = Number(normalized)
  return Number.isNaN(parsed) ? 0 : parsed
}

function hasMoneyValue(value: string | undefined): boolean {
  return /\d/.test(value ?? '')
}

function valuesOf(record: EntityRecord | Record<string, string>): Record<string, string> {
  const maybeRecord = record as EntityRecord
  return typeof maybeRecord.values === 'object' && maybeRecord.values !== null
    ? maybeRecord.values
    : (record as Record<string, string>)
}

function resolveFinanceCounterpartyLabel(
  values: Record<string, string>,
  getRecords?: RecordGetter,
): string {
  if (!getRecords) {
    return (values.counterpartyText ?? '').trim() || (values.counterparty ?? '').trim()
  }

  return resolveStoreReferenceLabel(
    FINANCE_COUNTERPARTY_SOURCE,
    values.counterparty ?? '',
    getRecords,
    values.counterpartyText,
  )
}

function formatProxyId(sourceStoreKey: string, recordId: string): string {
  return `${FINANCE_PROXY_PREFIX}-${sourceStoreKey.replace('/', '__')}-${recordId}`
}

function normalizeDocumentType(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function isNonCancelledPaymentStatus(status: string): boolean {
  return status === 'initiated' || status === 'confirmed' || status === 'reconciled'
}

function buildFinanceDocumentSourceRelatedItem(
  sourceStoreKey: string,
  sourceRecordId: string,
): EntityRecord['related'][number] {
  const label = financeDocumentSourceLabels[sourceStoreKey] ?? sourceStoreKey
  return {
    id: `rel-${sourceStoreKey}-${sourceRecordId}`,
    label: 'Исходная запись',
    value: `${label} • ${sourceRecordId}`,
    storeKey: sourceStoreKey,
    recordId: sourceRecordId,
  }
}

function resolveFinanceDocumentCounterparty(
  sourceStoreKey: string,
  record: EntityRecord,
  getRecords: RecordGetter,
): string {
  if (sourceStoreKey === CRM_SALES_DOCUMENTS_STORE_KEY) {
    return resolveStoreReferenceLabel(
      FINANCE_COUNTERPARTY_SOURCE,
      record.values.client ?? '',
      getRecords,
      record.values.clientText,
    )
  }

  if (sourceStoreKey === SERVICE_DOCUMENTS_STORE_KEY) {
    const workOrderId = (record.values.wo ?? '').trim()
    if (!workOrderId) {
      return ''
    }
    const workOrder = getRecords(SERVICE_ORDERS_STORE_KEY).find((item) => item.id === workOrderId)
    if (!workOrder) {
      return workOrderId
    }
    return resolveStoreReferenceLabel(
      FINANCE_COUNTERPARTY_SOURCE,
      workOrder.values.client ?? '',
      getRecords,
      workOrder.values.clientText,
    )
  }

  if (sourceStoreKey === INVENTORY_DOCUMENTS_STORE_KEY) {
    return record.values.supplier ?? ''
  }

  return resolveFinanceCounterpartyLabel(record.values, getRecords)
}

function resolveFinanceDocumentDocType(sourceStoreKey: string, record: EntityRecord): string {
  if (sourceStoreKey === INVENTORY_DOCUMENTS_STORE_KEY) {
    return 'Накладная'
  }

  return (record.values.docType ?? '').trim() || 'Документ'
}

function buildFinanceDocumentProxyRecord(
  sourceStoreKey: string,
  sourceRecord: EntityRecord,
  getRecords: RecordGetter,
): EntityRecord {
  const counterparty = resolveFinanceDocumentCounterparty(sourceStoreKey, sourceRecord, getRecords)
  const sourceLabel = financeDocumentSourceLabels[sourceStoreKey] ?? sourceStoreKey
  const values = {
    ...sourceRecord.values,
    number: sourceRecord.values.number ?? sourceRecord.id,
    docType: resolveFinanceDocumentDocType(sourceStoreKey, sourceRecord),
    counterparty,
    owner: sourceRecord.values.owner ?? '',
    source: sourceLabel,
    [FINANCE_PROXY_FIELD]: 'true',
    [FINANCE_PROXY_SOURCE_STORE_FIELD]: sourceStoreKey,
    [FINANCE_PROXY_SOURCE_RECORD_FIELD]: sourceRecord.id,
  }

  return {
    id: formatProxyId(sourceStoreKey, sourceRecord.id),
    title: sourceRecord.title,
    subtitle: [sourceLabel, sourceRecord.subtitle].filter(Boolean).join(' • '),
    status: sourceRecord.status,
    values,
    history: [
      {
        id: `history-${sourceStoreKey}-${sourceRecord.id}`,
        at: sourceRecord.history[0]?.at ?? 'Источник',
        text: `Документ подгружается из раздела "${sourceLabel}".`,
      },
      ...sourceRecord.history,
    ],
    related: [
      buildFinanceDocumentSourceRelatedItem(sourceStoreKey, sourceRecord.id),
      ...sourceRecord.related,
    ],
  }
}

export function getFinanceDocumentRecords(getRecords: RecordGetter): EntityRecord[] {
  const localRecords = (getRecords(FINANCE_DOCUMENTS_STORE_KEY) ?? []).map((record) => ({
    ...record,
    values: {
      ...record.values,
      source: record.values.source ?? financeDocumentSourceLabels[FINANCE_DOCUMENTS_STORE_KEY],
    },
  }))
  const proxyRecords = [
    ...getRecords(CRM_SALES_DOCUMENTS_STORE_KEY)
      .filter((record) => normalizeDocumentType(record.values.docType) !== 'счет')
      .map((record) =>
        buildFinanceDocumentProxyRecord(CRM_SALES_DOCUMENTS_STORE_KEY, record, getRecords),
      ),
    ...getRecords(SERVICE_DOCUMENTS_STORE_KEY).map((record) =>
      buildFinanceDocumentProxyRecord(SERVICE_DOCUMENTS_STORE_KEY, record, getRecords),
    ),
    ...getRecords(INVENTORY_DOCUMENTS_STORE_KEY).map((record) =>
      buildFinanceDocumentProxyRecord(INVENTORY_DOCUMENTS_STORE_KEY, record, getRecords),
    ),
  ]

  return [...localRecords, ...proxyRecords]
}

export function getFinanceDocumentRecordById(
  recordId: string,
  getRecords: RecordGetter,
): EntityRecord | undefined {
  return getFinanceDocumentRecords(getRecords).find((record) => record.id === recordId)
}

export function resolveEntityRecords(
  storeKey: string,
  getRecords: RecordGetter,
): EntityRecord[] {
  if (storeKey === FINANCE_DOCUMENTS_STORE_KEY) {
    return getFinanceDocumentRecords(getRecords)
  }

  return getRecords(storeKey)
}

export function resolveEntityRecord(
  storeKey: string,
  recordId: string,
  getRecords: RecordGetter,
): EntityRecord | undefined {
  if (storeKey === FINANCE_DOCUMENTS_STORE_KEY) {
    return getFinanceDocumentRecordById(recordId, getRecords)
  }

  return getRecords(storeKey).find((record) => record.id === recordId)
}

export function isFinanceDocumentProxyRecord(record: EntityRecord): boolean {
  return record.values[FINANCE_PROXY_FIELD] === 'true'
}

export function getFinanceDocumentSourceRecord(record: EntityRecord): {
  storeKey: string
  recordId: string
} | null {
  const storeKey = (record.values[FINANCE_PROXY_SOURCE_STORE_FIELD] ?? '').trim()
  const recordId = (record.values[FINANCE_PROXY_SOURCE_RECORD_FIELD] ?? '').trim()
  if (!storeKey || !recordId) {
    return null
  }
  return { storeKey, recordId }
}

export function isFinanceInternalFieldKey(key: string): boolean {
  return key.startsWith('__')
}

export function formatFinanceInvoiceDirection(direction: string): string {
  if (direction === 'incoming') {
    return 'Входящий'
  }
  if (direction === 'outgoing') {
    return 'Исходящий'
  }
  return direction || '-'
}

export function normalizeFinanceInvoiceValues(values: Record<string, string>): Record<string, string> {
  const amount = formatMoneyString(values.amount ?? '')
  const paidAmount = formatMoneyString(values.paidAmount ?? '') || '0'
  return {
    ...values,
    amount,
    paidAmount,
    direction: (values.direction ?? '').trim() || 'outgoing',
  }
}

export function normalizeFinancePaymentValues(values: Record<string, string>): Record<string, string> {
  return {
    ...values,
    amount: formatMoneyString(values.amount ?? ''),
  }
}

function buildFinanceContextLabel(values: Record<string, string>): string {
  const dealId = (values.dealId ?? '').trim()
  if (dealId) {
    return `Сделка ${dealId}`
  }

  const purchaseId = (values.purchaseId ?? '').trim()
  if (purchaseId) {
    return `Закупка ${purchaseId}`
  }

  return ''
}

export function extractFinanceInvoiceContext(values: Record<string, string>): FinanceInvoiceContext {
  const dealId = (values.dealId ?? '').trim()
  const purchaseId = (values.purchaseId ?? '').trim()
  const stockItemId = (values.stockItemId ?? '').trim()

  return {
    dealId: dealId || undefined,
    purchaseId: purchaseId || undefined,
    stockItemId: stockItemId || undefined,
  }
}

function hasFinanceInvoiceContext(context: FinanceInvoiceContext): boolean {
  return Boolean(context.dealId || context.purchaseId || context.stockItemId)
}

export function matchesFinanceInvoiceContext(
  invoiceRecord: EntityRecord,
  contextValues: Record<string, string> | FinanceInvoiceContext | undefined,
): boolean {
  if (!contextValues) {
    return true
  }

  const context =
    'dealId' in contextValues || 'purchaseId' in contextValues || 'stockItemId' in contextValues
      ? extractFinanceInvoiceContext(contextValues as Record<string, string>)
      : (contextValues as FinanceInvoiceContext)

  if (!hasFinanceInvoiceContext(context)) {
    return true
  }

  if (context.dealId && (invoiceRecord.values.dealId ?? '').trim() !== context.dealId) {
    return false
  }

  if (context.purchaseId && (invoiceRecord.values.purchaseId ?? '').trim() !== context.purchaseId) {
    return false
  }

  if (context.stockItemId && (invoiceRecord.values.stockItemId ?? '').trim() !== context.stockItemId) {
    return false
  }

  return true
}

export function applyFinancePaymentInvoiceContext(
  values: Record<string, string>,
  invoiceRecord?: EntityRecord,
): Record<string, string> {
  const next = { ...values }
  if (!invoiceRecord) {
    delete next.dealId
    delete next.purchaseId
    delete next.stockItemId
    return next
  }

  const dealId = (invoiceRecord.values.dealId ?? '').trim()
  const purchaseId = (invoiceRecord.values.purchaseId ?? '').trim()
  const stockItemId = (invoiceRecord.values.stockItemId ?? '').trim()

  if (dealId) {
    next.dealId = dealId
  } else {
    delete next.dealId
  }

  if (purchaseId) {
    next.purchaseId = purchaseId
  } else {
    delete next.purchaseId
  }

  if (stockItemId) {
    next.stockItemId = stockItemId
  } else {
    delete next.stockItemId
  }

  return next
}

export function getFinanceInvoiceAmount(record: EntityRecord | Record<string, string>): number {
  const values = valuesOf(record)
  return parseMoney(values.amount)
}

export function getFinanceInvoicePaidAmount(record: EntityRecord | Record<string, string>): number {
  const values = valuesOf(record)
  return parseMoney(values.paidAmount)
}

export function getFinancePaymentAmount(record: EntityRecord | Record<string, string>): number {
  const values = valuesOf(record)
  return parseMoney(values.amount)
}

export function getFinanceReconciledAmountForInvoice(
  paymentRecords: EntityRecord[],
  invoiceId: string,
  excludedPaymentId?: string,
): number {
  return paymentRecords.reduce((sum, record) => {
    if (
      record.id === excludedPaymentId ||
      record.values.invoice !== invoiceId ||
      record.status !== 'reconciled'
    ) {
      return sum
    }
    return sum + getFinancePaymentAmount(record)
  }, 0)
}

export function getFinanceAllocatedAmountForInvoice(
  paymentRecords: EntityRecord[],
  invoiceId: string,
  excludedPaymentId?: string,
): number {
  return paymentRecords.reduce((sum, record) => {
    if (
      record.id === excludedPaymentId ||
      record.values.invoice !== invoiceId ||
      !isNonCancelledPaymentStatus(record.status)
    ) {
      return sum
    }
    return sum + getFinancePaymentAmount(record)
  }, 0)
}

export function getFinanceInvoiceAvailableAmount(
  invoiceRecord: EntityRecord,
  paymentRecords: EntityRecord[],
  excludedPaymentId?: string,
): number {
  return Math.max(
    0,
    getFinanceInvoiceAmount(invoiceRecord) -
      getFinanceAllocatedAmountForInvoice(paymentRecords, invoiceRecord.id, excludedPaymentId),
  )
}

export function canFinancePaymentFitInvoice(
  invoiceRecord: EntityRecord,
  paymentRecords: EntityRecord[],
  paymentAmountValue: string | undefined,
  excludedPaymentId?: string,
): boolean {
  const paymentAmount = parseMoney(paymentAmountValue)
  if (paymentAmount <= 0) {
    return false
  }

  return paymentAmount <= getFinanceInvoiceAvailableAmount(invoiceRecord, paymentRecords, excludedPaymentId)
}

export function canCancelFinanceInvoice(
  invoiceRecord: EntityRecord,
  paymentRecords: EntityRecord[],
): boolean {
  return !paymentRecords.some(
    (payment) =>
      payment.values.invoice === invoiceRecord.id &&
      payment.status !== 'cancelled',
  )
}

export function buildFinanceInvoiceState(
  invoiceRecord: EntityRecord,
  paymentRecords: EntityRecord[],
): {
  status: string
  paidAmount: string
} {
  const paidAmount = getFinanceReconciledAmountForInvoice(paymentRecords, invoiceRecord.id)
  const total = getFinanceInvoiceAmount(invoiceRecord)

  if (invoiceRecord.status === 'cancelled') {
    return {
      status: 'cancelled',
      paidAmount: formatMoneyString(String(paidAmount)) || '0',
    }
  }

  if (total > 0 && paidAmount >= total) {
    return {
      status: 'paid',
      paidAmount: formatMoneyString(String(paidAmount)) || '0',
    }
  }

  return {
    status: 'issued',
    paidAmount: formatMoneyString(String(paidAmount)) || '0',
  }
}

export function isFinanceInvoiceSelectable(
  invoiceRecord: EntityRecord,
  currentValue?: string,
  contextValues?: Record<string, string> | FinanceInvoiceContext,
): boolean {
  if (invoiceRecord.id === currentValue) {
    return true
  }

  return invoiceRecord.status === 'issued' && matchesFinanceInvoiceContext(invoiceRecord, contextValues)
}

export function getFinanceContextualInvoices(
  invoiceRecords: EntityRecord[],
  contextValues: Record<string, string> | FinanceInvoiceContext | undefined,
  currentValue?: string,
): EntityRecord[] {
  return invoiceRecords.filter((invoiceRecord) =>
    isFinanceInvoiceSelectable(invoiceRecord, currentValue, contextValues),
  )
}

export function buildFinanceReportSnapshot(
  invoiceRecords: EntityRecord[],
  paymentRecords: EntityRecord[],
): Record<string, string> {
  const snapshot = {
    incomingIssuedTotal: 0,
    incomingPaidTotal: 0,
    outgoingIssuedTotal: 0,
    outgoingPaidTotal: 0,
    openInvoiceTotal: 0,
    reconciledPaymentsTotal: 0,
    invoiceCount: 0,
    paymentCount: 0,
  }

  for (const invoice of invoiceRecords) {
    if (invoice.status === 'cancelled') {
      continue
    }

    const amount = getFinanceInvoiceAmount(invoice)
    const paidAmount = getFinanceInvoicePaidAmount(invoice)
    const direction = (invoice.values.direction ?? '').trim() || 'outgoing'

    snapshot.invoiceCount += 1
    if (direction === 'incoming') {
      snapshot.incomingIssuedTotal += amount
      snapshot.incomingPaidTotal += paidAmount
    } else {
      snapshot.outgoingIssuedTotal += amount
      snapshot.outgoingPaidTotal += paidAmount
    }

    if (invoice.status === 'issued') {
      snapshot.openInvoiceTotal += Math.max(0, amount - paidAmount)
    }
  }

  for (const payment of paymentRecords) {
    if (payment.status === 'cancelled') {
      continue
    }

    snapshot.paymentCount += 1
    if (payment.status === 'reconciled') {
      snapshot.reconciledPaymentsTotal += getFinancePaymentAmount(payment)
    }
  }

  return {
    incomingIssuedTotal: formatMoneyString(String(snapshot.incomingIssuedTotal)) || '0',
    incomingPaidTotal: formatMoneyString(String(snapshot.incomingPaidTotal)) || '0',
    outgoingIssuedTotal: formatMoneyString(String(snapshot.outgoingIssuedTotal)) || '0',
    outgoingPaidTotal: formatMoneyString(String(snapshot.outgoingPaidTotal)) || '0',
    openInvoiceTotal: formatMoneyString(String(snapshot.openInvoiceTotal)) || '0',
    reconciledPaymentsTotal: formatMoneyString(String(snapshot.reconciledPaymentsTotal)) || '0',
    invoiceCount: String(snapshot.invoiceCount),
    paymentCount: String(snapshot.paymentCount),
  }
}

export type FinanceReportSummaryValues = {
  incomingIssuedTotal: number
  incomingPaidTotal: number
  outgoingIssuedTotal: number
  outgoingPaidTotal: number
  openInvoiceTotal: number
  reconciledPaymentsTotal: number
  invoiceCount: number
  paymentCount: number
}

export function buildFinanceReportValuesFromSummary(
  summary: FinanceReportSummaryValues,
): Record<string, string> {
  return {
    incomingIssuedTotal: formatMoneyString(String(summary.incomingIssuedTotal)) || '0',
    incomingPaidTotal: formatMoneyString(String(summary.incomingPaidTotal)) || '0',
    outgoingIssuedTotal: formatMoneyString(String(summary.outgoingIssuedTotal)) || '0',
    outgoingPaidTotal: formatMoneyString(String(summary.outgoingPaidTotal)) || '0',
    openInvoiceTotal: formatMoneyString(String(summary.openInvoiceTotal)) || '0',
    reconciledPaymentsTotal: formatMoneyString(String(summary.reconciledPaymentsTotal)) || '0',
    invoiceCount: String(summary.invoiceCount),
    paymentCount: String(summary.paymentCount),
  }
}

export function inferFinanceReportType(
  currentType: string | undefined,
  title: string,
): string {
  const normalizedCurrentType = (currentType ?? '').trim().toLowerCase()
  if (normalizedCurrentType) {
    return normalizedCurrentType
  }

  const normalizedTitle = title.trim().toLowerCase()
  if (normalizedTitle.includes('cashflow')) {
    return 'cashflow'
  }
  if (normalizedTitle.includes('p&l') || normalizedTitle.includes('pnl')) {
    return 'pnl'
  }
  return 'ar-ap'
}

export function isFinanceReportPeriod(value: string | undefined): boolean {
  return /^\d{2}\.\d{4}$/.test((value ?? '').trim())
}

export function financeReportPeriodToMonthInputValue(value: string | undefined): string {
  const normalized = (value ?? '').trim()
  const periodMatch = normalized.match(/^(\d{2})\.(\d{4})$/)
  if (periodMatch) {
    const [, month, year] = periodMatch
    const monthNumber = Number(month)
    if (monthNumber >= 1 && monthNumber <= 12) {
      return `${year}-${month}`
    }
    return ''
  }

  const nativeMatch = normalized.match(/^(\d{4})-(\d{2})$/)
  if (nativeMatch) {
    const [, year, month] = nativeMatch
    const monthNumber = Number(month)
    if (monthNumber >= 1 && monthNumber <= 12) {
      return `${year}-${month}`
    }
  }

  return ''
}

export function financeReportPeriodFromMonthInputValue(value: string | undefined): string {
  const normalized = (value ?? '').trim()
  const nativeMatch = normalized.match(/^(\d{4})-(\d{2})$/)
  if (nativeMatch) {
    const [, year, month] = nativeMatch
    const monthNumber = Number(month)
    if (monthNumber >= 1 && monthNumber <= 12) {
      return `${month}.${year}`
    }
    return ''
  }

  if (isFinanceReportPeriod(normalized)) {
    return normalized
  }

  return ''
}

export function buildFinanceReportSubtitle(values: Record<string, string>): string {
  const period = (values.period ?? '').trim()
  const openAmount = formatMoneyString(values.openInvoiceTotal ?? '') || '0'
  return [period ? `Период ${period}` : '', `Открыто ${openAmount}`]
    .filter(Boolean)
    .join(' • ')
}

export function buildFinanceInvoiceSubtitle(
  values: Record<string, string>,
  getRecords?: RecordGetter,
): string {
  const context = buildFinanceContextLabel(values)
  const counterparty = resolveFinanceCounterpartyLabel(values, getRecords)
  const direction = formatFinanceInvoiceDirection(values.direction ?? '')
  return [context, counterparty, direction].filter(Boolean).join(' • ') || 'Финансовый счет'
}

export function buildFinancePaymentSubtitle(values: Record<string, string>): string {
  const context = buildFinanceContextLabel(values)
  const invoiceId = (values.invoice ?? '').trim()
  const method = (values.method ?? '').trim()
  return [context, invoiceId ? `Счет ${invoiceId}` : '', method]
    .filter(Boolean)
    .join(' • ') || 'Финансовый платеж'
}

export function buildFinanceDocumentSubtitle(
  values: Record<string, string>,
  getRecords?: RecordGetter,
): string {
  const counterparty = resolveFinanceCounterpartyLabel(values, getRecords)
  const source = (values.source ?? '').trim()
  return [source && source !== 'Финансы' ? source : '', counterparty]
    .filter(Boolean)
    .join(' • ') || 'Финансовый документ'
}

export function hasFinancePaymentActivity(invoiceRecord?: EntityRecord): boolean {
  if (!invoiceRecord) {
    return false
  }

  if (invoiceRecord.status === 'paid') {
    return true
  }

  return hasMoneyValue(invoiceRecord.values.paidAmount) && parseMoney(invoiceRecord.values.paidAmount) > 0
}
