import { describe, expect, it } from 'vitest'

import type { PartsDemandItem } from './demandAnalytics'
import { buildFinanceAnalyticsSummary } from './financeAnalytics'
import type { EntityRecord } from './model'

function buildRecord(
  id: string,
  status: string,
  values: Record<string, string> = {},
): EntityRecord {
  return {
    id,
    title: id,
    subtitle: '',
    status,
    values,
    history: [],
    related: [],
  }
}

describe('financeAnalytics', () => {
  it('builds finance overview metrics from store records', () => {
    const invoices = [
      buildRecord('INV-1', 'issued', {
        direction: 'outgoing',
        amount: '200 000',
        paidAmount: '50 000',
        dueDate: '2026-04-01',
      }),
      buildRecord('INV-2', 'issued', {
        direction: 'incoming',
        amount: '90 000',
        paidAmount: '10 000',
        dueDate: '2026-04-04',
      }),
      buildRecord('INV-3', 'paid', {
        direction: 'outgoing',
        amount: '300 000',
        paidAmount: '300 000',
        dueDate: '2026-03-29',
      }),
      buildRecord('INV-4', 'cancelled', {
        direction: 'incoming',
        amount: '40 000',
        paidAmount: '0',
        dueDate: '2026-03-20',
      }),
    ]

    const payments = [
      buildRecord('PAY-1', 'reconciled', { invoice: 'INV-3', amount: '300 000' }),
      buildRecord('PAY-2', 'initiated', { invoice: 'INV-1', amount: '50 000' }),
      buildRecord('PAY-3', 'cancelled', { invoice: 'INV-4', amount: '40 000' }),
    ]

    const reports = [
      buildRecord('RPT-1', 'draft'),
      buildRecord('RPT-2', 'generated'),
      buildRecord('RPT-3', 'archived'),
    ]

    const documents = [
      buildRecord('DOC-1', 'posted', { source: 'Финансы' }),
      buildRecord('DOC-2', 'posted', { source: 'Продажи' }),
      buildRecord('DOC-3', 'posted', { source: 'Сервис' }),
      buildRecord('DOC-4', 'posted', { source: 'Склад' }),
    ]

    const deals = [
      buildRecord('DL-1', 'closed', { amount: '1 200 000' }),
      buildRecord('DL-2', 'closed', { amount: '950 000' }),
      buildRecord('DL-3', 'new', { amount: '880 000' }),
    ]

    const stockRecords = [
      buildRecord('STK-1', 'normal'),
      buildRecord('STK-2', 'low'),
      buildRecord('STK-3', 'critical'),
    ]

    const partsDemand: PartsDemandItem[] = [
      {
        key: 'PART-1',
        title: 'Filter',
        quantity: 3,
        operations: 2,
      },
      {
        key: 'PART-2',
        title: 'Oil',
        quantity: 5,
        operations: 1,
      },
    ]

    expect(
      buildFinanceAnalyticsSummary({
        invoices,
        payments,
        reports,
        documents,
        deals,
        stockRecords,
        partsDemand,
        referenceDate: new Date('2026-04-02T12:00:00Z'),
      }),
    ).toEqual({
      invoiceCount: 3,
      paymentCount: 2,
      reportCount: 3,
      draftReportCount: 1,
      generatedReportCount: 1,
      archivedReportCount: 1,
      documentCount: 4,
      sourceDocumentCounts: {
        finance: 1,
        sales: 1,
        service: 1,
        inventory: 1,
      },
      outgoingIssuedTotal: 500000,
      incomingIssuedTotal: 90000,
      reconciledPaymentsTotal: 300000,
      arOpenTotal: 150000,
      apOpenTotal: 80000,
      overdueInvoiceCount: 1,
      overdueOutgoingCount: 1,
      overdueIncomingCount: 0,
      salesRevenue: 2150000,
      salesClosedDealsCount: 2,
      serviceDemandQuantity: 8,
      serviceDemandOperations: 3,
      inventoryAttentionCount: 2,
    })
  })
})
