import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { synchronizeCarStatuses } from './carStatusSync'
import { loadEntityStore, saveEntityStore } from './entityStoreApi'
import { migrateEntityStore } from './entityStoreMigrations'
import type { EntityRecord, EntityRelatedRecord } from './model'
import { seedData } from './seedData'

type CreateRecordInput = {
  storeKey: string
  idPrefix: string
  initialStatus: string
  title: string
  subtitle: string
  values: Record<string, string>
  createdHistoryText?: string
}

type UpdateRecordInput = {
  storeKey: string
  recordId: string
  title: string
  subtitle: string
  values: Record<string, string>
  status?: string
  note?: string
}

type UpdateStatusInput = {
  storeKey: string
  recordId: string
  status: string
  note: string
}

type DeleteRecordInput = {
  storeKey: string
  recordId: string
}

type LinkRecordsInput = {
  left: {
    storeKey: string
    recordId: string
    label: string
    value: string
  }
  right: {
    storeKey: string
    recordId: string
    label: string
    value: string
  }
}

type EntityStoreContextValue = {
  store: Record<string, EntityRecord[]>
  getRecords: (storeKey: string) => EntityRecord[]
  getRecord: (storeKey: string, recordId: string) => EntityRecord | undefined
  createRecord: (payload: CreateRecordInput) => EntityRecord
  updateRecord: (payload: UpdateRecordInput) => void
  updateStatus: (payload: UpdateStatusInput) => void
  deleteRecord: (payload: DeleteRecordInput) => void
  linkRecords: (payload: LinkRecordsInput) => void
  flushStore: (options?: { keepalive?: boolean }) => Promise<void>
  getAllRecords: () => Array<{ storeKey: string; record: EntityRecord }>
}

const EntityStoreContext = createContext<EntityStoreContextValue | undefined>(undefined)
const AUTO_CAR_STATUS_SYNC_NOTE = 'Статус автомобиля синхронизирован автоматически по связанным сделкам и заказ-нарядам'

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

function prependHistory(entity: EntityRecord, text: string): EntityRecord {
  return {
    ...entity,
    history: [
      {
        id: historyId(),
        at: new Date().toLocaleString('ru-RU'),
        text,
      },
      ...entity.history,
    ],
  }
}

function buildRelatedItem(
  ownRecordId: string,
  label: string,
  value: string,
  storeKey: string,
  recordId: string,
): EntityRelatedRecord {
  return {
    id: `rel-${ownRecordId}-${storeKey}-${recordId}`,
    label,
    value,
    storeKey,
    recordId,
  }
}

function hasRelatedRecord(entity: EntityRecord, storeKey: string, recordId: string): boolean {
  return entity.related.some((item) => item.storeKey === storeKey && item.recordId === recordId)
}

function removeRelatedRecord(
  entity: EntityRecord,
  storeKey: string,
  recordId: string,
): { entity: EntityRecord; removed: boolean } {
  const nextRelated = entity.related.filter(
    (item) => !(item.storeKey === storeKey && item.recordId === recordId),
  )

  if (nextRelated.length === entity.related.length) {
    return { entity, removed: false }
  }

  return {
    entity: {
      ...entity,
      related: nextRelated,
    },
    removed: true,
  }
}

function mergeHydratedStore(
  persistedStore: Record<string, EntityRecord[]>,
  localStore: Record<string, EntityRecord[]>,
  deletedBeforeHydration: Map<string, Set<string>>,
): Record<string, EntityRecord[]> {
  const storeKeys = new Set([...Object.keys(persistedStore), ...Object.keys(localStore)])
  const next: Record<string, EntityRecord[]> = {}

  for (const storeKey of storeKeys) {
    const localRecords = localStore[storeKey] ?? []
    const localIds = new Set(localRecords.map((record) => record.id))
    const deletedIds = deletedBeforeHydration.get(storeKey)
    const persistedRecords = (persistedStore[storeKey] ?? []).filter(
      (record) => !localIds.has(record.id) && !deletedIds?.has(record.id),
    )
    next[storeKey] = [...localRecords, ...persistedRecords]
  }

  return next
}

export function EntityStoreProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<Record<string, EntityRecord[]>>(() =>
    synchronizeCarStatuses(cloneSeed()),
  )
  const [isHydrated, setIsHydrated] = useState(false)
  const latestStoreRef = useRef(store)
  const hadPreHydrationMutationsRef = useRef(false)
  const deletedBeforeHydrationRef = useRef<Map<string, Set<string>>>(new Map())
  const latestStoreVersionRef = useRef(0)
  const persistedStoreVersionRef = useRef(0)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    latestStoreRef.current = store
  }, [store])

  const commitStore = (nextStore: Record<string, EntityRecord[]>) => {
    latestStoreRef.current = nextStore
    latestStoreVersionRef.current += 1
    setStore(nextStore)
    return nextStore
  }

  const applyStoreMutation = (
    updater: (currentStore: Record<string, EntityRecord[]>) => Record<string, EntityRecord[]>,
    deletedTarget?: DeleteRecordInput,
  ) => {
    if (!isHydrated) {
      hadPreHydrationMutationsRef.current = true
      if (deletedTarget) {
        const deletedSet =
          deletedBeforeHydrationRef.current.get(deletedTarget.storeKey) ?? new Set<string>()
        deletedSet.add(deletedTarget.recordId)
        deletedBeforeHydrationRef.current.set(deletedTarget.storeKey, deletedSet)
      }
    }
    return commitStore(
      synchronizeCarStatuses(updater(latestStoreRef.current), {
        onStatusChange: (record, nextStatus) =>
          prependHistory(
            {
              ...record,
              status: nextStatus,
            },
            AUTO_CAR_STATUS_SYNC_NOTE,
          ),
      }),
    )
  }

  const persistSnapshot = async (
    snapshot: Record<string, EntityRecord[]>,
    version: number,
    options: { keepalive?: boolean } = {},
  ) => {
    await saveEntityStore(snapshot, options)
    if (persistedStoreVersionRef.current < version) {
      persistedStoreVersionRef.current = version
    }
  }

  const flushStore = async (options: { keepalive?: boolean } = {}) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (persistedStoreVersionRef.current >= latestStoreVersionRef.current) {
      return
    }
    const version = latestStoreVersionRef.current
    const snapshot = structuredClone(latestStoreRef.current)
    await persistSnapshot(snapshot, version, options)
  }

  useEffect(() => {
    let isCancelled = false
    const controller = new AbortController()

    const hydrate = async () => {
      try {
        const rawStore = await loadEntityStore(controller.signal)
        const isEmpty = !rawStore['crm-sales/clients'] || rawStore['crm-sales/clients'].length === 0
        const storeToMigrate = isEmpty ? cloneSeed() : rawStore
        const persistedStore = migrateEntityStore(storeToMigrate)
        
        if (isCancelled) {
          return
        }
        if (hadPreHydrationMutationsRef.current) {
          commitStore(
            synchronizeCarStatuses(
              mergeHydratedStore(
                persistedStore,
                latestStoreRef.current,
                deletedBeforeHydrationRef.current,
              ),
            ),
          )
        } else if (Object.keys(persistedStore).length > 0) {
          commitStore(synchronizeCarStatuses(persistedStore))
        }
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          console.error('Failed to load entity store from backend', error)
        }
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
    const version = latestStoreVersionRef.current
    const snapshot = structuredClone(store)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      void persistSnapshot(snapshot, version).catch((error) => {
        console.error('Failed to save entity store to backend', error)
      })
    }, 250)
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [isHydrated, store])

  useEffect(() => {
    if (!isHydrated) {
      return
    }

    const flushPendingStore = () => {
      void flushStore({ keepalive: true }).catch((error) => {
        console.error('Failed to flush entity store to backend', error)
      })
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushPendingStore()
      }
    }

    window.addEventListener('pagehide', flushPendingStore)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('pagehide', flushPendingStore)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [isHydrated])

  const value = useMemo<EntityStoreContextValue>(
    () => ({
      store,
      getRecords: (storeKey: string) => store[storeKey] ?? [],
      getRecord: (storeKey: string, recordId: string) =>
        (store[storeKey] ?? []).find((record) => record.id === recordId),
      createRecord: (payload: CreateRecordInput) => {
        let createdEntity: EntityRecord | null = null

        applyStoreMutation((currentStore) => {
          const current = currentStore[payload.storeKey] ?? []
          createdEntity = {
            id: nextId(current, payload.idPrefix),
            title: payload.title,
            subtitle: payload.subtitle,
            status: payload.initialStatus,
            values: payload.values,
            history: [
              {
                id: historyId(),
                at: new Date().toLocaleString('ru-RU'),
                text: payload.createdHistoryText ?? 'Объект создан',
              },
            ],
            related: [],
          }

          return {
            ...currentStore,
            [payload.storeKey]: [createdEntity, ...current],
          }
        })

        if (!createdEntity) {
          throw new Error('createRecord failed to create entity')
        }
        return createdEntity
      },
      updateRecord: (payload: UpdateRecordInput) => {
        applyStoreMutation((currentStore) => ({
          ...currentStore,
          [payload.storeKey]: (currentStore[payload.storeKey] ?? []).map((entity) => {
            if (entity.id !== payload.recordId) {
              return entity
            }
            return prependHistory(
              {
                ...entity,
                title: payload.title,
                subtitle: payload.subtitle,
                status: payload.status ?? entity.status,
                values: payload.values,
              },
              payload.note ?? 'Карточка обновлена',
            )
          }),
        }))
      },
      updateStatus: (payload: UpdateStatusInput) => {
        applyStoreMutation((currentStore) => ({
          ...currentStore,
          [payload.storeKey]: (currentStore[payload.storeKey] ?? []).map((entity) => {
            if (entity.id !== payload.recordId) {
              return entity
            }
            return prependHistory(
              {
                ...entity,
                status: payload.status,
              },
              payload.note,
            )
          }),
        }))
      },
      deleteRecord: (payload: DeleteRecordInput) => {
        applyStoreMutation((currentStore) => {
          const target = (currentStore[payload.storeKey] ?? []).find(
            (entity) => entity.id === payload.recordId,
          )
          if (!target) {
            return currentStore
          }

          const targetLabel = target.title.trim() ? `${target.id} ${target.title}` : target.id
          const next: Record<string, EntityRecord[]> = {}

          for (const [storeKey, records] of Object.entries(currentStore)) {
            const keptRecords = records.filter(
              (entity) => !(storeKey === payload.storeKey && entity.id === payload.recordId),
            )

            next[storeKey] = keptRecords.map((entity) => {
              const { entity: cleanedEntity, removed } = removeRelatedRecord(
                entity,
                payload.storeKey,
                payload.recordId,
              )
              if (!removed) {
                return entity
              }
              return prependHistory(cleanedEntity, `Удалена связь с ${targetLabel}`)
            })
          }

          return next
        }, payload)
      },
      linkRecords: (payload: LinkRecordsInput) => {
        applyStoreMutation((currentStore) => {
          const next = { ...currentStore }

          const applyLink = (
            sourceStoreKey: string,
            sourceRecordId: string,
            label: string,
            value: string,
            targetStoreKey: string,
            targetRecordId: string,
          ) => {
            next[sourceStoreKey] = (next[sourceStoreKey] ?? []).map((entity) => {
              if (
                entity.id !== sourceRecordId ||
                hasRelatedRecord(entity, targetStoreKey, targetRecordId)
              ) {
                return entity
              }

              return prependHistory(
                {
                  ...entity,
                  related: [
                    buildRelatedItem(entity.id, label, value, targetStoreKey, targetRecordId),
                    ...entity.related,
                  ],
                },
                `Добавлена связь: ${value}`,
              )
            })
          }

          applyLink(
            payload.left.storeKey,
            payload.left.recordId,
            payload.left.label,
            payload.left.value,
            payload.right.storeKey,
            payload.right.recordId,
          )
          applyLink(
            payload.right.storeKey,
            payload.right.recordId,
            payload.right.label,
            payload.right.value,
            payload.left.storeKey,
            payload.left.recordId,
          )

          return next
        })
      },
      flushStore,
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
