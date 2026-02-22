import { useMemo, useRef, useState, type FormEvent } from 'react'

import type { SubsystemNavItem } from '../config/navigation'

type Seq = {
  appointment: number
  workorder: number
  invoice: number
  event: number
  procurement: number
}

type Slot = { id: string; bay: string; capacity: number; reserved: number; start: string }
type Appointment = { id: string; clientId: string; vin: string; slotId: string; status: 'scheduled' | 'cancelled' }
type WorkorderStatus = 'accepted' | 'diagnostics' | 'in_progress' | 'waiting_parts' | 'ready' | 'released' | 'closed'
type Workorder = {
  id: string
  vin: string
  assignee: string
  status: WorkorderStatus
  deadline: string
  repeatVisit: boolean
  qualityScore: number
}
type Invoice = { id: string; workorderId: string; grandTotal: number; paidTotal: number; status: 'issued' | 'partially_paid' | 'paid' | 'closed' }
type TimelineEvent = { id: string; type: string; entityId: string; note: string; at: string }
type Procurement = { id: string; partCode: string; missing: number; workorderId: string }

const transitions: Record<WorkorderStatus, WorkorderStatus[]> = {
  accepted: ['diagnostics', 'in_progress', 'waiting_parts'],
  diagnostics: ['in_progress', 'waiting_parts'],
  in_progress: ['waiting_parts', 'ready'],
  waiting_parts: ['in_progress', 'ready'],
  ready: ['released', 'closed'],
  released: ['closed'],
  closed: [],
}

const laborCatalog = [
  { code: 'LBR-OIL', title: 'Oil service', norm: 1.2, rate: 85 },
  { code: 'LBR-DIAG', title: 'Diagnostics', norm: 1.5, rate: 95 },
]

const workorderStatusLabel: Record<WorkorderStatus, string> = {
  accepted: 'принят',
  diagnostics: 'диагностика',
  in_progress: 'в работе',
  waiting_parts: 'ожидание запчастей',
  ready: 'готов',
  released: 'выдан',
  closed: 'закрыт',
}

const invoiceStatusLabel: Record<Invoice['status'], string> = {
  issued: 'выставлен',
  partially_paid: 'частично оплачен',
  paid: 'оплачен',
  closed: 'закрыт',
}

const partsActionLabel: Record<'reserve' | 'consume' | 'return', string> = {
  reserve: 'резерв',
  consume: 'списание',
  return: 'возврат',
}

function money(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function nowISO(): string {
  return new Date().toISOString()
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('ru-RU')
}

function isWarrantyActive(vin: string): boolean {
  return vin.toUpperCase().startsWith('VIN-W')
}

export function ServiceRepairWorkbench({ item }: { item: SubsystemNavItem }) {
  const seq = useRef<Seq>({ appointment: 1, workorder: 1, invoice: 1, event: 1, procurement: 1 })
  const nextID = (bucket: keyof Seq, prefix: string) => {
    const value = seq.current[bucket]
    seq.current[bucket] += 1
    return `${prefix}-${String(value).padStart(4, '0')}`
  }

  const [notice, setNotice] = useState('')
  const [slots, setSlots] = useState<Slot[]>([
    { id: 'SL-001', bay: 'A1', capacity: 1, reserved: 0, start: '2026-02-20T09:00:00Z' },
    { id: 'SL-002', bay: 'A2', capacity: 1, reserved: 0, start: '2026-02-20T10:00:00Z' },
  ])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [workorders, setWorkorders] = useState<Workorder[]>([])
  const [diagnosticsCount, setDiagnosticsCount] = useState(0)
  const [laborEstimate, setLaborEstimate] = useState(0)
  const [warrantyChecks, setWarrantyChecks] = useState(0)
  const [partActions, setPartActions] = useState<string[]>([])
  const [stock, setStock] = useState<Record<string, number>>({ 'PART-OIL': 4, 'PART-FILTER': 1 })
  const [procurements, setProcurements] = useState<Procurement[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [notifications, setNotifications] = useState<string[]>([])
  const [events, setEvents] = useState<TimelineEvent[]>([])

  const [appointmentForm, setAppointmentForm] = useState({ clientId: '', vin: '', slotId: 'SL-001' })
  const [workorderForm, setWorkorderForm] = useState({ vin: '', assignee: '', slaHours: '48' })
  const [diagForm, setDiagForm] = useState({ workorderId: '', faults: '' })
  const [laborForm, setLaborForm] = useState({ code: 'LBR-OIL', qty: '1' })
  const [partsForm, setPartsForm] = useState({ workorderId: '', partCode: 'PART-OIL', qty: '1', action: 'reserve' as 'reserve' | 'consume' | 'return' })
  const [invoiceForm, setInvoiceForm] = useState({ workorderId: '', total: '100' })
  const [paymentForm, setPaymentForm] = useState({ invoiceId: '', amount: '' })

  const pushEvent = (type: string, entityId: string, note: string) => {
    const entity: TimelineEvent = { id: nextID('event', 'evt'), type, entityId, note, at: nowISO() }
    setEvents((prev) => [entity, ...prev].slice(0, 40))
  }

  const checks = useMemo(
    () => [
      { label: 'Бронирование слотов и контроль загрузки', done: appointments.length > 0 && slots.some((slot) => slot.reserved > 0) },
      { label: 'Модель статусов WO с исполнителем', done: workorders.some((wo) => wo.assignee && wo.status !== 'accepted') },
      { label: 'Контроль SLA по WO', done: workorders.length > 0 },
      { label: 'Протокол диагностики и дефекты', done: diagnosticsCount > 0 },
      { label: 'Нормо-часы и оценка работ', done: laborEstimate > 0 },
      { label: 'Проверка гарантии по VIN', done: warrantyChecks > 0 },
      { label: 'Резерв/списание/возврат запчастей', done: ['reserve', 'consume', 'return'].every((x) => partActions.includes(x)) },
      { label: 'Автозакупка при дефиците', done: procurements.length > 0 },
      { label: 'Сервисный счет и акт закрытия', done: invoices.some((invoice) => invoice.status === 'closed') },
      { label: 'Уведомления клиента', done: notifications.length > 0 },
      { label: 'Панель KPI сервиса', done: workorders.length > 0 },
      { label: 'Повторные визиты и контроль качества', done: workorders.some((wo) => wo.repeatVisit && wo.qualityScore > 0) },
    ],
    [appointments.length, diagnosticsCount, invoices, laborEstimate, notifications.length, partActions, procurements.length, slots, warrantyChecks, workorders],
  )

  const onCreateAppointment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const slot = slots.find((x) => x.id === appointmentForm.slotId)
    if (!slot || !appointmentForm.clientId.trim() || !appointmentForm.vin.trim()) {
      setNotice('Нужны клиент, VIN и валидный слот.')
      return
    }
    if (slot.reserved >= slot.capacity) {
      setNotice('Слот заполнен.')
      return
    }
    const appointment: Appointment = {
      id: nextID('appointment', 'ap'),
      clientId: appointmentForm.clientId.trim(),
      vin: appointmentForm.vin.trim().toUpperCase(),
      slotId: slot.id,
      status: 'scheduled',
    }
    setAppointments((prev) => [appointment, ...prev])
    setSlots((prev) => prev.map((x) => (x.id === slot.id ? { ...x, reserved: x.reserved + 1 } : x)))
    setNotice(`Запись ${appointment.id} создана.`)
    setNotifications((prev) => [`Запись подтверждена для ${appointment.vin}`, ...prev].slice(0, 20))
    pushEvent('BookingCreated', appointment.id, `${appointment.slotId} / ${slot.bay}`)
    setWorkorderForm((prev) => ({ ...prev, vin: appointment.vin }))
  }

  const onCreateWorkorder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!workorderForm.vin.trim() || !workorderForm.assignee.trim()) {
      setNotice('Нужны VIN и исполнитель.')
      return
    }
    const vin = workorderForm.vin.trim().toUpperCase()
    const repeatVisit = workorders.some((wo) => wo.vin === vin && (wo.status === 'released' || wo.status === 'closed'))
    const slaHours = Number(workorderForm.slaHours)
    const deadline = new Date(Date.now() + (Number.isNaN(slaHours) ? 48 : slaHours) * 60 * 60 * 1000).toISOString()
    const workorder: Workorder = {
      id: nextID('workorder', 'wo'),
      vin,
      assignee: workorderForm.assignee.trim(),
      status: 'accepted',
      deadline,
      repeatVisit,
      qualityScore: 0,
    }
    setWorkorders((prev) => [workorder, ...prev])
    setNotice(`Заказ-наряд ${workorder.id} создан.`)
    pushEvent('WorkOrderOpened', workorder.id, workorder.assignee)
    setDiagForm((prev) => ({ ...prev, workorderId: workorder.id }))
    setPartsForm((prev) => ({ ...prev, workorderId: workorder.id }))
    setInvoiceForm((prev) => ({ ...prev, workorderId: workorder.id }))
  }

  const changeStatus = (workorderId: string, nextStatus: WorkorderStatus) => {
    const current = workorders.find((x) => x.id === workorderId)
    if (!current) return
    if (!transitions[current.status].includes(nextStatus) && current.status !== nextStatus) {
      setNotice(`Недопустимый переход статуса: ${workorderStatusLabel[current.status]} -> ${workorderStatusLabel[nextStatus]}`)
      return
    }
    setWorkorders((prev) => prev.map((x) => (x.id === workorderId ? { ...x, status: nextStatus } : x)))
    pushEvent('WorkorderStatusChanged', workorderId, `${workorderStatusLabel[current.status]} -> ${workorderStatusLabel[nextStatus]}`)
    if (nextStatus === 'ready' || nextStatus === 'released' || nextStatus === 'closed') {
      setNotifications((prev) => [`WO ${workorderId}: ${workorderStatusLabel[nextStatus]}`, ...prev].slice(0, 20))
    }
  }

  const onDiagnostics = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!diagForm.workorderId || !diagForm.faults.trim()) {
      setNotice('Нужны WO и описание дефектов.')
      return
    }
    const target = workorders.find((x) => x.id === diagForm.workorderId)
    if (!target) return
    setDiagnosticsCount((prev) => prev + 1)
    pushEvent('DiagnosticsCompleted', diagForm.workorderId, diagForm.faults)
    if (isWarrantyActive(target.vin)) {
      setWarrantyChecks((prev) => prev + 1)
      pushEvent('WarrantyChecked', target.vin, 'активна')
    }
  }

  const onEstimateLabor = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const selected = laborCatalog.find((x) => x.code === laborForm.code)
    const qty = Number(laborForm.qty)
    if (!selected || Number.isNaN(qty) || qty <= 0) return
    const estimate = Math.round(selected.norm * selected.rate * qty * 100) / 100
    setLaborEstimate(estimate)
    pushEvent('LaborEstimated', selected.code, money(estimate))
  }

  const onPartsAction = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!partsForm.workorderId) {
      setNotice('Выберите WO для операции с запчастями.')
      return
    }
    const qty = Number(partsForm.qty)
    if (Number.isNaN(qty) || qty <= 0) return
    const current = stock[partsForm.partCode] ?? 0
    if (partsForm.action === 'reserve' && current < qty) {
      const request: Procurement = { id: nextID('procurement', 'pr'), partCode: partsForm.partCode, missing: qty - current, workorderId: partsForm.workorderId }
      setProcurements((prev) => [request, ...prev])
      pushEvent('PartsShortageDetected', partsForm.workorderId, `${request.partCode}: дефицит ${request.missing}`)
      return
    }
    setPartActions((prev) => [...prev, partsForm.action])
    setStock((prev) => ({ ...prev, [partsForm.partCode]: partsForm.action === 'return' ? current + qty : current - qty }))
    pushEvent(partsForm.action === 'reserve' ? 'PartsReserved' : partsForm.action === 'consume' ? 'PartsConsumed' : 'PartsReturned', partsForm.workorderId, `${partsActionLabel[partsForm.action]} ${partsForm.partCode} x${qty}`)
  }

  const onCreateInvoice = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const total = Number(invoiceForm.total)
    if (!invoiceForm.workorderId || Number.isNaN(total) || total <= 0) return
    const invoice: Invoice = { id: nextID('invoice', 'si'), workorderId: invoiceForm.workorderId, grandTotal: total, paidTotal: 0, status: 'issued' }
    setInvoices((prev) => [invoice, ...prev])
    pushEvent('ServiceInvoiceIssued', invoice.id, money(total))
    setPaymentForm({ invoiceId: invoice.id, amount: `${invoice.grandTotal}` })
  }

  const onPayInvoice = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const amount = Number(paymentForm.amount)
    if (!paymentForm.invoiceId || Number.isNaN(amount) || amount <= 0) return
    setInvoices((prev) =>
      prev.map((invoice) => {
        if (invoice.id !== paymentForm.invoiceId) return invoice
        const paidTotal = Math.min(invoice.grandTotal, invoice.paidTotal + amount)
        const status = paidTotal >= invoice.grandTotal ? 'paid' : 'partially_paid'
        return { ...invoice, paidTotal, status }
      }),
    )
    pushEvent('PaymentReceived', paymentForm.invoiceId, money(amount))
  }

  const issueAct = (invoiceId: string) => {
    const invoice = invoices.find((x) => x.id === invoiceId)
    if (!invoice || invoice.status !== 'paid') return
    setInvoices((prev) => prev.map((x) => (x.id === invoiceId ? { ...x, status: 'closed' } : x)))
    pushEvent('CompletionActIssued', invoice.id, invoice.workorderId)
  }

  const setQuality = (workorderId: string, score: number) => {
    setWorkorders((prev) => prev.map((x) => (x.id === workorderId ? { ...x, qualityScore: score } : x)))
    pushEvent('QualityFeedbackRecorded', workorderId, `${score}/5`)
  }

  const kpi = useMemo(() => {
    const open = workorders.filter((x) => x.status !== 'closed').length
    const overdue = workorders.filter((x) => x.status !== 'closed' && new Date(x.deadline) < new Date()).length
    const repeatRate = workorders.length ? Math.round((workorders.filter((x) => x.repeatVisit).length / workorders.length) * 100) : 0
    const utilization = Math.round(slots.reduce((sum, slot) => sum + (slot.capacity ? (slot.reserved / slot.capacity) * 100 : 0), 0) / Math.max(1, slots.length))
    return { open, overdue, repeatRate, utilization }
  }, [slots, workorders])

  return (
    <section className="crm-workbench">
      <div className="crm-workbench__header">
        <article className="focus-panel">
          <div>
            <p className="focus-panel__label">Подсистема</p>
            <p className="focus-panel__value crm-workbench__metric">{item.title}</p>
          </div>
          <p className="focus-panel__note">Сервисный и ремонтный процесс доступен через веб-интерфейс.</p>
        </article>
        <article className="focus-panel">
          <div><p className="focus-panel__label">KPI</p><p className="focus-panel__value">{kpi.open} открытых WO</p></div>
          <p className="focus-panel__note">Просрочено: {kpi.overdue}, повторные: {kpi.repeatRate}%, загрузка: {kpi.utilization}%.</p>
        </article>
      </div>
      {notice ? <p className="crm-workbench__notice">{notice}</p> : null}

      <div className="crm-checks-grid">
        {checks.map((check) => (
          <label key={check.label} className={`crm-check ${check.done ? 'done' : ''}`}>
            <input type="checkbox" checked={check.done} readOnly />
            <span>{check.label}</span>
          </label>
        ))}
      </div>

      <div className="crm-workbench-grid">
        <article className="crm-card"><h3>Запись</h3>
          <form className="crm-form-grid" onSubmit={onCreateAppointment}>
            <input placeholder="ID клиента" value={appointmentForm.clientId} onChange={(e) => setAppointmentForm((p) => ({ ...p, clientId: e.target.value }))} />
            <input placeholder="VIN" value={appointmentForm.vin} onChange={(e) => setAppointmentForm((p) => ({ ...p, vin: e.target.value }))} />
            <select value={appointmentForm.slotId} onChange={(e) => setAppointmentForm((p) => ({ ...p, slotId: e.target.value }))}>{slots.map((x) => <option key={x.id} value={x.id}>{x.id} {x.bay} ({x.reserved}/{x.capacity})</option>)}</select>
            <button className="btn-secondary" type="submit">Создать запись</button>
          </form>
        </article>

        <article className="crm-card"><h3>Заказ-наряды</h3>
          <form className="crm-form-grid" onSubmit={onCreateWorkorder}>
            <input placeholder="VIN" value={workorderForm.vin} onChange={(e) => setWorkorderForm((p) => ({ ...p, vin: e.target.value }))} />
            <input placeholder="Исполнитель" value={workorderForm.assignee} onChange={(e) => setWorkorderForm((p) => ({ ...p, assignee: e.target.value }))} />
            <input placeholder="SLA, часов" value={workorderForm.slaHours} onChange={(e) => setWorkorderForm((p) => ({ ...p, slaHours: e.target.value }))} />
            <button className="btn-secondary" type="submit">Создать WO</button>
          </form>
          <ul className="crm-list crm-list--compact">{workorders.map((wo) => (
            <li key={wo.id}>
              <div><strong>{wo.id} ({workorderStatusLabel[wo.status]})</strong><p>{wo.assignee} | {wo.vin} | SLA {formatDate(wo.deadline)}</p></div>
              <div className="crm-list__actions">
                <select value={wo.status} onChange={(e) => changeStatus(wo.id, e.target.value as WorkorderStatus)}>
                  <option value="accepted">принят</option><option value="diagnostics">диагностика</option><option value="in_progress">в работе</option>
                  <option value="waiting_parts">ожидание запчастей</option><option value="ready">готов</option><option value="released">выдан</option><option value="closed">закрыт</option>
                </select>
                <button className="btn-secondary" type="button" onClick={() => setQuality(wo.id, 5)}>Оценка 5/5</button>
              </div>
            </li>
          ))}</ul>
        </article>

        <article className="crm-card"><h3>Диагностика, работы и запчасти</h3>
          <form className="crm-form-grid" onSubmit={onDiagnostics}>
            <select value={diagForm.workorderId} onChange={(e) => setDiagForm((p) => ({ ...p, workorderId: e.target.value }))}><option value="">Заказ-наряд</option>{workorders.map((wo) => <option key={wo.id} value={wo.id}>{wo.id}</option>)}</select>
            <input placeholder="Дефекты" value={diagForm.faults} onChange={(e) => setDiagForm((p) => ({ ...p, faults: e.target.value }))} />
            <button className="btn-secondary" type="submit">Сохранить диагностику</button>
          </form>
          <form className="crm-form-grid" onSubmit={onEstimateLabor}>
            <select value={laborForm.code} onChange={(e) => setLaborForm((p) => ({ ...p, code: e.target.value }))}>{laborCatalog.map((x) => <option key={x.code} value={x.code}>{x.code}</option>)}</select>
            <input placeholder="Количество" value={laborForm.qty} onChange={(e) => setLaborForm((p) => ({ ...p, qty: e.target.value }))} />
            <button className="btn-secondary" type="submit">Оценить работы</button>
            <p className="crm-mini-title">Оценка: {money(laborEstimate)}</p>
          </form>
          <form className="crm-form-grid" onSubmit={onPartsAction}>
            <select value={partsForm.workorderId} onChange={(e) => setPartsForm((p) => ({ ...p, workorderId: e.target.value }))}><option value="">Заказ-наряд</option>{workorders.map((wo) => <option key={wo.id} value={wo.id}>{wo.id}</option>)}</select>
            <select value={partsForm.partCode} onChange={(e) => setPartsForm((p) => ({ ...p, partCode: e.target.value }))}>{Object.keys(stock).map((code) => <option key={code} value={code}>{code} ({stock[code]})</option>)}</select>
            <input placeholder="Количество" value={partsForm.qty} onChange={(e) => setPartsForm((p) => ({ ...p, qty: e.target.value }))} />
            <select value={partsForm.action} onChange={(e) => setPartsForm((p) => ({ ...p, action: e.target.value as 'reserve' | 'consume' | 'return' }))}><option value="reserve">резерв</option><option value="consume">списание</option><option value="return">возврат</option></select>
            <button className="btn-secondary" type="submit">Применить операцию</button>
          </form>
        </article>

        <article className="crm-card"><h3>Биллинг и таймлайн</h3>
          <form className="crm-form-grid" onSubmit={onCreateInvoice}>
            <select value={invoiceForm.workorderId} onChange={(e) => setInvoiceForm((p) => ({ ...p, workorderId: e.target.value }))}><option value="">Заказ-наряд</option>{workorders.map((wo) => <option key={wo.id} value={wo.id}>{wo.id}</option>)}</select>
            <input placeholder="Сумма счета" value={invoiceForm.total} onChange={(e) => setInvoiceForm((p) => ({ ...p, total: e.target.value }))} />
            <button className="btn-secondary" type="submit">Создать счет</button>
          </form>
          <form className="crm-form-grid" onSubmit={onPayInvoice}>
            <select value={paymentForm.invoiceId} onChange={(e) => setPaymentForm((p) => ({ ...p, invoiceId: e.target.value }))}><option value="">Счет</option>{invoices.map((x) => <option key={x.id} value={x.id}>{x.id}</option>)}</select>
            <input placeholder="Сумма" value={paymentForm.amount} onChange={(e) => setPaymentForm((p) => ({ ...p, amount: e.target.value }))} />
            <button className="btn-secondary" type="submit">Провести оплату</button>
          </form>
          <ul className="crm-list crm-list--compact">{invoices.map((x) => (
            <li key={x.id}><div><strong>{x.id} ({invoiceStatusLabel[x.status]})</strong><p>{money(x.paidTotal)} / {money(x.grandTotal)}</p></div><div className="crm-list__actions"><button className="btn-secondary" type="button" onClick={() => issueAct(x.id)}>Выпустить акт</button></div></li>
          ))}</ul>
          <p className="crm-mini-title">Закупки: {procurements.length}</p>
          <p className="crm-mini-title">Уведомления: {notifications.length}</p>
          <ul className="crm-list crm-list--compact">{events.map((x) => <li key={x.id}><div><strong>{x.type}</strong><p>{x.entityId} | {x.note}</p></div></li>)}</ul>
        </article>
      </div>
    </section>
  )
}
