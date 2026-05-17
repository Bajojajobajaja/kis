import type { EntityRecord } from './model'

const FINANCE_INVOICING_BASE = '/svc/finance-invoicing'

type InvoicePayload = {
  number: string
  party_id: string
  party_name: string
  amount: number
  kind: 'ar' | 'ap'
  currency: string
  due_date: string
  created_at: string
}

type PaymentPayload = {
  invoice_id: string
  amount: number
  method: string
  paid_at: string
}

type BackendInvoice = {
  id: string
  number: string
}

function parseMoney(value: string | undefined): number {
  if (!value) {
    return 0
  }
  const cleaned = value.replace(/\s+/g, '').replace(/[^\d.,-]/g, '').replace(',', '.')
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : 0
}

function deriveCreatedAtFromDueDate(dueDate: string | undefined): string {
  const match = (dueDate ?? '').match(/^(\d{4})-(\d{2})/)
  if (!match) {
    return new Date().toISOString()
  }
  const [, year, month] = match
  return new Date(Date.UTC(Number(year), Number(month) - 1, 1, 12, 0, 0)).toISOString()
}

function derivePaidAt(invoiceCreatedAt: string): string {
  const date = new Date(invoiceCreatedAt)
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString()
  }
  date.setUTCDate(date.getUTCDate() + 3)
  return date.toISOString()
}

function methodFromLabel(label: string | undefined): string {
  const value = (label ?? '').toLowerCase()
  if (value.includes('налич')) return 'cash'
  if (value.includes('терминал') || value.includes('карт')) return 'card'
  if (value.includes('банк')) return 'bank_transfer'
  return 'bank_transfer'
}

async function fetchExistingInvoices(): Promise<BackendInvoice[]> {
  const response = await fetch(`${FINANCE_INVOICING_BASE}/invoices`, {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`finance-invoicing /invoices returned ${response.status}`)
  }
  return (await response.json()) as BackendInvoice[]
}

async function postInvoice(payload: InvoicePayload): Promise<BackendInvoice> {
  const response = await fetch(`${FINANCE_INVOICING_BASE}/invoices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`POST /invoices failed (${response.status}): ${text}`)
  }
  return (await response.json()) as BackendInvoice
}

async function postPayment(payload: PaymentPayload): Promise<void> {
  const response = await fetch(`${FINANCE_INVOICING_BASE}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`POST /payments failed (${response.status}): ${text}`)
  }
}

async function pushInvoicesAndPayments(
  invoices: EntityRecord[],
  payments: EntityRecord[],
  existingNumbers: Set<string>,
): Promise<void> {
  const seedNumberToBackendId = new Map<string, string>()
  const seedNumberToCreatedAt = new Map<string, string>()

  for (const record of invoices) {
    const number = record.values.number || record.id
    if (existingNumbers.has(number)) {
      continue
    }
    const direction = (record.values.direction ?? '').toLowerCase()
    const kind: 'ar' | 'ap' = direction === 'incoming' ? 'ap' : 'ar'
    const amount = parseMoney(record.values.amount)
    if (amount <= 0) {
      continue
    }
    const createdAt = deriveCreatedAtFromDueDate(record.values.dueDate)
    const partyName = record.values.counterparty || record.values.partyName || 'Контрагент'
    try {
      const created = await postInvoice({
        number,
        party_id: partyName,
        party_name: partyName,
        amount,
        kind,
        currency: 'RUB',
        due_date: record.values.dueDate ?? '',
        created_at: createdAt,
      })
      seedNumberToBackendId.set(number, created.id)
      seedNumberToCreatedAt.set(number, createdAt)
      existingNumbers.add(number)
    } catch (error) {
      console.warn('[finance-invoicing sync] invoice failed', number, error)
    }
  }

  for (const record of payments) {
    const seedInvoiceNumber = record.values.invoice
    if (!seedInvoiceNumber) {
      continue
    }
    const backendId = seedNumberToBackendId.get(seedInvoiceNumber)
    if (!backendId) {
      continue
    }
    const amount = parseMoney(record.values.amount)
    if (amount <= 0) {
      continue
    }
    const invoiceCreatedAt = seedNumberToCreatedAt.get(seedInvoiceNumber) ?? new Date().toISOString()
    try {
      await postPayment({
        invoice_id: backendId,
        amount,
        method: methodFromLabel(record.values.method),
        paid_at: derivePaidAt(invoiceCreatedAt),
      })
    } catch (error) {
      console.warn('[finance-invoicing sync] payment failed', record.id, error)
    }
  }
}

export async function syncFinanceInvoicingFromStore(
  store: Record<string, EntityRecord[]>,
): Promise<void> {
  let existing: BackendInvoice[]
  try {
    existing = await fetchExistingInvoices()
  } catch (error) {
    console.warn('[finance-invoicing sync] backend unreachable, skipping', error)
    return
  }

  const existingNumbers = new Set(existing.map((entry) => entry.number))
  await pushInvoicesAndPayments(
    store['finance/invoices'] ?? [],
    store['finance/payments'] ?? [],
    existingNumbers,
  )
}

export async function ensureFinanceInvoicingForPeriod(
  store: Record<string, EntityRecord[]>,
  periodPrefix: string,
): Promise<void> {
  if (!periodPrefix) {
    return
  }
  let existing: BackendInvoice[]
  try {
    existing = await fetchExistingInvoices()
  } catch (error) {
    console.warn('[finance-invoicing sync] backend unreachable, skipping period sync', error)
    return
  }
  const existingNumbers = new Set(existing.map((entry) => entry.number))

  const invoices = (store['finance/invoices'] ?? []).filter((inv) =>
    (inv.values.dueDate ?? '').startsWith(periodPrefix),
  )
  if (invoices.length === 0) {
    return
  }
  const invoiceNumbers = new Set(invoices.map((inv) => inv.values.number || inv.id))
  const payments = (store['finance/payments'] ?? []).filter((pay) =>
    invoiceNumbers.has(pay.values.invoice ?? ''),
  )
  await pushInvoicesAndPayments(invoices, payments, existingNumbers)
}
