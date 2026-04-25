import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import type { SubsystemNavItem } from '../config/navigation'
import { useEntityStore } from '../domain/EntityStoreContext'
import { buildCarDemandAnalytics, buildPartsDemandAnalytics } from '../domain/demandAnalytics'
import { paymentMethodOptions } from '../domain/fieldOptions'
import { fetchPartsUsages } from '../domain/servicePartsUsageApi'

type Seq = {
	account: number
	entry: number
	journal: number
	invoice: number
	payment: number
	costing: number
	export: number
	schedule: number
	compliance: number
	event: number
}

type Account = {
	code: string
	name: string
	category: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
}

type LedgerEntry = {
	id: string
	document: string
	eventType: string
	total: number
	hash: string
}

type JournalRecord = {
	id: string
	kind: string
	entityID: string
}

type Invoice = {
	id: string
	kind: 'ar' | 'ap'
	party: string
	amount: number
	paid: number
	status: 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled'
}

type Payment = {
	id: string
	invoiceID: string
	amount: number
	method: string
	externalID?: string
}

type Costing = {
	id: string
	domain: 'sales' | 'service' | 'inventory'
	revenue: number
	totalCost: number
	marginPct: number
}

type ReportExport = {
	id: string
	report: string
	format: 'xlsx' | 'csv' | 'pdf'
}

type ReportSchedule = {
	id: string
	name: string
	report: string
	format: 'xlsx' | 'csv' | 'pdf'
	runs: number
}

type MartSnapshot = {
	domain: 'sales' | 'service' | 'inventory'
	revenue: number
	expenses: number
	marginPct: number
}

type ComplianceRun = {
	id: string
	kind: 'tax' | 'compliance'
	period: string
	status: 'completed' | 'failed'
}

type DomainEvent = {
	id: string
	type: string
	note: string
}

function round2(value: number): number {
	return Math.round(value * 100) / 100
}

function hashLike(value: string): string {
	let hash = 0
	for (let i = 0; i < value.length; i += 1) {
		hash = (hash << 5) - hash + value.charCodeAt(i)
		hash |= 0
	}
	return `h${Math.abs(hash).toString(16)}`
}

const invoiceStatusLabel: Record<Invoice['status'], string> = {
	issued: 'выставлен',
	partially_paid: 'частично оплачен',
	paid: 'оплачен',
	overdue: 'просрочен',
	cancelled: 'отменен',
}

const domainLabel: Record<Costing['domain'], string> = {
	sales: 'продажи',
	service: 'сервис',
	inventory: 'склад',
}

const complianceKindLabel: Record<ComplianceRun['kind'], string> = {
	tax: 'налоги',
	compliance: 'комплаенс',
}

const complianceStatusLabel: Record<ComplianceRun['status'], string> = {
	completed: 'успешно',
	failed: 'ошибка',
}

export function FinanceReportingWorkbench({ item }: { item: SubsystemNavItem }) {
	const { getRecords } = useEntityStore()
	const seq = useRef<Seq>({
		account: 1,
		entry: 1,
		journal: 1,
		invoice: 1,
		payment: 1,
		costing: 1,
		export: 1,
		schedule: 1,
		compliance: 1,
		event: 1,
	})
	const nextID = (bucket: keyof Seq, prefix: string): string => {
		const value = seq.current[bucket]
		seq.current[bucket] += 1
		return `${prefix}-${String(value).padStart(4, '0')}`
	}
	const dealRecords = getRecords('crm-sales/deals')
	const carRecords = getRecords('crm-sales/cars')
	const stockRecords = getRecords('inventory/stock')

	const [notice, setNotice] = useState('')
	const [accounts, setAccounts] = useState<Account[]>([
		{ code: '1000', name: 'Денежные средства', category: 'asset' },
		{ code: '1100', name: 'Дебиторская задолженность', category: 'asset' },
		{ code: '1200', name: 'Запасы', category: 'asset' },
		{ code: '2000', name: 'Кредиторская задолженность', category: 'liability' },
		{ code: '4000', name: 'Выручка от продаж', category: 'revenue' },
		{ code: '5000', name: 'Себестоимость продаж', category: 'expense' },
	])
	const [entries, setEntries] = useState<LedgerEntry[]>([])
	const [journal, setJournal] = useState<JournalRecord[]>([])
	const [invoices, setInvoices] = useState<Invoice[]>([])
	const [payments, setPayments] = useState<Payment[]>([])
	const [costings, setCostings] = useState<Costing[]>([])
	const [exports, setExports] = useState<ReportExport[]>([])
	const [schedules, setSchedules] = useState<ReportSchedule[]>([])
	const [snapshots, setSnapshots] = useState<MartSnapshot[]>([
		{ domain: 'sales', revenue: 200000, expenses: 150000, marginPct: 25 },
	])
	const [complianceRuns, setComplianceRuns] = useState<ComplianceRun[]>([])
	const [events, setEvents] = useState<DomainEvent[]>([])
	const [refreshRuns, setRefreshRuns] = useState(0)
	const [partsDemandError, setPartsDemandError] = useState('')
	const [partsDemandLoading, setPartsDemandLoading] = useState(true)
	const [partsDemandSnapshot, setPartsDemandSnapshot] = useState<Awaited<ReturnType<typeof fetchPartsUsages>>>([])

	const [accountForm, setAccountForm] = useState({ code: '', name: '', category: 'asset' as Account['category'] })
	const [ledgerForm, setLedgerForm] = useState({ document: '', eventType: 'SalePaid', amount: '1000' })
	const [invoiceForm, setInvoiceForm] = useState({ party: '', amount: '1000', kind: 'ar' as Invoice['kind'] })
	const [paymentForm, setPaymentForm] = useState({
		invoiceID: '',
		amount: '500',
		method: paymentMethodOptions[0]?.value ?? 'Банковский перевод',
		externalID: '',
	})
	const [costingForm, setCostingForm] = useState({ domain: 'sales' as Costing['domain'], revenue: '1000', totalCost: '650' })
	const [reportForm, setReportForm] = useState({ report: 'pnl', format: 'xlsx' as ReportExport['format'] })
	const [scheduleForm, setScheduleForm] = useState({ name: 'Ежедневный отчет', report: 'pnl', format: 'xlsx' as ReportSchedule['format'] })
	const [snapshotForm, setSnapshotForm] = useState({ domain: 'service' as MartSnapshot['domain'], revenue: '120000', expenses: '90000' })
	const [complianceForm, setComplianceForm] = useState({ kind: 'tax' as ComplianceRun['kind'], period: '2026-02', status: 'completed' as ComplianceRun['status'] })

	const pushEvent = (type: string, note: string) => {
		const entity: DomainEvent = { id: nextID('event', 'evt'), type, note }
		setEvents((prev) => [entity, ...prev].slice(0, 60))
	}

	const pushJournal = (kind: string, entityID: string) => {
		setJournal((prev) => [{ id: nextID('journal', 'jr'), kind, entityID }, ...prev].slice(0, 120))
	}

	const onCreateAccount = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const code = accountForm.code.trim()
		const name = accountForm.name.trim()
		if (!code || !name) {
			setNotice('Код и название счета обязательны.')
			return
		}
		if (accounts.some((account) => account.code === code)) {
			setNotice('Счет уже существует.')
			return
		}
		const account: Account = { code, name, category: accountForm.category }
		setAccounts((prev) => [...prev, account].sort((a, b) => a.code.localeCompare(b.code)))
		pushJournal('account', code)
		pushEvent('LedgerAccountCreated', `${code} ${name}`)
		setNotice(`Счет ${code} создан.`)
		setAccountForm({ code: '', name: '', category: 'asset' })
	}

	const onPostLedger = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const amount = Number(ledgerForm.amount)
		if (!ledgerForm.document.trim() || Number.isNaN(amount) || amount <= 0) {
			setNotice('Нужны документ и положительная сумма.')
			return
		}
		const hash = hashLike(`${ledgerForm.document}:${ledgerForm.eventType}:${amount}:${entries.length}`)
		const entry: LedgerEntry = {
			id: nextID('entry', 'le'),
			document: ledgerForm.document.trim(),
			eventType: ledgerForm.eventType,
			total: round2(amount),
			hash,
		}
		setEntries((prev) => [entry, ...prev])
		pushJournal('entry', entry.id)
		pushEvent('LedgerEntryPosted', `${entry.id} ${entry.eventType} ${entry.total}`)
		setNotice(`Проводка ${entry.id} опубликована.`)
	}

	const onCreateInvoice = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const amount = Number(invoiceForm.amount)
		if (!invoiceForm.party.trim() || Number.isNaN(amount) || amount <= 0) {
			setNotice('Нужны контрагент и положительная сумма.')
			return
		}
		const invoice: Invoice = {
			id: nextID('invoice', 'inv'),
			kind: invoiceForm.kind,
			party: invoiceForm.party.trim(),
			amount: round2(amount),
			paid: 0,
			status: 'issued',
		}
		setInvoices((prev) => [invoice, ...prev])
		pushEvent('InvoiceCreated', `${invoice.id} ${invoice.kind} ${invoice.amount}`)
		setPaymentForm((prev) => ({ ...prev, invoiceID: invoice.id }))
		setNotice(`Счет ${invoice.id} создан.`)
	}

	const onPayInvoice = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const amount = Number(paymentForm.amount)
		if (!paymentForm.invoiceID || Number.isNaN(amount) || amount <= 0) {
			setNotice('Нужны счет и сумма.')
			return
		}
		const invoice = invoices.find((entity) => entity.id === paymentForm.invoiceID)
		if (!invoice) {
			setNotice('Счет не найден.')
			return
		}
		const payment: Payment = {
			id: nextID('payment', 'pay'),
			invoiceID: paymentForm.invoiceID,
			amount: round2(amount),
			method: paymentForm.method,
			externalID: paymentForm.externalID.trim() || undefined,
		}
		setPayments((prev) => [payment, ...prev])
		setInvoices((prev) =>
			prev.map((entity) => {
				if (entity.id !== payment.invoiceID) return entity
				const paid = round2(Math.min(entity.amount, entity.paid + payment.amount))
				return { ...entity, paid, status: paid >= entity.amount ? 'paid' : 'partially_paid' }
			}),
		)
		pushEvent(payment.externalID ? 'PaymentReconciled' : 'PaymentReceived', `${payment.invoiceID} ${payment.amount}`)
		setNotice(`Платеж ${payment.id} зафиксирован.`)
	}

	const onCalcCosting = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const revenue = Number(costingForm.revenue)
		const totalCost = Number(costingForm.totalCost)
		if (Number.isNaN(revenue) || Number.isNaN(totalCost) || revenue < 0 || totalCost < 0) {
			setNotice('Выручка и себестоимость должны быть корректными числами.')
			return
		}
		const marginPct = revenue > 0 ? round2(((revenue - totalCost) / revenue) * 100) : 0
		const costing: Costing = {
			id: nextID('costing', 'cs'),
			domain: costingForm.domain,
			revenue: round2(revenue),
			totalCost: round2(totalCost),
			marginPct,
		}
		setCostings((prev) => [costing, ...prev])
		pushEvent('CostCalculated', `${costing.domain} margin ${costing.marginPct}%`)
		setNotice(`Калькуляция ${costing.id} рассчитана.`)
	}

	const onExportReport = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const entity: ReportExport = {
			id: nextID('export', 're'),
			report: reportForm.report,
			format: reportForm.format,
		}
		setExports((prev) => [entity, ...prev])
		pushEvent('ReportExportCreated', `${entity.report}.${entity.format}`)
		setNotice(`Экспорт ${entity.id} создан.`)
	}

	const onCreateSchedule = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!scheduleForm.name.trim()) {
			setNotice('Название расписания обязательно.')
			return
		}
		const schedule: ReportSchedule = {
			id: nextID('schedule', 'rs'),
			name: scheduleForm.name.trim(),
			report: scheduleForm.report,
			format: scheduleForm.format,
			runs: 0,
		}
		setSchedules((prev) => [schedule, ...prev])
		pushEvent('ReportScheduleCreated', `${schedule.id} ${schedule.report}`)
		setNotice(`Расписание ${schedule.id} создано.`)
	}

	const runSchedule = (scheduleID: string) => {
		const schedule = schedules.find((entity) => entity.id === scheduleID)
		if (!schedule) return
		setSchedules((prev) => prev.map((entity) => (entity.id === scheduleID ? { ...entity, runs: entity.runs + 1 } : entity)))
		const entity: ReportExport = {
			id: nextID('export', 're'),
			report: schedule.report,
			format: schedule.format,
		}
		setExports((prev) => [entity, ...prev])
		pushEvent('ReportScheduleRun', `${scheduleID} -> ${entity.id}`)
	}

	const onUpsertSnapshot = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const revenue = Number(snapshotForm.revenue)
		const expenses = Number(snapshotForm.expenses)
		if (Number.isNaN(revenue) || Number.isNaN(expenses) || revenue < 0 || expenses < 0) {
			setNotice('Выручка и расходы должны быть корректными.')
			return
		}
		const marginPct = revenue > 0 ? round2(((revenue - expenses) / revenue) * 100) : 0
		setSnapshots((prev) => {
			const index = prev.findIndex((entity) => entity.domain === snapshotForm.domain)
			if (index >= 0) {
				const next = [...prev]
				next[index] = { ...next[index], revenue, expenses, marginPct }
				return next
			}
			return [...prev, { domain: snapshotForm.domain, revenue, expenses, marginPct }]
		})
		setRefreshRuns((prev) => prev + 1)
		pushEvent('MartsRefreshed', `${snapshotForm.domain} ${revenue}/${expenses}`)
	}

	const onComplianceRun = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const run: ComplianceRun = {
			id: nextID('compliance', 'cr'),
			kind: complianceForm.kind,
			period: complianceForm.period.trim() || '2026-02',
			status: complianceForm.status,
		}
		setComplianceRuns((prev) => [run, ...prev])
		pushEvent('ComplianceRunCompleted', `${run.kind} ${run.period} ${run.status}`)
	}

	const checks = useMemo(
		() => [
			{ label: 'Финансовый контур и план счетов', done: accounts.length >= 6 && entries.length > 0 },
			{ label: 'Постинг проводок из доменных событий', done: events.some((entity) => entity.type === 'LedgerEntryPosted') },
			{ label: 'Неизменяемый финансовый журнал', done: journal.length > 0 && entries.every((entry) => entry.hash.length > 0) },
			{ label: 'Контур AR/AP и дебиторка/кредиторка', done: invoices.some((invoice) => invoice.kind === 'ar') && invoices.some((invoice) => invoice.kind === 'ap') },
			{ label: 'Жизненный цикл счетов и статусы оплаты', done: invoices.some((invoice) => invoice.status === 'partially_paid' || invoice.status === 'paid') },
			{ label: 'Сверка внешних платежей', done: payments.some((payment) => Boolean(payment.externalID)) },
			{ label: 'Калькуляция по продажам/сервису/складу', done: ['sales', 'service', 'inventory'].every((domain) => costings.some((item) => item.domain === domain)) },
			{ label: 'Финансовые отчеты и расписания экспорта', done: exports.length > 0 && schedules.length > 0 && schedules.some((schedule) => schedule.runs > 0) },
			{ label: 'Near real-time KPI витрины', done: snapshots.length >= 2 && refreshRuns > 0 },
			{ label: 'Кросс-доменная финансовая аналитика', done: snapshots.length >= 3 },
			{ label: 'Автоматизация tax/compliance (опционально)', done: complianceRuns.length > 0 },
		],
		[accounts.length, complianceRuns.length, costings, entries, events, exports.length, invoices, journal.length, payments, refreshRuns, schedules, snapshots.length],
	)

	const totals = useMemo(() => {
		const revenue = snapshots.reduce((sum, item) => sum + item.revenue, 0)
		const expenses = snapshots.reduce((sum, item) => sum + item.expenses, 0)
		const marginPct = revenue > 0 ? round2(((revenue - expenses) / revenue) * 100) : 0
		return { revenue: round2(revenue), expenses: round2(expenses), marginPct }
	}, [snapshots])

	useEffect(() => {
		let isCancelled = false

		const loadPartsDemand = async () => {
			setPartsDemandLoading(true)
			setPartsDemandError('')
			try {
				const usages = await fetchPartsUsages('writeoff')
				if (!isCancelled) {
					setPartsDemandSnapshot(usages)
				}
			} catch (error) {
				if (!isCancelled) {
					setPartsDemandError(
						error instanceof Error ? error.message : 'Не удалось загрузить спрос по запчастям.',
					)
				}
			} finally {
				if (!isCancelled) {
					setPartsDemandLoading(false)
				}
			}
		}

		void loadPartsDemand()
		return () => {
			isCancelled = true
		}
	}, [])

	const carDemand = useMemo(
		() => buildCarDemandAnalytics(dealRecords, carRecords),
		[carRecords, dealRecords],
	)
	const partsDemand = useMemo(
		() => buildPartsDemandAnalytics(partsDemandSnapshot, stockRecords),
		[partsDemandSnapshot, stockRecords],
	)
	const topDemandModels = carDemand.models.slice(0, 5)
	const topDemandVehicles = carDemand.vehicles.slice(0, 5)
	const topDemandParts = partsDemand.slice(0, 5)

	return (
		<section className="crm-workbench">
			<div className="crm-workbench__header">
				<article className="focus-panel">
					<div>
						<p className="focus-panel__label">Подсистема</p>
						<p className="focus-panel__value crm-workbench__metric">{item.title}</p>
					</div>
					<p className="focus-panel__note">Финансовые процессы и отчетность доступны через веб-интерфейс.</p>
				</article>
				<article className="focus-panel">
					<div>
						<p className="focus-panel__label">Финансовый KPI</p>
						<p className="focus-panel__value">{totals.marginPct}%</p>
					</div>
					<p className="focus-panel__note">Выручка {totals.revenue} / Расходы {totals.expenses}</p>
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
				<article className="crm-card">
					<h3>Спрос на автомобили</h3>
					<p className="crm-mini-title">Топ моделей</p>
					{topDemandModels.length === 0 ? (
						<p>Пока нет закрытых продаж для построения спроса.</p>
					) : (
						<ul className="crm-list crm-list--compact">
							{topDemandModels.map((item) => (
								<li key={item.key}>
									<div>
										<strong>{item.label}</strong>
										<p>Продаж: {item.salesCount} | Выручка: {item.revenue}</p>
									</div>
								</li>
							))}
						</ul>
					)}
					<p className="crm-mini-title">Проданные автомобили</p>
					{topDemandVehicles.length === 0 ? (
						<p>Проданные карточки пока не сформированы.</p>
					) : (
						<ul className="crm-list crm-list--compact">
							{topDemandVehicles.map((item) => (
								<li key={item.key}>
									<div>
										<strong>{item.label}</strong>
										<p>{item.vin} | Продаж: {item.salesCount} | Выручка: {item.revenue}</p>
									</div>
								</li>
							))}
						</ul>
					)}
				</article>

				<article className="crm-card">
					<h3>Спрос на запчасти</h3>
					{partsDemandLoading ? (
						<p>Загружаем фактические списания...</p>
					) : partsDemandError ? (
						<p>{partsDemandError}</p>
					) : topDemandParts.length === 0 ? (
						<p>Пока нет фактических списаний по запчастям.</p>
					) : (
						<ul className="crm-list crm-list--compact">
							{topDemandParts.map((item) => (
								<li key={item.key}>
									<div>
										<strong>{item.title}</strong>
										<p>{item.key} | Списано: {item.quantity} | Операций: {item.operations}</p>
									</div>
								</li>
							))}
						</ul>
					)}
				</article>
			</div>

			<div className="crm-workbench-grid">
				<article className="crm-card">
					<h3>Проводки и журнал</h3>
					<form className="crm-form-grid" onSubmit={onCreateAccount}>
						<input placeholder="Код счета" value={accountForm.code} onChange={(event) => setAccountForm((prev) => ({ ...prev, code: event.target.value }))} />
						<input placeholder="Название счета" value={accountForm.name} onChange={(event) => setAccountForm((prev) => ({ ...prev, name: event.target.value }))} />
						<select value={accountForm.category} onChange={(event) => setAccountForm((prev) => ({ ...prev, category: event.target.value as Account['category'] }))}>
							<option value="asset">актив</option>
							<option value="liability">обязательство</option>
							<option value="equity">капитал</option>
							<option value="revenue">доход</option>
							<option value="expense">расход</option>
						</select>
						<button className="btn-secondary" type="submit">Создать счет</button>
					</form>
					<form className="crm-form-grid" onSubmit={onPostLedger}>
						<input placeholder="Документ" value={ledgerForm.document} onChange={(event) => setLedgerForm((prev) => ({ ...prev, document: event.target.value }))} />
						<select value={ledgerForm.eventType} onChange={(event) => setLedgerForm((prev) => ({ ...prev, eventType: event.target.value }))}>
							<option value="SalePaid">SalePaid</option>
							<option value="ServicePaid">ServicePaid</option>
							<option value="GoodsReceived">GoodsReceived</option>
							<option value="StockAdjusted">StockAdjusted</option>
						</select>
						<input placeholder="Сумма" value={ledgerForm.amount} onChange={(event) => setLedgerForm((prev) => ({ ...prev, amount: event.target.value }))} />
						<button className="btn-secondary" type="submit">Опубликовать проводку</button>
					</form>
					<ul className="crm-list crm-list--compact">
						{entries.map((entry) => (
							<li key={entry.id}>
								<div>
									<strong>{entry.id}</strong>
									<p>{entry.document} | {entry.eventType} | {entry.total} | {entry.hash}</p>
								</div>
							</li>
						))}
					</ul>
				</article>

				<article className="crm-card">
					<h3>AR/AP и платежи</h3>
					<form className="crm-form-grid" onSubmit={onCreateInvoice}>
						<input placeholder="Контрагент" value={invoiceForm.party} onChange={(event) => setInvoiceForm((prev) => ({ ...prev, party: event.target.value }))} />
						<select value={invoiceForm.kind} onChange={(event) => setInvoiceForm((prev) => ({ ...prev, kind: event.target.value as Invoice['kind'] }))}>
							<option value="ar">AR</option>
							<option value="ap">AP</option>
						</select>
						<input placeholder="Сумма" value={invoiceForm.amount} onChange={(event) => setInvoiceForm((prev) => ({ ...prev, amount: event.target.value }))} />
						<button className="btn-secondary" type="submit">Создать счет</button>
					</form>
					<form className="crm-form-grid" onSubmit={onPayInvoice}>
						<select value={paymentForm.invoiceID} onChange={(event) => setPaymentForm((prev) => ({ ...prev, invoiceID: event.target.value }))}>
							<option value="">Выберите счет</option>
							{invoices.map((invoice) => (
								<option key={invoice.id} value={invoice.id}>
									{invoice.id}
								</option>
							))}
						</select>
						<input placeholder="Сумма" value={paymentForm.amount} onChange={(event) => setPaymentForm((prev) => ({ ...prev, amount: event.target.value }))} />
						<select value={paymentForm.method} onChange={(event) => setPaymentForm((prev) => ({ ...prev, method: event.target.value }))}>
							{paymentMethodOptions.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
						<input placeholder="Внешний ID (необязательно)" value={paymentForm.externalID} onChange={(event) => setPaymentForm((prev) => ({ ...prev, externalID: event.target.value }))} />
						<button className="btn-secondary" type="submit">Зафиксировать платеж</button>
					</form>
					<ul className="crm-list crm-list--compact">
						{invoices.map((invoice) => (
							<li key={invoice.id}>
								<div>
									<strong>{invoice.id} ({invoice.kind.toUpperCase()})</strong>
									<p>{invoice.party} | {invoice.paid}/{invoice.amount} | {invoiceStatusLabel[invoice.status]}</p>
								</div>
							</li>
						))}
					</ul>
				</article>

				<article className="crm-card">
					<h3>Калькуляция и отчеты</h3>
					<form className="crm-form-grid" onSubmit={onCalcCosting}>
						<select value={costingForm.domain} onChange={(event) => setCostingForm((prev) => ({ ...prev, domain: event.target.value as Costing['domain'] }))}>
							<option value="sales">продажи</option>
							<option value="service">сервис</option>
							<option value="inventory">склад</option>
						</select>
						<input placeholder="Выручка" value={costingForm.revenue} onChange={(event) => setCostingForm((prev) => ({ ...prev, revenue: event.target.value }))} />
						<input placeholder="Себестоимость" value={costingForm.totalCost} onChange={(event) => setCostingForm((prev) => ({ ...prev, totalCost: event.target.value }))} />
						<button className="btn-secondary" type="submit">Рассчитать</button>
					</form>
					<form className="crm-form-grid" onSubmit={onExportReport}>
						<select value={reportForm.report} onChange={(event) => setReportForm((prev) => ({ ...prev, report: event.target.value }))}>
							<option value="pnl">pnl</option>
							<option value="cashflow">cashflow</option>
							<option value="margin">margin</option>
							<option value="ar-ap">ar-ap</option>
						</select>
						<select value={reportForm.format} onChange={(event) => setReportForm((prev) => ({ ...prev, format: event.target.value as ReportExport['format'] }))}>
							<option value="xlsx">xlsx</option>
							<option value="csv">csv</option>
							<option value="pdf">pdf</option>
						</select>
						<button className="btn-secondary" type="submit">Экспортировать отчет</button>
					</form>
					<form className="crm-form-grid" onSubmit={onCreateSchedule}>
						<input placeholder="Название расписания" value={scheduleForm.name} onChange={(event) => setScheduleForm((prev) => ({ ...prev, name: event.target.value }))} />
						<select value={scheduleForm.report} onChange={(event) => setScheduleForm((prev) => ({ ...prev, report: event.target.value }))}>
							<option value="pnl">pnl</option>
							<option value="cashflow">cashflow</option>
							<option value="margin">margin</option>
						</select>
						<select value={scheduleForm.format} onChange={(event) => setScheduleForm((prev) => ({ ...prev, format: event.target.value as ReportSchedule['format'] }))}>
							<option value="xlsx">xlsx</option>
							<option value="csv">csv</option>
							<option value="pdf">pdf</option>
						</select>
						<button className="btn-secondary" type="submit">Создать расписание</button>
					</form>
					<ul className="crm-list crm-list--compact">
						{schedules.map((schedule) => (
							<li key={schedule.id}>
								<div>
									<strong>{schedule.id}</strong>
									<p>{schedule.name} | {schedule.report}.{schedule.format} | запусков {schedule.runs}</p>
								</div>
								<div className="crm-list__actions">
									<button className="btn-secondary" type="button" onClick={() => runSchedule(schedule.id)}>
										Запустить
									</button>
								</div>
							</li>
						))}
					</ul>
				</article>

				<article className="crm-card">
					<h3>Витрины и compliance</h3>
					<form className="crm-form-grid" onSubmit={onUpsertSnapshot}>
						<select value={snapshotForm.domain} onChange={(event) => setSnapshotForm((prev) => ({ ...prev, domain: event.target.value as MartSnapshot['domain'] }))}>
							<option value="sales">продажи</option>
							<option value="service">сервис</option>
							<option value="inventory">склад</option>
						</select>
						<input placeholder="Выручка" value={snapshotForm.revenue} onChange={(event) => setSnapshotForm((prev) => ({ ...prev, revenue: event.target.value }))} />
						<input placeholder="Расходы" value={snapshotForm.expenses} onChange={(event) => setSnapshotForm((prev) => ({ ...prev, expenses: event.target.value }))} />
						<button className="btn-secondary" type="submit">Обновить витрину</button>
					</form>
					<form className="crm-form-grid" onSubmit={onComplianceRun}>
						<select value={complianceForm.kind} onChange={(event) => setComplianceForm((prev) => ({ ...prev, kind: event.target.value as ComplianceRun['kind'] }))}>
							<option value="tax">налоги</option>
							<option value="compliance">комплаенс</option>
						</select>
						<input placeholder="Период" value={complianceForm.period} onChange={(event) => setComplianceForm((prev) => ({ ...prev, period: event.target.value }))} />
						<select value={complianceForm.status} onChange={(event) => setComplianceForm((prev) => ({ ...prev, status: event.target.value as ComplianceRun['status'] }))}>
							<option value="completed">успешно</option>
							<option value="failed">ошибка</option>
						</select>
						<button className="btn-secondary" type="submit">Запустить проверку</button>
					</form>
					<p className="crm-mini-title">Снимки витрин</p>
					<ul className="crm-list crm-list--compact">
						{snapshots.map((snapshot) => (
							<li key={snapshot.domain}>
								<div>
									<strong>{domainLabel[snapshot.domain]}</strong>
									<p>{snapshot.revenue}/{snapshot.expenses} | маржа {snapshot.marginPct}%</p>
								</div>
							</li>
						))}
					</ul>
					<p className="crm-mini-title">Запуски compliance</p>
					<ul className="crm-list crm-list--compact">
						{complianceRuns.map((run) => (
							<li key={run.id}>
								<div>
									<strong>{run.id}</strong>
									<p>{complianceKindLabel[run.kind]} | {run.period} | {complianceStatusLabel[run.status]}</p>
								</div>
							</li>
						))}
					</ul>
					<p className="crm-mini-title">События</p>
					<ul className="crm-list crm-list--compact">
						{events.map((domainEvent) => (
							<li key={domainEvent.id}>
								<div>
									<strong>{domainEvent.type}</strong>
									<p>{domainEvent.note}</p>
								</div>
							</li>
						))}
					</ul>
				</article>
			</div>
		</section>
	)
}
