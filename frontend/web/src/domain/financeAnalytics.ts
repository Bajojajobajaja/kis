import type { PartsDemandItem } from './demandAnalytics'
import { buildFinanceReportSnapshot } from './finance'
import type { EntityRecord } from './model'

export type FinanceDocumentSourceCounts = {
  finance: number
  sales: number
  service: number
  inventory: number
}

export type FinanceAnalyticsSummary = {
  invoiceCount: number
  paymentCount: number
  reportCount: number
  draftReportCount: number
  generatedReportCount: number
  archivedReportCount: number
  documentCount: number
  sourceDocumentCounts: FinanceDocumentSourceCounts
  outgoingIssuedTotal: number
  incomingIssuedTotal: number
  reconciledPaymentsTotal: number
  arOpenTotal: number
  apOpenTotal: number
  overdueInvoiceCount: number
  overdueOutgoingCount: number
  overdueIncomingCount: number
  salesRevenue: number
  salesClosedDealsCount: number
  serviceDemandQuantity: number
  serviceDemandOperations: number
  inventoryAttentionCount: number
}

type BuildFinanceAnalyticsSummaryInput = {
  invoices: EntityRecord[]
  payments: EntityRecord[]
  reports: EntityRecord[]
  documents: EntityRecord[]
  deals: EntityRecord[]
  stockRecords: EntityRecord[]
  partsDemand: PartsDemandItem[]
  referenceDate?: Date
}

function parseMoney(value: string | undefined): number {
  const normalized = (value ?? '').replace(/\s+/g, '')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
}

function parseDueDate(value: string | undefined): number | null {
  const normalized = (value ?? '').trim()
  if (!normalized) {
    return null
  }
  const parsed = new Date(`${normalized}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime()
}

function normalizeDocumentSource(value: string | undefined): keyof FinanceDocumentSourceCounts {
  const normalized = (value ?? '').trim().toLowerCase()
  if (normalized === 'продажи') {
    return 'sales'
  }
  if (normalized === 'сервис') {
    return 'service'
  }
  if (normalized === 'склад') {
    return 'inventory'
  }
  return 'finance'
}

export function buildFinanceAnalyticsSummary({
  invoices,
  payments,
  reports,
  documents,
  deals,
  stockRecords,
  partsDemand,
  referenceDate = new Date(),
}: BuildFinanceAnalyticsSummaryInput): FinanceAnalyticsSummary {
  const financeSnapshot = buildFinanceReportSnapshot(invoices, payments)
  const todayTimestamp = startOfDay(referenceDate)
  const sourceDocumentCounts: FinanceDocumentSourceCounts = {
    finance: 0,
    sales: 0,
    service: 0,
    inventory: 0,
  }

  let arOpenTotal = 0
  let apOpenTotal = 0
  let overdueInvoiceCount = 0
  let overdueOutgoingCount = 0
  let overdueIncomingCount = 0

  for (const invoice of invoices) {
    if (invoice.status !== 'issued') {
      continue
    }

    const amount = parseMoney(invoice.values.amount)
    const paidAmount = parseMoney(invoice.values.paidAmount)
    const openAmount = Math.max(0, amount - paidAmount)
    const direction =
      (invoice.values.direction ?? '').trim() === 'incoming' ? 'incoming' : 'outgoing'

    if (direction === 'incoming') {
      apOpenTotal += openAmount
    } else {
      arOpenTotal += openAmount
    }

    const dueDate = parseDueDate(invoice.values.dueDate)
    if (dueDate !== null && dueDate < todayTimestamp) {
      overdueInvoiceCount += 1
      if (direction === 'incoming') {
        overdueIncomingCount += 1
      } else {
        overdueOutgoingCount += 1
      }
    }
  }

  let draftReportCount = 0
  let generatedReportCount = 0
  let archivedReportCount = 0
  for (const report of reports) {
    if (report.status === 'draft') {
      draftReportCount += 1
    } else if (report.status === 'generated') {
      generatedReportCount += 1
    } else if (report.status === 'archived') {
      archivedReportCount += 1
    }
  }

  for (const document of documents) {
    sourceDocumentCounts[normalizeDocumentSource(document.values.source)] += 1
  }

  const salesDeals = deals.filter((deal) => deal.status === 'closed')
  const salesRevenue = salesDeals.reduce((sum, deal) => sum + parseMoney(deal.values.amount), 0)
  const serviceDemandQuantity = partsDemand.reduce((sum, item) => sum + item.quantity, 0)
  const serviceDemandOperations = partsDemand.reduce((sum, item) => sum + item.operations, 0)
  const inventoryAttentionCount = stockRecords.filter(
    (record) => record.status === 'low' || record.status === 'critical',
  ).length

  return {
    invoiceCount: Number(financeSnapshot.invoiceCount) || 0,
    paymentCount: Number(financeSnapshot.paymentCount) || 0,
    reportCount: reports.length,
    draftReportCount,
    generatedReportCount,
    archivedReportCount,
    documentCount: documents.length,
    sourceDocumentCounts,
    outgoingIssuedTotal: parseMoney(financeSnapshot.outgoingIssuedTotal),
    incomingIssuedTotal: parseMoney(financeSnapshot.incomingIssuedTotal),
    reconciledPaymentsTotal: parseMoney(financeSnapshot.reconciledPaymentsTotal),
    arOpenTotal,
    apOpenTotal,
    overdueInvoiceCount,
    overdueOutgoingCount,
    overdueIncomingCount,
    salesRevenue,
    salesClosedDealsCount: salesDeals.length,
    serviceDemandQuantity,
    serviceDemandOperations,
    inventoryAttentionCount,
  }
}
