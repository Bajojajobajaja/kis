import type { EntityRecord, EntityRelatedRecord } from './model'

export const CLIENTS_STORE_KEY = 'crm-sales/clients'
export const CARS_STORE_KEY = 'crm-sales/cars'
export const DEALS_STORE_KEY = 'crm-sales/deals'
export const SERVICE_ORDERS_STORE_KEY = 'service/orders'
export const SERVICE_APPOINTMENTS_STORE_KEY = 'service/appointments'

type StoreSnapshot = Record<string, EntityRecord[]>

function normalizeVIN(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase()
}

function buildRelatedId(clientId: string, storeKey: string, recordId: string): string {
  return `auto-${clientId}-${storeKey}-${recordId}`
}

function rel(
  clientId: string,
  label: string,
  value: string,
  storeKey: string,
  recordId: string,
): EntityRelatedRecord {
  return {
    id: buildRelatedId(clientId, storeKey, recordId),
    label,
    value,
    storeKey,
    recordId,
  }
}

function carValue(car: EntityRecord): string {
  const vin = (car.values.vin ?? '').trim()
  const suffix = vin ? ` (VIN ${vin})` : ''
  return `${car.id} — ${car.title}${suffix}`
}

function dealValue(deal: EntityRecord): string {
  return `${deal.id} — ${deal.title}`
}

function workorderValue(workorder: EntityRecord): string {
  const subject = workorder.subtitle.trim() || workorder.title
  return `${workorder.id} — ${subject}`
}

function appointmentValue(appointment: EntityRecord): string {
  const subject = appointment.subtitle.trim() || appointment.title
  return `${appointment.id} — ${subject}`
}

function relatedEquals(a: EntityRelatedRecord[], b: EntityRelatedRecord[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i]
    const right = b[i]
    if (
      left.id !== right.id ||
      left.label !== right.label ||
      left.value !== right.value ||
      left.storeKey !== right.storeKey ||
      left.recordId !== right.recordId
    ) {
      return false
    }
  }
  return true
}

export function deriveClientRelated(
  client: EntityRecord,
  store: StoreSnapshot,
): EntityRelatedRecord[] {
  const cars = store[CARS_STORE_KEY] ?? []
  const deals = store[DEALS_STORE_KEY] ?? []
  const workorders = store[SERVICE_ORDERS_STORE_KEY] ?? []
  const appointments = store[SERVICE_APPOINTMENTS_STORE_KEY] ?? []

  const clientTitle = client.title.trim()
  const clientCars = cars.filter((car) => (car.values.ownerClient ?? '').trim() === clientTitle)

  const clientCarIds = new Set(clientCars.map((car) => car.id))
  const clientCarVins = new Set(
    clientCars
      .map((car) => normalizeVIN(car.values.vin))
      .filter((vin) => vin.length > 0),
  )

  const carItems = clientCars.map((car) =>
    rel(client.id, 'Автомобиль', carValue(car), CARS_STORE_KEY, car.id),
  )

  const dealItems = deals
    .filter((deal) => {
      const carId = (deal.values.carRecordId ?? '').trim()
      const vin = normalizeVIN(deal.values.vin)
      const dealClient = (deal.values.client ?? '').trim()
      if (carId && clientCarIds.has(carId)) return true
      if (vin && clientCarVins.has(vin)) return true
      if (dealClient && dealClient === clientTitle) return true
      return false
    })
    .map((deal) => rel(client.id, 'Сделка', dealValue(deal), DEALS_STORE_KEY, deal.id))

  const workorderItems = workorders
    .filter((workorder) => {
      const vin = normalizeVIN(workorder.values.vin)
      return vin.length > 0 && clientCarVins.has(vin)
    })
    .map((workorder) =>
      rel(client.id, 'Заказ-наряд', workorderValue(workorder), SERVICE_ORDERS_STORE_KEY, workorder.id),
    )

  const appointmentItems = appointments
    .filter((appointment) => {
      const vin = normalizeVIN(appointment.values.vin)
      return vin.length > 0 && clientCarVins.has(vin)
    })
    .map((appointment) =>
      rel(
        client.id,
        'Запись на сервис',
        appointmentValue(appointment),
        SERVICE_APPOINTMENTS_STORE_KEY,
        appointment.id,
      ),
    )

  return [...carItems, ...dealItems, ...workorderItems, ...appointmentItems]
}

export function synchronizeClientRelated(store: StoreSnapshot): StoreSnapshot {
  const clients = store[CLIENTS_STORE_KEY] ?? []
  if (clients.length === 0) {
    return store
  }

  let changed = false
  const nextClients = clients.map((client) => {
    const nextRelated = deriveClientRelated(client, store)
    if (relatedEquals(client.related, nextRelated)) {
      return client
    }
    changed = true
    return { ...client, related: nextRelated }
  })

  if (!changed) {
    return store
  }

  return {
    ...store,
    [CLIENTS_STORE_KEY]: nextClients,
  }
}
