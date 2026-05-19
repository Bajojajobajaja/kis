import { describe, expect, it } from 'vitest'

import { seedData } from './seedData'
import type { EntityRecord } from './model'

function recordsByStore(): Record<string, EntityRecord[]> {
  return seedData
}

function findRecord(storeKey: string, recordId: string): EntityRecord | undefined {
  const list = seedData[storeKey]
  if (!list) return undefined
  return list.find((r) => r.id === recordId)
}

function collectIds(storeKey: string): Set<string> {
  return new Set((seedData[storeKey] ?? []).map((r) => r.id))
}

function parseAmount(value: string | undefined): number {
  if (!value) return 0
  return Number(value.replace(/\s+/g, '')) || 0
}

function parseDateTime(s: string): number {
  // 'YYYY-MM-DD HH:mm' or 'YYYY-MM-DD'
  return new Date(s.replace(' ', 'T')).getTime()
}

describe('seedData integrity', () => {
  it('every related ref points to an existing record', () => {
    const errors: string[] = []
    for (const [storeKey, list] of Object.entries(recordsByStore())) {
      for (const record of list) {
        for (const r of record.related) {
          if (!r.storeKey || !r.recordId) continue
          const target = findRecord(r.storeKey, r.recordId)
          if (!target) {
            errors.push(
              `${storeKey}/${record.id} related[${r.id}] -> ${r.storeKey}/${r.recordId} (not found)`,
            )
          }
        }
      }
    }
    expect(errors).toEqual([])
  })

  it('related label/value starts with the linked recordId', () => {
    const errors: string[] = []
    for (const [storeKey, list] of Object.entries(recordsByStore())) {
      for (const record of list) {
        for (const r of record.related) {
          if (!r.recordId) continue
          const v = r.value ?? ''
          if (!v.includes(r.recordId)) {
            errors.push(
              `${storeKey}/${record.id} related[${r.id}] value "${v}" doesn't mention ${r.recordId}`,
            )
          }
        }
      }
    }
    expect(errors).toEqual([])
  })

  it('every deal.carRecordId points to an existing car with matching VIN', () => {
    const errors: string[] = []
    const cars = seedData['crm-sales/cars'] ?? []
    const carById = new Map(cars.map((c) => [c.id, c]))
    for (const deal of seedData['crm-sales/deals'] ?? []) {
      const carId = deal.values.carRecordId
      if (!carId) continue
      const car = carById.get(carId)
      if (!car) {
        errors.push(`${deal.id}: carRecordId=${carId} not found`)
        continue
      }
      const dealVin = deal.values.vin ?? deal.values.carVin
      const carVin = car.values.vin
      if (dealVin && carVin && dealVin !== carVin) {
        errors.push(
          `${deal.id}: VIN ${dealVin} differs from ${car.id}.vin ${carVin}`,
        )
      }
    }
    expect(errors).toEqual([])
  })

  it('every workorder.vin matches an existing car', () => {
    const errors: string[] = []
    const carsByVin = new Map(
      (seedData['crm-sales/cars'] ?? []).map((c) => [c.values.vin, c]),
    )
    for (const wo of seedData['service/orders'] ?? []) {
      const vin = wo.values.vin
      if (!vin) continue
      if (!carsByVin.has(vin)) {
        errors.push(`${wo.id}: vin ${vin} has no matching car`)
      }
    }
    expect(errors).toEqual([])
  })

  it('every appointment.vin matches an existing car', () => {
    const errors: string[] = []
    const carsByVin = new Map(
      (seedData['crm-sales/cars'] ?? []).map((c) => [c.values.vin, c]),
    )
    for (const ap of seedData['service/appointments'] ?? []) {
      const vin = ap.values.vin
      if (!vin) continue
      if (!carsByVin.has(vin)) {
        errors.push(`${ap.id}: vin ${vin} has no matching car`)
      }
    }
    expect(errors).toEqual([])
  })

  it('invoice.dealId / purchaseId point to existing entities', () => {
    const errors: string[] = []
    const deals = collectIds('crm-sales/deals')
    const purchases = collectIds('inventory/purchases')
    for (const inv of seedData['finance/invoices'] ?? []) {
      const dealId = inv.values.dealId
      const purchaseId = inv.values.purchaseId
      if (dealId && !deals.has(dealId)) {
        errors.push(`${inv.id}: dealId=${dealId} not found`)
      }
      if (purchaseId && !purchases.has(purchaseId)) {
        errors.push(`${inv.id}: purchaseId=${purchaseId} not found`)
      }
    }
    expect(errors).toEqual([])
  })

  it('payment.invoice points to an existing invoice', () => {
    const errors: string[] = []
    const invoices = collectIds('finance/invoices')
    for (const pay of seedData['finance/payments'] ?? []) {
      const inv = pay.values.invoice
      if (inv && !invoices.has(inv)) {
        errors.push(`${pay.id}: invoice=${inv} not found`)
      }
    }
    expect(errors).toEqual([])
  })

  it('purchase ↔ document ↔ invoice triple is consistent', () => {
    const errors: string[] = []
    const docByPurchase = new Map<string, EntityRecord>()
    for (const doc of seedData['inventory/documents'] ?? []) {
      const po = doc.values.purchaseId
      if (po) docByPurchase.set(po, doc)
    }
    const invByPurchase = new Map<string, EntityRecord>()
    for (const inv of seedData['finance/invoices'] ?? []) {
      const po = inv.values.purchaseId
      if (po) invByPurchase.set(po, inv)
    }
    for (const po of seedData['inventory/purchases'] ?? []) {
      const doc = docByPurchase.get(po.id)
      const inv = invByPurchase.get(po.id)
      if (!doc) errors.push(`${po.id}: no inventory document references it`)
      if (!inv) errors.push(`${po.id}: no finance invoice references it`)
      if (po.values.stockItemId && doc && doc.values.stockItemId !== po.values.stockItemId) {
        errors.push(
          `${po.id} stockItemId=${po.values.stockItemId} ≠ ${doc.id}.stockItemId=${doc.values.stockItemId}`,
        )
      }
      if (po.values.amount && inv) {
        const poAmount = parseAmount(po.values.amount)
        const invAmount = parseAmount(inv.values.amount)
        if (poAmount !== invAmount) {
          errors.push(
            `${po.id} amount=${poAmount} ≠ ${inv.id}.amount=${invAmount}`,
          )
        }
      }
    }
    expect(errors).toEqual([])
  })

  it('paid invoice has paidAmount = amount; cancelled has paidAmount = 0', () => {
    const errors: string[] = []
    for (const inv of seedData['finance/invoices'] ?? []) {
      const amount = parseAmount(inv.values.amount)
      const paid = parseAmount(inv.values.paidAmount)
      if (inv.status === 'paid' && paid !== amount) {
        errors.push(`${inv.id} paid: paidAmount=${paid} ≠ amount=${amount}`)
      }
      if (inv.status === 'cancelled' && paid !== 0) {
        errors.push(`${inv.id} cancelled: paidAmount=${paid} ≠ 0`)
      }
      if (paid > amount) {
        errors.push(`${inv.id}: paidAmount=${paid} > amount=${amount}`)
      }
    }
    expect(errors).toEqual([])
  })

  it('reconciled payments per invoice ≤ invoice.paidAmount', () => {
    const errors: string[] = []
    const sumByInvoice = new Map<string, number>()
    for (const pay of seedData['finance/payments'] ?? []) {
      if (pay.status !== 'reconciled' && pay.status !== 'confirmed') continue
      const inv = pay.values.invoice
      if (!inv) continue
      sumByInvoice.set(inv, (sumByInvoice.get(inv) ?? 0) + parseAmount(pay.values.amount))
    }
    for (const inv of seedData['finance/invoices'] ?? []) {
      const paid = parseAmount(inv.values.paidAmount)
      const sumPay = sumByInvoice.get(inv.id) ?? 0
      if (sumPay > paid) {
        errors.push(
          `${inv.id}: reconciled+confirmed payments=${sumPay} > paidAmount=${paid}`,
        )
      }
    }
    expect(errors).toEqual([])
  })

  it('history is chronologically ordered', () => {
    const errors: string[] = []
    for (const [storeKey, list] of Object.entries(recordsByStore())) {
      for (const record of list) {
        const times = record.history.map((h) => parseDateTime(h.at))
        for (let i = 1; i < times.length; i++) {
          if (Number.isFinite(times[i]) && Number.isFinite(times[i - 1]) && times[i] < times[i - 1]) {
            errors.push(
              `${storeKey}/${record.id}: history not ascending at index ${i} (${record.history[i - 1].at} → ${record.history[i].at})`,
            )
            break
          }
        }
      }
    }
    expect(errors).toEqual([])
  })

  it('clients link only to cars (deals/orders/appointments reached via car)', () => {
    const errors: string[] = []
    const allowed = new Set(['crm-sales/cars'])
    for (const client of seedData['crm-sales/clients'] ?? []) {
      for (const r of client.related) {
        if (!r.storeKey) continue
        if (!allowed.has(r.storeKey)) {
          errors.push(`${client.id} has direct link to ${r.storeKey}/${r.recordId} — should go via car`)
        }
      }
    }
    expect(errors).toEqual([])
  })

  it('client.ownerClient ↔ car bidirectional', () => {
    const errors: string[] = []
    const clients = seedData['crm-sales/clients'] ?? []
    const clientByName = new Map(clients.map((c) => [c.title, c]))
    for (const car of seedData['crm-sales/cars'] ?? []) {
      const ownerName = car.values.ownerClient
      if (!ownerName) continue
      const client = clientByName.get(ownerName)
      if (!client) {
        errors.push(`${car.id}: ownerClient="${ownerName}" — no client with that title`)
        continue
      }
      // car has client back-reference in related?
      const hasClientRel = car.related.some(
        (r) => r.storeKey === 'crm-sales/clients' && r.recordId === client.id,
      )
      if (!hasClientRel) {
        errors.push(`${car.id}: missing related → ${client.id} for owner "${ownerName}"`)
      }
      // client has this car in related?
      const hasCarRel = client.related.some(
        (r) => r.storeKey === 'crm-sales/cars' && r.recordId === car.id,
      )
      if (!hasCarRel) {
        errors.push(`${client.id}: missing related → ${car.id} (declared via car.ownerClient)`)
      }
    }
    expect(errors).toEqual([])
  })

  it('finance reports aggregates match invoice/payment data', () => {
    const errors: string[] = []
    const invoices = seedData['finance/invoices'] ?? []
    const payments = seedData['finance/payments'] ?? []
    const reports = seedData['finance/reports'] ?? []
    for (const rpt of reports) {
      const period = rpt.values.period
      if (!period) continue
      const [mm, yyyy] = period.split('.')
      if (!mm || !yyyy) continue
      const prefix = `${yyyy}-${mm}`
      const invForPeriod = invoices.filter((inv) => (inv.values.dueDate ?? '').startsWith(prefix))
      const inIssued = invForPeriod
        .filter((i) => i.values.direction === 'incoming' && i.status !== 'cancelled')
        .reduce((s, i) => s + parseAmount(i.values.amount), 0)
      const inPaid = invForPeriod
        .filter((i) => i.values.direction === 'incoming')
        .reduce((s, i) => s + parseAmount(i.values.paidAmount), 0)
      const outIssued = invForPeriod
        .filter((i) => i.values.direction === 'outgoing' && i.status !== 'cancelled')
        .reduce((s, i) => s + parseAmount(i.values.amount), 0)
      const outPaid = invForPeriod
        .filter((i) => i.values.direction === 'outgoing')
        .reduce((s, i) => s + parseAmount(i.values.paidAmount), 0)
      const open = invForPeriod
        .filter((i) => i.status !== 'cancelled' && i.status !== 'paid')
        .reduce(
          (s, i) => s + (parseAmount(i.values.amount) - parseAmount(i.values.paidAmount)),
          0,
        )
      const reconciled = payments
        .filter((p) => p.status === 'reconciled')
        .filter((p) => {
          const inv = invoices.find((i) => i.id === p.values.invoice)
          return inv && (inv.values.dueDate ?? '').startsWith(prefix)
        })
        .reduce((s, p) => s + parseAmount(p.values.amount), 0)
      const checks: Array<[string, number, number]> = [
        ['incomingIssuedTotal', parseAmount(rpt.values.incomingIssuedTotal), inIssued],
        ['incomingPaidTotal', parseAmount(rpt.values.incomingPaidTotal), inPaid],
        ['outgoingIssuedTotal', parseAmount(rpt.values.outgoingIssuedTotal), outIssued],
        ['outgoingPaidTotal', parseAmount(rpt.values.outgoingPaidTotal), outPaid],
        ['openInvoiceTotal', parseAmount(rpt.values.openInvoiceTotal), open],
        ['reconciledPaymentsTotal', parseAmount(rpt.values.reconciledPaymentsTotal), reconciled],
      ]
      // Reports may include incoming from previous periods etc. — skip when stated as 0.
      const isDraftOrFuture = rpt.status === 'draft'
      if (isDraftOrFuture) continue
      for (const [field, declared, actual] of checks) {
        if (declared !== actual) {
          errors.push(`${rpt.id} (${period}) ${field}: declared=${declared}, actual=${actual}`)
        }
      }
    }
    expect(errors).toEqual([])
  })

  it('appointment date ≤ workorder eta for same car (when linked via VIN)', () => {
    const errors: string[] = []
    const wosByVin = new Map<string, EntityRecord[]>()
    for (const wo of seedData['service/orders'] ?? []) {
      const v = wo.values.vin
      if (!v) continue
      const arr = wosByVin.get(v) ?? []
      arr.push(wo)
      wosByVin.set(v, arr)
    }
    for (const ap of seedData['service/appointments'] ?? []) {
      const v = ap.values.vin
      if (!v) continue
      const woList = wosByVin.get(v) ?? []
      const apDate = parseDateTime(ap.values.date ?? '')
      if (!Number.isFinite(apDate)) continue
      for (const wo of woList) {
        const eta = parseDateTime(wo.values.eta ?? '')
        if (!Number.isFinite(eta)) continue
        // Allow same-day; flag only if appointment is strictly after eta
        if (apDate > eta + 24 * 3600 * 1000) {
          errors.push(
            `${ap.id}.date=${ap.values.date} > ${wo.id}.eta=${wo.values.eta} (same VIN)`,
          )
        }
      }
    }
    expect(errors).toEqual([])
  })
})
