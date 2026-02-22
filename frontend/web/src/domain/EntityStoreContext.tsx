import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { loadEntityStore, saveEntityStore } from './entityStoreApi'
import type { EntityRecord } from './model'
import { seedData } from './seedData'

type CreateRecordInput = {
  storeKey: string
  idPrefix: string
  initialStatus: string
  title: string
  subtitle: string
  values: Record<string, string>
}

type UpdateRecordInput = {
  storeKey: string
  recordId: string
  title: string
  subtitle: string
  values: Record<string, string>
}

type UpdateStatusInput = {
  storeKey: string
  recordId: string
  status: string
  note: string
}

type EntityStoreContextValue = {
  store: Record<string, EntityRecord[]>
  getRecords: (storeKey: string) => EntityRecord[]
  getRecord: (storeKey: string, recordId: string) => EntityRecord | undefined
  createRecord: (payload: CreateRecordInput) => EntityRecord
  updateRecord: (payload: UpdateRecordInput) => void
  updateStatus: (payload: UpdateStatusInput) => void
  getAllRecords: () => Array<{ storeKey: string; record: EntityRecord }>
}

const EntityStoreContext = createContext<EntityStoreContextValue | undefined>(undefined)

function cloneSeed(): Record<string, EntityRecord[]> {
  return structuredClone(seedData)
}

function nextId(records: EntityRecord[], idPrefix: string): string {
  const maxId = records.reduce((max, record) => {
    if (!record.id.startsWith(`${idPrefix}-`)) {
      return max
    }
    const numeric = Number(record.id.slice(idPrefix.length + 1))
    if (Number.isNaN(numeric)) {
      return max
    }
    return Math.max(max, numeric)
  }, 0)

  return `${idPrefix}-${String(maxId + 1).padStart(4, '0')}`
}

function historyId(): string {
  return `h-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

export function EntityStoreProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<Record<string, EntityRecord[]>>(cloneSeed())
  const [isHydrated, setIsHydrated] = useState(false)

  useEffect(() => {
    let isCancelled = false
    const controller = new AbortController()

    const hydrate = async () => {
      try {
        const persistedStore = await loadEntityStore(controller.signal)
        if (isCancelled) {
          return
        }
        if (Object.keys(persistedStore).length > 0) {
          setStore(persistedStore)
        }
      } catch (error) {
        console.error('Failed to load entity store from backend', error)
      } finally {
        if (!isCancelled) {
          setIsHydrated(true)
        }
      }
    }

    void hydrate()
    return () => {
      isCancelled = true
      controller.abort()
    }
  }, [])

  useEffect(() => {
    if (!isHydrated) {
      return
    }
    const snapshot = structuredClone(store)
    const timer = setTimeout(() => {
      void saveEntityStore(snapshot).catch((error) => {
        console.error('Failed to save entity store to backend', error)
      })
    }, 250)
    return () => clearTimeout(timer)
  }, [isHydrated, store])

  const value = useMemo<EntityStoreContextValue>(
    () => ({
      store,
      getRecords: (storeKey: string) => store[storeKey] ?? [],
      getRecord: (storeKey: string, recordId: string) =>
        (store[storeKey] ?? []).find((record) => record.id === recordId),
      createRecord: (payload: CreateRecordInput) => {
        const current = store[payload.storeKey] ?? []
        const id = nextId(current, payload.idPrefix)
        const entity: EntityRecord = {
          id,
          title: payload.title,
          subtitle: payload.subtitle,
          status: payload.initialStatus,
          values: payload.values,
          history: [
            {
              id: historyId(),
              at: new Date().toLocaleString('ru-RU'),
              text: 'Объект создан',
            },
          ],
          related: [],
        }

        setStore((prev) => ({
          ...prev,
          [payload.storeKey]: [entity, ...(prev[payload.storeKey] ?? [])],
        }))
        return entity
      },
      updateRecord: (payload: UpdateRecordInput) => {
        setStore((prev) => ({
          ...prev,
          [payload.storeKey]: (prev[payload.storeKey] ?? []).map((entity) => {
            if (entity.id !== payload.recordId) {
              return entity
            }
            return {
              ...entity,
              title: payload.title,
              subtitle: payload.subtitle,
              values: payload.values,
              history: [
                {
                  id: historyId(),
                  at: new Date().toLocaleString('ru-RU'),
                  text: 'Карточка обновлена',
                },
                ...entity.history,
              ],
            }
          }),
        }))
      },
      updateStatus: (payload: UpdateStatusInput) => {
        setStore((prev) => ({
          ...prev,
          [payload.storeKey]: (prev[payload.storeKey] ?? []).map((entity) => {
            if (entity.id !== payload.recordId) {
              return entity
            }
            return {
              ...entity,
              status: payload.status,
              history: [
                {
                  id: historyId(),
                  at: new Date().toLocaleString('ru-RU'),
                  text: payload.note,
                },
                ...entity.history,
              ],
            }
          }),
        }))
      },
      getAllRecords: () =>
        Object.entries(store).flatMap(([storeKey, records]) =>
          records.map((record) => ({ storeKey, record })),
        ),
    }),
    [store],
  )

  return <EntityStoreContext.Provider value={value}>{children}</EntityStoreContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useEntityStore() {
  const ctx = useContext(EntityStoreContext)
  if (!ctx) {
    throw new Error('useEntityStore must be used within EntityStoreProvider')
  }
  return ctx
}
