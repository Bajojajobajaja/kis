import { useMemo, useRef, useState, type FormEvent } from 'react'

import type { SubsystemNavItem } from '../config/navigation'

type Seq = {
	part: number
	movement: number
	request: number
	order: number
	receipt: number
	task: number
	audit: number
	event: number
}

type Part = {
	id: string
	code: string
	name: string
	minQty: number
	maxQty: number
	reorderPoint: number
	leadDays: number
}

type StockPosition = {
	sku: string
	onHand: number
	reserved: number
	minQty: number
	maxQty: number
	reorderPoint: number
}

type StockMovement = {
	id: string
	sku: string
	type: 'receipt' | 'issue' | 'transfer' | 'adjust'
	quantity: number
	at: string
}

type ProcurementRequest = {
	id: string
	sku: string
	quantity: number
	status: 'new' | 'approved' | 'ordered' | 'closed' | 'cancelled'
	source: 'manual' | 'auto-replenishment'
}

type PurchaseOrder = {
	id: string
	requestID: string
	supplier: string
	status: 'created' | 'sent' | 'partially_received' | 'received' | 'cancelled'
}

type Receipt = {
	id: string
	orderID: string
	sku: string
	quantity: number
	status: 'received' | 'putaway' | 'closed'
}

type WarehouseTask = {
	id: string
	type: 'putaway' | 'picking' | 'issue'
	sku: string
	quantity: number
	reference: string
	status: 'new' | 'in_progress' | 'done'
}

type AuditRecord = {
	id: string
	sku: string
	bookQty: number
	factQty: number
	variance: number
	status: 'counted' | 'reconciled' | 'adjusted'
}

type Forecast = {
	sku: string
	available: number
	recommendedQty: number
	slowMoving: boolean
}

type DomainEvent = {
	id: string
	type: string
	note: string
	at: string
}

function normalizeSKU(value: string): string {
	return value.trim().toUpperCase()
}

const requestStatusLabel: Record<ProcurementRequest['status'], string> = {
	new: 'новая',
	approved: 'согласована',
	ordered: 'заказана',
	closed: 'закрыта',
	cancelled: 'отменена',
}

const requestSourceLabel: Record<ProcurementRequest['source'], string> = {
	manual: 'вручную',
	'auto-replenishment': 'автопополнение',
}

const orderStatusLabel: Record<PurchaseOrder['status'], string> = {
	created: 'создан',
	sent: 'отправлен',
	partially_received: 'частично принят',
	received: 'принят',
	cancelled: 'отменен',
}

const receiptStatusLabel: Record<Receipt['status'], string> = {
	received: 'принята',
	putaway: 'размещена',
	closed: 'закрыта',
}

const taskStatusLabel: Record<WarehouseTask['status'], string> = {
	new: 'новое',
	in_progress: 'в работе',
	done: 'выполнено',
}

const taskTypeLabel: Record<WarehouseTask['type'], string> = {
	putaway: 'размещение',
	picking: 'комплектация',
	issue: 'выдача',
}

const auditStatusLabel: Record<AuditRecord['status'], string> = {
	counted: 'подсчитано',
	reconciled: 'сверено',
	adjusted: 'скорректировано',
}

export function InventoryWarehouseWorkbench({ item }: { item: SubsystemNavItem }) {
	const seq = useRef<Seq>({ part: 1, movement: 1, request: 1, order: 1, receipt: 1, task: 1, audit: 1, event: 1 })
	const nextID = (bucket: keyof Seq, prefix: string): string => {
		const value = seq.current[bucket]
		seq.current[bucket] += 1
		return `${prefix}-${String(value).padStart(4, '0')}`
	}

	const [notice, setNotice] = useState('')
	const [parts, setParts] = useState<Part[]>([
		{ id: 'pt-0001', code: 'PART-OIL', name: 'Масло двигателя', minQty: 5, maxQty: 30, reorderPoint: 8, leadDays: 5 },
		{ id: 'pt-0002', code: 'PART-FILTER', name: 'Масляный фильтр', minQty: 4, maxQty: 20, reorderPoint: 6, leadDays: 7 },
	])
	const [stock, setStock] = useState<StockPosition[]>([
		{ sku: 'PART-OIL', onHand: 12, reserved: 1, minQty: 5, maxQty: 30, reorderPoint: 8 },
		{ sku: 'PART-FILTER', onHand: 3, reserved: 0, minQty: 4, maxQty: 20, reorderPoint: 6 },
	])
	const [movements, setMovements] = useState<StockMovement[]>([])
	const [requests, setRequests] = useState<ProcurementRequest[]>([])
	const [orders, setOrders] = useState<PurchaseOrder[]>([])
	const [receipts, setReceipts] = useState<Receipt[]>([])
	const [tasks, setTasks] = useState<WarehouseTask[]>([])
	const [audits, setAudits] = useState<AuditRecord[]>([])
	const [forecasts, setForecasts] = useState<Forecast[]>([])
	const [events, setEvents] = useState<DomainEvent[]>([])
	const [partActions, setPartActions] = useState<Array<'reserve' | 'release' | 'issue'>>([])
	const [forecastRan, setForecastRan] = useState(false)

	const [partForm, setPartForm] = useState({
		code: '',
		name: '',
		minQty: '0',
		maxQty: '0',
		reorderPoint: '0',
		leadDays: '0',
	})
	const [movementForm, setMovementForm] = useState({
		sku: 'PART-OIL',
		type: 'receipt' as StockMovement['type'],
		quantity: '1',
	})
	const [reserveForm, setReserveForm] = useState({
		sku: 'PART-OIL',
		action: 'reserve' as 'reserve' | 'release' | 'issue',
		quantity: '1',
	})
	const [requestForm, setRequestForm] = useState({ sku: 'PART-FILTER', quantity: '5' })
	const [receiveForm, setReceiveForm] = useState({ orderID: '', sku: 'PART-FILTER', quantity: '1' })
	const [taskForm, setTaskForm] = useState({
		type: 'picking' as WarehouseTask['type'],
		sku: 'PART-FILTER',
		quantity: '1',
		reference: '',
	})
	const [auditForm, setAuditForm] = useState({
		sku: 'PART-FILTER',
		bookQty: '0',
		factQty: '0',
		note: '',
		autoAdjust: true,
	})

	const skuOptions = useMemo(() => {
		const set = new Set<string>()
		for (const part of parts) set.add(part.code)
		for (const position of stock) set.add(position.sku)
		return Array.from(set).sort()
	}, [parts, stock])

	const pushEvent = (type: string, note: string) => {
		const entity: DomainEvent = {
			id: nextID('event', 'evt'),
			type,
			note,
			at: new Date().toISOString(),
		}
		setEvents((prev) => [entity, ...prev].slice(0, 50))
	}

	const ensureStockPosition = (sku: string, fallback?: Part): StockPosition => ({
		sku,
		onHand: 0,
		reserved: 0,
		minQty: fallback?.minQty ?? 0,
		maxQty: fallback?.maxQty ?? 0,
		reorderPoint: fallback?.reorderPoint ?? 0,
	})

	const updateStock = (sku: string, updater: (current: StockPosition) => StockPosition) => {
		setStock((prev) => {
			const index = prev.findIndex((position) => position.sku === sku)
			if (index >= 0) {
				const next = [...prev]
				next[index] = updater(next[index])
				return next
			}
			const policy = parts.find((part) => part.code === sku)
			return [...prev, updater(ensureStockPosition(sku, policy))]
		})
	}

	const onAddPart = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const code = normalizeSKU(partForm.code)
		const name = partForm.name.trim()
		if (!code || !name) {
			setNotice('Код и название запчасти обязательны.')
			return
		}

		const minQty = Number(partForm.minQty)
		const maxQty = Number(partForm.maxQty)
		const reorderPoint = Number(partForm.reorderPoint)
		const leadDays = Number(partForm.leadDays)
		if ([minQty, maxQty, reorderPoint, leadDays].some((value) => Number.isNaN(value) || value < 0)) {
			setNotice('Значения политики должны быть неотрицательными.')
			return
		}
		if (maxQty > 0 && minQty > maxQty) {
			setNotice('Минимум не может быть больше максимума.')
			return
		}

		const part: Part = {
			id: nextID('part', 'pt'),
			code,
			name,
			minQty,
			maxQty,
			reorderPoint: reorderPoint || minQty,
			leadDays,
		}
		setParts((prev) => {
			const index = prev.findIndex((item) => item.code === part.code)
			if (index >= 0) {
				const next = [...prev]
				next[index] = { ...part, id: next[index].id }
				return next
			}
			return [part, ...prev]
		})
		updateStock(code, (current) => ({
			...current,
			minQty: part.minQty,
			maxQty: part.maxQty,
			reorderPoint: part.reorderPoint,
		}))
		pushEvent('CatalogPartUpserted', `${part.code} ${part.name}`)
		setNotice(`Позиция ${part.code} сохранена.`)
		setPartForm({ code: '', name: '', minQty: '0', maxQty: '0', reorderPoint: '0', leadDays: '0' })
	}

	const onStockMovement = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const sku = normalizeSKU(movementForm.sku)
		const quantity = Number(movementForm.quantity)
		if (!sku) {
			setNotice('SKU обязателен.')
			return
		}
		if (movementForm.type === 'adjust') {
			if (Number.isNaN(quantity) || quantity === 0) {
				setNotice('Количество для корректировки не может быть нулевым.')
				return
			}
		} else if (Number.isNaN(quantity) || quantity <= 0) {
			setNotice('Количество должно быть положительным.')
			return
		}

		const current = stock.find((position) => position.sku === sku) ?? ensureStockPosition(sku, parts.find((part) => part.code === sku))
		const available = current.onHand - current.reserved

		if (movementForm.type === 'issue' || movementForm.type === 'transfer') {
			if (available < quantity) {
				setNotice('Недостаточно доступного остатка.')
				return
			}
		}
		if (movementForm.type === 'adjust' && current.onHand+quantity < current.reserved) {
			setNotice('Корректировка не может снизить остаток ниже зарезервированного.')
			return
		}

		updateStock(sku, (position) => {
			if (movementForm.type === 'receipt') return { ...position, onHand: position.onHand + quantity }
			if (movementForm.type === 'issue') return { ...position, onHand: position.onHand - quantity }
			if (movementForm.type === 'adjust') return { ...position, onHand: position.onHand + quantity }
			return position
		})

		const movement: StockMovement = {
			id: nextID('movement', 'mv'),
			sku,
			type: movementForm.type,
			quantity,
			at: new Date().toISOString(),
		}
		setMovements((prev) => [movement, ...prev])
		pushEvent(
			movementForm.type === 'receipt'
				? 'GoodsReceived'
				: movementForm.type === 'issue'
					? 'PartsIssued'
					: movementForm.type === 'transfer'
						? 'StockTransferred'
						: 'StockAdjusted',
			`${sku} ${quantity}`,
		)
		setNotice(`Движение ${movement.id} выполнено.`)
	}

	const onReserveAction = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const sku = normalizeSKU(reserveForm.sku)
		const quantity = Number(reserveForm.quantity)
		if (!sku || Number.isNaN(quantity) || quantity <= 0) {
			setNotice('Нужны SKU и положительное количество.')
			return
		}
		const current = stock.find((position) => position.sku === sku)
		if (!current) {
			setNotice('Позиция склада не найдена.')
			return
		}

		if (reserveForm.action === 'reserve' && current.onHand-current.reserved < quantity) {
			setNotice('Недостаточно доступного остатка для резерва.')
			return
		}
		if (reserveForm.action === 'release' && current.reserved < quantity) {
			setNotice('Недостаточно резерва для снятия.')
			return
		}
		if (reserveForm.action === 'issue' && current.onHand < quantity) {
			setNotice('Недостаточно остатка для выдачи.')
			return
		}

		updateStock(sku, (position) => {
			if (reserveForm.action === 'reserve') {
				return { ...position, reserved: position.reserved + quantity }
			}
			if (reserveForm.action === 'release') {
				return { ...position, reserved: position.reserved - quantity }
			}
			return { ...position, onHand: position.onHand - quantity, reserved: Math.max(0, position.reserved - quantity) }
		})
		setPartActions((prev) => [...prev, reserveForm.action])
		pushEvent(
			reserveForm.action === 'reserve' ? 'StockReserved' : reserveForm.action === 'release' ? 'StockReleased' : 'PartsIssued',
			`${sku} ${quantity}`,
		)
		const actionLabel = reserveForm.action === 'reserve' ? 'резерв' : reserveForm.action === 'release' ? 'снятие резерва' : 'выдача'
		setNotice(`Операция "${actionLabel}" выполнена для ${sku}.`)
	}

	const onCreateRequest = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const sku = normalizeSKU(requestForm.sku)
		const quantity = Number(requestForm.quantity)
		if (!sku || Number.isNaN(quantity) || quantity <= 0) {
			setNotice('Для заявки на закупку нужны SKU и количество.')
			return
		}
		const entity: ProcurementRequest = {
			id: nextID('request', 'pr'),
			sku,
			quantity,
			status: 'new',
			source: 'manual',
		}
		setRequests((prev) => [entity, ...prev])
		pushEvent('ProcurementRequestCreated', `${entity.id} ${entity.sku} x${entity.quantity}`)
		setNotice(`Заявка ${entity.id} создана.`)
	}

	const approveRequest = (requestID: string) => {
		setRequests((prev) =>
			prev.map((request) => (request.id === requestID && request.status === 'new' ? { ...request, status: 'approved' } : request)),
		)
		pushEvent('ProcurementRequestStatusChanged', `${requestID} approved`)
	}

	const createPurchaseOrder = (requestID: string) => {
		const request = requests.find((entity) => entity.id === requestID)
		if (!request || (request.status !== 'new' && request.status !== 'approved')) {
			setNotice('Для создания PO заявка должна быть новой или согласованной.')
			return
		}
		const order: PurchaseOrder = {
			id: nextID('order', 'po'),
			requestID: request.id,
			supplier: 'Поставщик по умолчанию',
			status: 'created',
		}
		setOrders((prev) => [order, ...prev])
		setRequests((prev) => prev.map((entity) => (entity.id === request.id ? { ...entity, status: 'ordered' } : entity)))
		setReceiveForm((prev) => ({ ...prev, orderID: order.id, sku: request.sku }))
		pushEvent('PurchaseOrderCreated', `${order.id} from ${request.id}`)
		setNotice(`PO ${order.id} создан.`)
	}

	const changeOrderStatus = (orderID: string, status: PurchaseOrder['status']) => {
		setOrders((prev) => prev.map((order) => (order.id === orderID ? { ...order, status } : order)))
		pushEvent('PurchaseOrderStatusChanged', `${orderID} ${status}`)
	}

	const onReceive = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const orderID = receiveForm.orderID
		const sku = normalizeSKU(receiveForm.sku)
		const quantity = Number(receiveForm.quantity)
		if (!orderID || !sku || Number.isNaN(quantity) || quantity <= 0) {
			setNotice('Для приемки нужны заказ, SKU и количество.')
			return
		}

		const receipt: Receipt = {
			id: nextID('receipt', 'rc'),
			orderID,
			sku,
			quantity,
			status: 'received',
		}
		const task: WarehouseTask = {
			id: nextID('task', 'wt'),
			type: 'putaway',
			sku,
			quantity,
			reference: receipt.id,
			status: 'new',
		}
		setReceipts((prev) => [receipt, ...prev])
		setTasks((prev) => [task, ...prev])
		updateStock(sku, (position) => ({ ...position, onHand: position.onHand + quantity }))
		changeOrderStatus(orderID, 'partially_received')
		pushEvent('GoodsReceived', `${receipt.id} ${sku} x${quantity}`)
		setNotice(`Приемка ${receipt.id} зарегистрирована.`)
	}

	const onCreateTask = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const sku = normalizeSKU(taskForm.sku)
		const quantity = Number(taskForm.quantity)
		if (!sku || Number.isNaN(quantity) || quantity <= 0) {
			setNotice('Для задания нужны SKU и количество.')
			return
		}
		const task: WarehouseTask = {
			id: nextID('task', 'wt'),
			type: taskForm.type,
			sku,
			quantity,
			reference: taskForm.reference.trim(),
			status: 'new',
		}
		setTasks((prev) => [task, ...prev])
		pushEvent('WarehouseTaskCreated', `${task.id} ${task.type}`)
	}

	const completeTask = (taskID: string) => {
		const task = tasks.find((entity) => entity.id === taskID)
		if (!task) return
		if (task.type === 'issue') {
			const position = stock.find((entity) => entity.sku === task.sku)
			if (!position || position.onHand < task.quantity) {
				setNotice('Недостаточно остатка для выполнения задания на выдачу.')
				return
			}
			updateStock(task.sku, (current) => ({
				...current,
				onHand: current.onHand - task.quantity,
				reserved: Math.max(0, current.reserved - task.quantity),
			}))
		}
		setTasks((prev) => prev.map((entity) => (entity.id === taskID ? { ...entity, status: 'done' } : entity)))
		pushEvent(
			task.type === 'putaway' ? 'PutawayCompleted' : task.type === 'picking' ? 'PickingCompleted' : 'GoodsIssued',
			`${task.id} ${task.sku} x${task.quantity}`,
		)
	}

	const onAudit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const sku = normalizeSKU(auditForm.sku)
		const bookQty = Number(auditForm.bookQty)
		const factQty = Number(auditForm.factQty)
		if (!sku || Number.isNaN(bookQty) || Number.isNaN(factQty) || bookQty < 0 || factQty < 0) {
			setNotice('Нужны корректные SKU, учетное и фактическое количество.')
			return
		}
		const variance = factQty - bookQty
		const status: AuditRecord['status'] =
			variance === 0 ? 'reconciled' : auditForm.autoAdjust ? 'adjusted' : 'counted'
		const entity: AuditRecord = {
			id: nextID('audit', 'ia'),
			sku,
			bookQty,
			factQty,
			variance,
			status,
		}
		setAudits((prev) => [entity, ...prev])
		if (variance !== 0 && auditForm.autoAdjust) {
			updateStock(sku, (current) => ({ ...current, onHand: current.onHand + variance }))
			pushEvent('StockAdjusted', `${sku} delta ${variance}`)
		}
		pushEvent('InventoryCountRecorded', `${entity.id} ${sku} variance ${variance}`)
		if (variance !== 0) {
			pushEvent('InventoryVarianceDetected', `${sku} variance ${variance}`)
		}
		setNotice(`Инвентаризация ${entity.id} сохранена.`)
	}

	const runReplenishment = () => {
		const issueQtyBySKU = movements
			.filter((movement) => movement.type === 'issue')
			.reduce<Record<string, number>>((acc, movement) => {
				acc[movement.sku] = (acc[movement.sku] ?? 0) + movement.quantity
				return acc
			}, {})

		const recommendations: Forecast[] = stock
			.map((position) => {
				const policy = parts.find((part) => part.code === position.sku)
				const reorderPoint = policy?.reorderPoint ?? position.reorderPoint
				const maxQty = policy?.maxQty ?? position.maxQty
				const available = position.onHand - position.reserved
				let recommendedQty = 0
				if (available <= reorderPoint) {
					const target = maxQty > 0 ? maxQty : Math.max(reorderPoint*2, 1)
					recommendedQty = Math.max(0, target - available)
				}
				const slowMoving = (issueQtyBySKU[position.sku] ?? 0) === 0 && available > reorderPoint && position.onHand > 0
				return { sku: position.sku, available, recommendedQty, slowMoving }
			})
			.filter((entity) => entity.recommendedQty > 0 || entity.slowMoving)
			.sort((a, b) => b.recommendedQty - a.recommendedQty)

		setForecasts(recommendations)
		setForecastRan(true)
		setRequests((prev) => {
			const open = new Set(prev.filter((request) => ['new', 'approved', 'ordered'].includes(request.status)).map((request) => request.sku))
			const created: ProcurementRequest[] = []
			for (const recommendation of recommendations) {
				if (recommendation.recommendedQty <= 0 || open.has(recommendation.sku)) continue
				const request: ProcurementRequest = {
					id: nextID('request', 'pr'),
					sku: recommendation.sku,
					quantity: recommendation.recommendedQty,
					status: 'new',
					source: 'auto-replenishment',
				}
				created.push(request)
				open.add(request.sku)
			}
			if (created.length > 0) {
				pushEvent('ReplenishmentRunCompleted', `auto created: ${created.length}`)
			}
			return [...created, ...prev]
		})
		setNotice(`Расчет пополнения выполнен. Рекомендаций: ${recommendations.length}.`)
	}

	const checks = useMemo(
		() => [
			{ label: 'Единый каталог авто/запчастей', done: parts.length > 0 },
			{ label: 'Остатки и движения: приход/расход/перемещение', done: ['receipt', 'issue', 'transfer'].every((type) => movements.some((movement) => movement.type === type)) },
			{ label: 'Резерв и освобождение остатков', done: ['reserve', 'release'].every((type) => partActions.includes(type as 'reserve' | 'release' | 'issue')) },
			{ label: 'Заявки и заказы поставщикам со статусами', done: requests.length > 0 && orders.length > 0 },
			{ label: 'Min/Max и точка заказа', done: forecasts.some((forecast) => forecast.recommendedQty > 0) },
			{ label: 'Складские операции: приемка/размещение/комплектация/выдача', done: receipts.length > 0 && ['putaway', 'picking', 'issue'].every((type) => tasks.some((task) => task.type === type)) },
			{ label: 'Инвентаризация и ведомости', done: audits.length > 0 },
			{ label: 'Обработка расхождений и корректировки', done: audits.some((audit) => audit.variance !== 0 && (audit.status === 'counted' || audit.status === 'adjusted')) },
			{ label: 'Аудит изменений склада', done: events.length >= 5 },
			{ label: 'Прогноз спроса и пополнение', done: forecastRan },
			{ label: 'Оптимизация оборачиваемости', done: forecasts.some((forecast) => forecast.slowMoving || forecast.recommendedQty > 0) },
			{ label: 'Контроль излишков и slow-moving', done: forecasts.some((forecast) => forecast.slowMoving) },
		],
		[audits, events.length, forecastRan, forecasts, movements, orders.length, partActions, parts.length, receipts.length, requests.length, tasks],
	)

	const openRequests = requests.filter((request) => request.status !== 'closed' && request.status !== 'cancelled').length
	const criticalStock = stock.filter((position) => position.onHand-position.reserved <= position.reorderPoint).length

	return (
		<section className="crm-workbench">
			<div className="crm-workbench__header">
				<article className="focus-panel">
					<div>
						<p className="focus-panel__label">Подсистема</p>
						<p className="focus-panel__value crm-workbench__metric">{item.title}</p>
					</div>
					<p className="focus-panel__note">Складской и закупочный процесс управляется через веб-интерфейс.</p>
				</article>
				<article className="focus-panel">
					<div>
						<p className="focus-panel__label">Критичные позиции</p>
						<p className="focus-panel__value">{criticalStock}</p>
					</div>
					<p className="focus-panel__note">Открытых заявок на закупку: {openRequests}.</p>
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
					<h3>Мастер-данные и ядро склада</h3>
					<form className="crm-form-grid" onSubmit={onAddPart}>
						<input placeholder="Код запчасти" value={partForm.code} onChange={(event) => setPartForm((prev) => ({ ...prev, code: event.target.value }))} />
						<input placeholder="Название запчасти" value={partForm.name} onChange={(event) => setPartForm((prev) => ({ ...prev, name: event.target.value }))} />
						<input placeholder="Мин. остаток" value={partForm.minQty} onChange={(event) => setPartForm((prev) => ({ ...prev, minQty: event.target.value }))} />
						<input placeholder="Макс. остаток" value={partForm.maxQty} onChange={(event) => setPartForm((prev) => ({ ...prev, maxQty: event.target.value }))} />
						<input placeholder="Точка заказа" value={partForm.reorderPoint} onChange={(event) => setPartForm((prev) => ({ ...prev, reorderPoint: event.target.value }))} />
						<input placeholder="Срок поставки (дни)" value={partForm.leadDays} onChange={(event) => setPartForm((prev) => ({ ...prev, leadDays: event.target.value }))} />
						<button className="btn-secondary" type="submit">Сохранить политику</button>
					</form>

					<form className="crm-form-grid" onSubmit={onStockMovement}>
						<select value={movementForm.sku} onChange={(event) => setMovementForm((prev) => ({ ...prev, sku: event.target.value }))}>
							{skuOptions.map((sku) => <option key={sku} value={sku}>{sku}</option>)}
						</select>
						<select value={movementForm.type} onChange={(event) => setMovementForm((prev) => ({ ...prev, type: event.target.value as StockMovement['type'] }))}>
							<option value="receipt">приход</option>
							<option value="issue">расход</option>
							<option value="transfer">перемещение</option>
							<option value="adjust">корректировка</option>
						</select>
						<input placeholder="Количество" value={movementForm.quantity} onChange={(event) => setMovementForm((prev) => ({ ...prev, quantity: event.target.value }))} />
						<button className="btn-secondary" type="submit">Провести движение</button>
					</form>

					<p className="crm-mini-title">Складские позиции</p>
					<ul className="crm-list crm-list--compact">
						{stock.map((position) => (
							<li key={position.sku}>
								<div>
									<strong>{position.sku}</strong>
									<p>в наличии {position.onHand} | в резерве {position.reserved} | точка заказа {position.reorderPoint}</p>
								</div>
							</li>
						))}
					</ul>
				</article>

				<article className="crm-card">
					<h3>Резервы и закупки</h3>
					<form className="crm-form-grid" onSubmit={onReserveAction}>
						<select value={reserveForm.sku} onChange={(event) => setReserveForm((prev) => ({ ...prev, sku: event.target.value }))}>
							{skuOptions.map((sku) => <option key={sku} value={sku}>{sku}</option>)}
						</select>
						<select value={reserveForm.action} onChange={(event) => setReserveForm((prev) => ({ ...prev, action: event.target.value as 'reserve' | 'release' | 'issue' }))}>
							<option value="reserve">резерв</option>
							<option value="release">снять резерв</option>
							<option value="issue">выдать</option>
						</select>
						<input placeholder="Количество" value={reserveForm.quantity} onChange={(event) => setReserveForm((prev) => ({ ...prev, quantity: event.target.value }))} />
						<button className="btn-secondary" type="submit">Применить операцию</button>
					</form>

					<form className="crm-form-grid" onSubmit={onCreateRequest}>
						<select value={requestForm.sku} onChange={(event) => setRequestForm((prev) => ({ ...prev, sku: event.target.value }))}>
							{skuOptions.map((sku) => <option key={sku} value={sku}>{sku}</option>)}
						</select>
						<input placeholder="Количество в заявке" value={requestForm.quantity} onChange={(event) => setRequestForm((prev) => ({ ...prev, quantity: event.target.value }))} />
						<button className="btn-secondary" type="submit">Создать заявку</button>
					</form>

					<p className="crm-mini-title">Заявки</p>
					<ul className="crm-list crm-list--compact">
						{requests.map((request) => (
							<li key={request.id}>
								<div>
									<strong>{request.id} ({requestStatusLabel[request.status]})</strong>
									<p>{request.sku} x{request.quantity} | {requestSourceLabel[request.source]}</p>
								</div>
								<div className="crm-list__actions">
									<button className="btn-secondary" type="button" onClick={() => approveRequest(request.id)}>Согласовать</button>
									<button className="btn-secondary" type="button" onClick={() => createPurchaseOrder(request.id)}>Создать PO</button>
								</div>
							</li>
						))}
					</ul>

					<p className="crm-mini-title">Заказы поставщику</p>
					<ul className="crm-list crm-list--compact">
						{orders.map((order) => (
							<li key={order.id}>
								<div>
									<strong>{order.id} ({orderStatusLabel[order.status]})</strong>
									<p>заявка {order.requestID} | {order.supplier}</p>
								</div>
								<div className="crm-list__actions">
									<button className="btn-secondary" type="button" onClick={() => changeOrderStatus(order.id, 'sent')}>Отправить</button>
									<button className="btn-secondary" type="button" onClick={() => changeOrderStatus(order.id, 'received')}>Принять</button>
								</div>
							</li>
						))}
					</ul>
				</article>

				<article className="crm-card">
					<h3>Приемка и складские операции</h3>
					<form className="crm-form-grid" onSubmit={onReceive}>
						<select value={receiveForm.orderID} onChange={(event) => setReceiveForm((prev) => ({ ...prev, orderID: event.target.value }))}>
							<option value="">Выберите PO</option>
							{orders.map((order) => <option key={order.id} value={order.id}>{order.id}</option>)}
						</select>
						<select value={receiveForm.sku} onChange={(event) => setReceiveForm((prev) => ({ ...prev, sku: event.target.value }))}>
							{skuOptions.map((sku) => <option key={sku} value={sku}>{sku}</option>)}
						</select>
						<input placeholder="Принятое количество" value={receiveForm.quantity} onChange={(event) => setReceiveForm((prev) => ({ ...prev, quantity: event.target.value }))} />
						<button className="btn-secondary" type="submit">Зарегистрировать приемку</button>
					</form>

					<form className="crm-form-grid" onSubmit={onCreateTask}>
						<select value={taskForm.type} onChange={(event) => setTaskForm((prev) => ({ ...prev, type: event.target.value as WarehouseTask['type'] }))}>
							<option value="picking">комплектация</option>
							<option value="issue">выдача</option>
						</select>
						<select value={taskForm.sku} onChange={(event) => setTaskForm((prev) => ({ ...prev, sku: event.target.value }))}>
							{skuOptions.map((sku) => <option key={sku} value={sku}>{sku}</option>)}
						</select>
						<input placeholder="Количество" value={taskForm.quantity} onChange={(event) => setTaskForm((prev) => ({ ...prev, quantity: event.target.value }))} />
						<input placeholder="Ссылка" value={taskForm.reference} onChange={(event) => setTaskForm((prev) => ({ ...prev, reference: event.target.value }))} />
						<button className="btn-secondary" type="submit">Создать задание</button>
					</form>

					<p className="crm-mini-title">Приемки</p>
					<ul className="crm-list crm-list--compact">
						{receipts.map((receipt) => (
							<li key={receipt.id}>
								<div>
									<strong>{receipt.id}</strong>
									<p>{receipt.orderID} | {receipt.sku} x{receipt.quantity} | {receiptStatusLabel[receipt.status]}</p>
								</div>
							</li>
						))}
					</ul>

					<p className="crm-mini-title">Складские задания</p>
					<ul className="crm-list crm-list--compact">
						{tasks.map((task) => (
							<li key={task.id}>
								<div>
									<strong>{task.id} ({taskStatusLabel[task.status]})</strong>
									<p>{taskTypeLabel[task.type]} | {task.sku} x{task.quantity} | {task.reference || '-'}</p>
								</div>
								<div className="crm-list__actions">
									<button className="btn-secondary" type="button" onClick={() => completeTask(task.id)}>Готово</button>
								</div>
							</li>
						))}
					</ul>
				</article>

				<article className="crm-card">
					<h3>Инвентаризация и прогноз</h3>
					<form className="crm-form-grid" onSubmit={onAudit}>
						<select value={auditForm.sku} onChange={(event) => setAuditForm((prev) => ({ ...prev, sku: event.target.value }))}>
							{skuOptions.map((sku) => <option key={sku} value={sku}>{sku}</option>)}
						</select>
						<input placeholder="Учетное кол-во" value={auditForm.bookQty} onChange={(event) => setAuditForm((prev) => ({ ...prev, bookQty: event.target.value }))} />
						<input placeholder="Фактическое кол-во" value={auditForm.factQty} onChange={(event) => setAuditForm((prev) => ({ ...prev, factQty: event.target.value }))} />
						<input placeholder="Примечание" value={auditForm.note} onChange={(event) => setAuditForm((prev) => ({ ...prev, note: event.target.value }))} />
						<label className="crm-check">
							<input
								type="checkbox"
								checked={auditForm.autoAdjust}
								onChange={(event) => setAuditForm((prev) => ({ ...prev, autoAdjust: event.target.checked }))}
							/>
							<span>Автокоррекция расхождения</span>
						</label>
						<button className="btn-secondary" type="submit">Сохранить инвентаризацию</button>
					</form>

					<button className="btn-secondary" type="button" onClick={runReplenishment}>Запустить пополнение</button>

					<p className="crm-mini-title">Записи инвентаризации</p>
					<ul className="crm-list crm-list--compact">
						{audits.map((audit) => (
							<li key={audit.id}>
								<div>
									<strong>{audit.id}</strong>
									<p>{audit.sku} | учет {audit.bookQty} / факт {audit.factQty} / расхождение {audit.variance} / {auditStatusLabel[audit.status]}</p>
								</div>
							</li>
						))}
					</ul>

					<p className="crm-mini-title">Прогноз и рекомендации</p>
					<ul className="crm-list crm-list--compact">
						{forecasts.map((forecast) => (
							<li key={`${forecast.sku}-${forecast.recommendedQty}`}>
								<div>
									<strong>{forecast.sku}</strong>
									<p>доступно {forecast.available} | рекомендовано {forecast.recommendedQty} | slow {String(forecast.slowMoving)}</p>
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
