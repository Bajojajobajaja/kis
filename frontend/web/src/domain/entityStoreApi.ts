import type { EntityRecord } from './model'

type EntityStorePayload = {
  store: Record<string, EntityRecord[]>
}

const ENTITY_STORE_URL = '/gateway/entity-store'

function ensureStore(value: unknown): Record<string, EntityRecord[]> {
  if (!value || typeof value !== 'object') {
    return {}
  }
  return value as Record<string, EntityRecord[]>
}

export async function loadEntityStore(signal?: AbortSignal): Promise<Record<string, EntityRecord[]>> {
  const response = await fetch(ENTITY_STORE_URL, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) {
    throw new Error(`load entity store failed: ${response.status}`)
  }
  const payload = (await response.json()) as Partial<EntityStorePayload>
  return ensureStore(payload.store)
}

export async function saveEntityStore(store: Record<string, EntityRecord[]>): Promise<void> {
  const response = await fetch(ENTITY_STORE_URL, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ store }),
  })
  if (!response.ok) {
    throw new Error(`save entity store failed: ${response.status}`)
  }
}
