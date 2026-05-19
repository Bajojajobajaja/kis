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

function normalizeName(value: string | undefined): string {
  return (value ?? '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
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

  const clientName = normalizeName(client.title)

  // Step 1: deals that explicitly belong to this client (by name).
  const ownedDeals = deals.filter((deal) => {
    const dealClient = normalizeName(deal.values.client)
    return dealClient.length > 0 && dealClient === clientName
  })

  // Step 2: cars that belong to this client — directly via ownerClient OR
  // transitively via cars referenced by the client's deals.
  const ownedCarIds = new Set<string>()
  const ownedCarVins = new Set<string>()

  for (const car of cars) {
    if (normalizeName(car.values.ownerClient) === clientName && clientName.length > 0) {
      ownedCarIds.add(car.id)
      const vin = normalizeVIN(car.values.vin)
      if (vin) ownedCarVins.add(vin)
    }
  }

  for (const deal of ownedDeals) {
    const carId = (deal.values.carRecordId ?? '').trim()
    if (carId) ownedCarIds.add(carId)
    const dealVin = normalizeVIN(deal.values.vin)
    if (dealVin) ownedCarVins.add(dealVin)
    for (const r of deal.related) {
      if (r.storeKey === CARS_STORE_KEY && r.recordId) {
        ownedCarIds.add(r.recordId)
      }
    }
  }

  // Reverse-lookup: pull in car records for any ids we've discovered, and
  // mirror their VIN into the VIN set so service activity matching works too.
  const ownedCars: EntityRecord[] = []
  const seenCarId = new Set<string>()
  for (const car of cars) {
    const carVin = normalizeVIN(car.values.vin)
    const matchedById = ownedCarIds.has(car.id)
    const matchedByVin = carVin.length > 0 && ownedCarVins.has(carVin)
    if (matchedById || matchedByVin) {
      if (!seenCarId.has(car.id)) {
        ownedCars.push(car)
        seenCarId.add(car.id)
        ownedCarIds.add(car.id)
        if (carVin) ownedCarVins.add(carVin)
      }
    }
  }

  const carItems = ownedCars.map((car) =>
    rel(client.id, 'Автомобиль', carValue(car), CARS_STORE_KEY, car.id),
  )

  // Step 3: every deal that references one of the client's cars OR names
  // the client directly.
  const dealItems = deals
    .filter((deal) => {
      const carId = (deal.values.carRecordId ?? '').trim()
      const vin = normalizeVIN(deal.values.vin)
      const dealClient = normalizeName(deal.values.client)
      if (carId && ownedCarIds.has(carId)) return true
      if (vin && ownedCarVins.has(vin)) return true
      if (dealClient.length > 0 && dealClient === clientName) return true
      return false
    })
    .map((deal) => rel(client.id, 'Сделка', dealValue(deal), DEALS_STORE_KEY, deal.id))

  // Step 4: workorders and appointments are linked through the vehicle —
  // a repair belongs to the car, and through the car to its owner.
  const workorderItems = workorders
    .filter((workorder) => {
      const vin = normalizeVIN(workorder.values.vin)
      return vin.length > 0 && ownedCarVins.has(vin)
    })
    .map((workorder) =>
      rel(client.id, 'Заказ-наряд', workorderValue(workorder), SERVICE_ORDERS_STORE_KEY, workorder.id),
    )

  const appointmentItems = appointments
    .filter((appointment) => {
      const vin = normalizeVIN(appointment.values.vin)
      return vin.length > 0 && ownedCarVins.has(vin)
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
