import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'

import { Breadcrumbs, StatusBadge } from '../components'
import { ClientQuickCreateModal } from '../components/ClientQuickCreateModal'
import { useAuth } from '../auth/AuthContext'
import { useEntityStore } from '../domain/EntityStoreContext'
import {
  CARS_STORE_KEY as DEAL_CARS_STORE_KEY,
  DEALS_STORE_KEY,
  VIN_FIELD_KEY as DEAL_VIN_FIELD_KEY,
  enrichDealValuesWithCarInfo,
} from '../domain/dealCarInfo'
import {
  CUSTOM_SELECT_OPTION_VALUE,
  resolveEntityCreateField,
  resolveEntityFieldOptions,
} from '../domain/fieldOptions'
import {
  buildStoreKey,
  type EntityCreateField,
  type EntityRecord,
  type EntityTabDefinition,
  type SortDirection,
  type SubsystemDefinition,
} from '../domain/model'
import { getStatusDefinition } from '../domain/selectors'
import { getSubsystemBySlug } from '../domain/subsystems'
import { getActionDeniedReason } from '../domain/rbac'

const PAGE_SIZE = 8
const PREFERENCES_PREFIX = 'kis.listPrefs.'
const CARS_CATALOG_STORE_KEY = 'crm-sales/cars'
const VIN_FIELD_KEY = 'vin'

type ListPreferences = {
  query: string
  statusFilter: string
  sortKey: string
  sortDirection: SortDirection
  visibleColumns: string[]
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeVIN(value: string): string {
  return value.trim().toUpperCase()
}

function buildDealTitleFromVin(vin: string, cars: EntityRecord[]): string | null {
  const normalized = normalizeVIN(vin)
  if (!normalized) {
    return null
  }
  const car = cars.find((item) => normalizeVIN(item.values[VIN_FIELD_KEY] ?? '') === normalized)
  if (!car) {
    return null
  }
  const title = (car.title ?? '').trim()
  const year = (car.values.year ?? '').trim()
  const yearPart = year ? ` (${year})` : ''
  const left = title ? `${title}${yearPart}` : year
  return left ? `${left} — ${normalized}` : normalized
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function readPreferences(storageKey: string, defaults: ListPreferences): ListPreferences {
  if (typeof window === 'undefined') {
    return defaults
  }
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) {
      return defaults
    }
    const parsed = JSON.parse(raw) as Partial<ListPreferences>
    return {
      query: typeof parsed.query === 'string' ? parsed.query : defaults.query,
      statusFilter:
        typeof parsed.statusFilter === 'string' ? parsed.statusFilter : defaults.statusFilter,
      sortKey: typeof parsed.sortKey === 'string' ? parsed.sortKey : defaults.sortKey,
      sortDirection:
        parsed.sortDirection === 'desc' || parsed.sortDirection === 'asc'
          ? parsed.sortDirection
          : defaults.sortDirection,
      visibleColumns: Array.isArray(parsed.visibleColumns)
        ? parsed.visibleColumns.filter((item): item is string => typeof item === 'string')
        : defaults.visibleColumns,
    }
  } catch {
    return defaults
  }
}

function writePreferences(storageKey: string, prefs: ListPreferences) {
  if (typeof window === 'undefined') {
    return
  }
  localStorage.setItem(storageKey, JSON.stringify(prefs))
}

type EntityListPageContentProps = {
  subsystem: SubsystemDefinition
  tab: EntityTabDefinition
}

function EntityListPageContent({ subsystem, tab }: EntityListPageContentProps) {
  const navigate = useNavigate()
  const { can, role } = useAuth()
  const { getRecords, createRecord } = useEntityStore()
  const storeKey = buildStoreKey(subsystem.slug, tab.slug)
  const records = getRecords(storeKey)
  const storageKey = `${PREFERENCES_PREFIX}${storeKey}`
  const searchInputRef = useRef<HTMLInputElement>(null)
  const jumpInputRef = useRef<HTMLInputElement>(null)
  const emptyFormValues = useMemo<Record<string, string>>(
    () => Object.fromEntries(tab.createFields.map((field) => [field.key, ''])),
    [tab.createFields],
  )

  const defaultSortKey = tab.columns[0]?.key ?? 'title'
  const defaultVisibleColumns = tab.columns.map((column) => column.key)

  const defaultPreferences = useMemo<ListPreferences>(
    () => ({
      query: '',
      statusFilter: 'all',
      sortKey: defaultSortKey,
      sortDirection: 'asc',
      visibleColumns: defaultVisibleColumns,
    }),
    [defaultSortKey, defaultVisibleColumns],
  )

  const initialPreferences = useMemo(
    () => readPreferences(storageKey, defaultPreferences),
    [defaultPreferences, storageKey],
  )

  const [query, setQuery] = useState(initialPreferences.query)
  const [statusFilter, setStatusFilter] = useState(initialPreferences.statusFilter)
  const [sortKey, setSortKey] = useState(initialPreferences.sortKey)
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialPreferences.sortDirection)
  const [page, setPage] = useState(1)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isClientCreateOpen, setIsClientCreateOpen] = useState(false)
  const [clientCreateVersion, setClientCreateVersion] = useState(0)
  const [createError, setCreateError] = useState('')
  const [formValues, setFormValues] = useState<Record<string, string>>(emptyFormValues)
  const [createCustomMode, setCreateCustomMode] = useState<Record<string, boolean>>({})
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    initialPreferences.visibleColumns.filter((columnKey) =>
      tab.columns.some((column) => column.key === columnKey),
    ),
  )
  const [quickJumpId, setQuickJumpId] = useState('')
  const [jumpError, setJumpError] = useState('')
  const [lastPresetSavedAt, setLastPresetSavedAt] = useState('')

  const openCreateModal = useCallback(() => {
    setFormValues(emptyFormValues)
    setCreateCustomMode({})
    setCreateError('')
    setIsCreateOpen(true)
  }, [emptyFormValues, setCreateCustomMode, setCreateError, setFormValues, setIsCreateOpen])

  const closeCreateModal = useCallback(() => {
    setIsCreateOpen(false)
    setIsClientCreateOpen(false)
  }, [setIsClientCreateOpen, setIsCreateOpen])

  const openClientCreateModal = useCallback(() => {
    setClientCreateVersion((prev) => prev + 1)
    setIsClientCreateOpen(true)
  }, [setClientCreateVersion, setIsClientCreateOpen])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return
      }

      if (event.key === '/') {
        event.preventDefault()
        searchInputRef.current?.focus()
      }

      if (event.key.toLowerCase() === 'g') {
        event.preventDefault()
        jumpInputRef.current?.focus()
      }

      if (event.key.toLowerCase() === 'n' && can('create')) {
        event.preventDefault()
        openCreateModal()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [can, openCreateModal])

  useEffect(() => {
    writePreferences(storageKey, {
      query,
      statusFilter,
      sortKey,
      sortDirection,
      visibleColumns,
    })
  }, [query, statusFilter, sortKey, sortDirection, visibleColumns, storageKey])

  const normalizedQuery = normalize(query)
  const filtered = records
    .filter((record) => {
      if (statusFilter !== 'all' && record.status !== statusFilter) {
        return false
      }
      if (!normalizedQuery) {
        return true
      }
      const text = [record.id, record.title, record.subtitle, ...Object.values(record.values)]
        .join(' ')
        .toLowerCase()
      return text.includes(normalizedQuery)
    })
    .sort((left, right) => {
      const leftValue = sortKey === 'title' ? left.title : left.values[sortKey] ?? ''
      const rightValue = sortKey === 'title' ? right.title : right.values[sortKey] ?? ''
      const compared = leftValue.localeCompare(rightValue, 'ru')
      return sortDirection === 'asc' ? compared : -compared
    })

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const selectedColumns =
    visibleColumns.length === 0
      ? tab.columns
      : tab.columns.filter((column) => visibleColumns.includes(column.key))
  const createDeniedReason = can('create') ? '' : getActionDeniedReason(role, 'create')

  const resetPreferences = () => {
    setQuery('')
    setStatusFilter('all')
    setSortKey(defaultSortKey)
    setSortDirection('asc')
    setVisibleColumns(defaultVisibleColumns)
    setPage(1)
    setJumpError('')
    setLastPresetSavedAt('')
  }

  const savePreset = () => {
    writePreferences(storageKey, {
      query,
      statusFilter,
      sortKey,
      sortDirection,
      visibleColumns,
    })
    setLastPresetSavedAt(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))
  }

  const toggleColumn = (columnKey: string) => {
    setVisibleColumns((prev) => {
      if (prev.includes(columnKey)) {
        if (prev.length === 1) {
          return prev
        }
        return prev.filter((key) => key !== columnKey)
      }
      return [...prev, columnKey]
    })
  }

  const applyCreateFieldValue = (fieldKey: string, nextValue: string) => {
    setFormValues((prev) => {
      const next = { ...prev, [fieldKey]: nextValue }
      if (storeKey === DEALS_STORE_KEY && fieldKey === DEAL_VIN_FIELD_KEY) {
        return enrichDealValuesWithCarInfo(next, getRecords(DEAL_CARS_STORE_KEY))
      }
      return next
    })
  }

  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const requiredField = tab.createFields.find(
      (field) => field.required && !formValues[field.key]?.trim(),
    )

    if (requiredField) {
      setCreateError(`Поле "${requiredField.label}" обязательно`)
      return
    }

    const title = formValues.title?.trim() || `Новый ${tab.entityName}`
    const subtitleField = tab.createFields.find((field) => field.key !== 'title')
    const subtitleValue = subtitleField ? formValues[subtitleField.key] : ''
    const subtitle = subtitleValue?.trim() || `Карточка ${tab.entityName}`
    let values = Object.fromEntries(
      Object.entries(formValues).filter(([key]) => key !== 'title' && key !== 'subtitle'),
    )

    if (storeKey === CARS_CATALOG_STORE_KEY) {
      const normalizedVIN = normalizeVIN(values[VIN_FIELD_KEY] ?? '')
      if (!normalizedVIN) {
        setCreateError('VIN обязателен для каталога автомобилей')
        return
      }
      const duplicate = records.find(
        (entity) => normalizeVIN(entity.values[VIN_FIELD_KEY] ?? '') === normalizedVIN,
      )
      if (duplicate) {
        setCreateError(`Автомобиль с VIN "${normalizedVIN}" уже существует (${duplicate.id})`)
        return
      }
      values[VIN_FIELD_KEY] = normalizedVIN
    }

    if (storeKey === DEALS_STORE_KEY) {
      values = enrichDealValuesWithCarInfo(values, getRecords(DEAL_CARS_STORE_KEY))
    }

    const created = createRecord({
      storeKey,
      idPrefix: tab.idPrefix,
      initialStatus: tab.statuses[0].key,
      title,
      subtitle,
      values,
    })

    setCreateError('')
    closeCreateModal()
    navigate(`/${subsystem.slug}/${tab.slug}/${created.id}`)
  }

  const submitQuickJump = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const target = records.find(
      (record) => record.id.toLowerCase() === quickJumpId.trim().toLowerCase(),
    )

    if (!target) {
      setJumpError(`Карточка с ID "${quickJumpId.trim()}" не найдена.`)
      return
    }

    setJumpError('')
    navigate(`/${subsystem.slug}/${tab.slug}/${target.id}`)
  }

  const renderCreateField = (field: EntityCreateField) => {
    const resolvedField = resolveEntityCreateField(storeKey, field)
    const value = formValues[field.key] ?? ''
    const isDealClientField = storeKey === DEALS_STORE_KEY && field.key === 'client'

    if (resolvedField.inputType !== 'select') {
      return (
        <label key={field.key} className="field">
          <span>
            {field.label}
            {field.required ? ' *' : ''}
          </span>
          <input
            value={value}
            onChange={(event) => applyCreateFieldValue(field.key, event.target.value)}
            placeholder={field.placeholder}
          />
        </label>
      )
    }

    const options = resolveEntityFieldOptions({
      storeKey,
      field: resolvedField,
      getRecords,
      currentValue: value,
    })
    const hasMatchingOption = options.some((item) => item.value === value)
    const allowInlineCustom = !isDealClientField
    const isCustom =
      resolvedField.allowCustom &&
      allowInlineCustom &&
      (createCustomMode[field.key] || (value.trim() !== '' && !hasMatchingOption))
    const selectValue = isCustom ? CUSTOM_SELECT_OPTION_VALUE : value

    const handleSelectChange = (nextValue: string) => {
      if (isDealClientField && nextValue === CUSTOM_SELECT_OPTION_VALUE) {
        openClientCreateModal()
        return
      }

      if (nextValue === CUSTOM_SELECT_OPTION_VALUE) {
        setCreateCustomMode((prev) => ({ ...prev, [field.key]: true }))
        setFormValues((prev) => {
          const previous = prev[field.key] ?? ''
          const previousIsKnown = options.some((item) => item.value === previous)
          const next = { ...prev, [field.key]: previousIsKnown ? '' : previous }
          if (storeKey === DEALS_STORE_KEY && field.key === DEAL_VIN_FIELD_KEY) {
            return enrichDealValuesWithCarInfo(next, getRecords(DEAL_CARS_STORE_KEY))
          }
          return next
        })
        return
      }

      setCreateCustomMode((prev) => ({ ...prev, [field.key]: false }))
      if (storeKey === DEALS_STORE_KEY && field.key === DEAL_VIN_FIELD_KEY) {
        setFormValues((prev) => {
          let next = { ...prev, [field.key]: nextValue }
          next = enrichDealValuesWithCarInfo(next, getRecords(DEAL_CARS_STORE_KEY))
          const autoTitle = buildDealTitleFromVin(nextValue, getRecords(DEAL_CARS_STORE_KEY))
          if (autoTitle) {
            next.title = autoTitle
          }
          return next
        })
        return
      }
      applyCreateFieldValue(field.key, nextValue)
    }

    return (
      <label key={field.key} className="field">
        <span>
          {field.label}
          {field.required ? ' *' : ''}
        </span>
        <select value={selectValue} onChange={(event) => handleSelectChange(event.target.value)}>
          <option value="">{resolvedField.emptyOptionLabel}</option>
          {options.map((option) => (
            <option key={`${field.key}-${option.value}`} value={option.value}>
              {option.label}
            </option>
          ))}
          {resolvedField.allowCustom ? (
            <option value={CUSTOM_SELECT_OPTION_VALUE}>Свой вариант...</option>
          ) : null}
        </select>
        {isCustom ? (
          <input
            value={value}
            onChange={(event) => {
              setCreateCustomMode((prev) => ({ ...prev, [field.key]: true }))
              applyCreateFieldValue(field.key, event.target.value)
            }}
            placeholder={field.placeholder}
          />
        ) : null}
      </label>
    )
  }

  const renderEmptyState = (title: string, description: string, showCreateButton = false) => (
    <article className="empty-state">
      <h4>{title}</h4>
      <p>{description}</p>
      <div className="empty-state__actions">
        {showCreateButton && can('create') ? (
          <button className="btn-primary btn-primary--sm" onClick={openCreateModal}>
            {tab.actions.find((action) => action.key === 'create')?.label ?? 'Создать'}
          </button>
        ) : null}
        <button className="btn-secondary" onClick={resetPreferences}>
          Сбросить фильтры
        </button>
      </div>
    </article>
  )

  const renderTable = () => (
    <div className="table-wrap">
      <table className="entity-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Название</th>
            {selectedColumns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>
          {pageItems.map((record) => {
            const status = getStatusDefinition(tab, record.status) ?? tab.statuses[0]
            return (
              <tr key={record.id}>
                <td>{record.id}</td>
                <td>
                  <Link to={`/${subsystem.slug}/${tab.slug}/${record.id}`} className="table-link">
                    {record.title}
                  </Link>
                  <p className="table-link__subtitle">{record.subtitle}</p>
                </td>
                {selectedColumns.map((column) => (
                  <td key={`${record.id}-${column.key}`}>{record.values[column.key] ?? '-'}</td>
                ))}
                <td>
                  <StatusBadge label={status.label} tone={status.tone} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )

  const renderKanban = () => (
    <div className="kanban-board">
      {tab.statuses.map((status) => (
        <article key={status.key} className="kanban-column">
          <header>
            <h3>{status.label}</h3>
            <span>{filtered.filter((record) => record.status === status.key).length}</span>
          </header>
          <div className="kanban-cards">
            {filtered
              .filter((record) => record.status === status.key)
              .map((record) => (
                <Link
                  key={record.id}
                  to={`/${subsystem.slug}/${tab.slug}/${record.id}`}
                  className="kanban-card"
                >
                  <strong>{record.id}</strong>
                  <p>{record.title}</p>
                  <small>{record.subtitle}</small>
                </Link>
              ))}
          </div>
        </article>
      ))}
    </div>
  )

  const renderTimeline = () => (
    <div className="timeline-list">
      {filtered.map((record) => {
        const currentStatusIndex = tab.statuses.findIndex((status) => status.key === record.status)
        const currentStatus = getStatusDefinition(tab, record.status) ?? tab.statuses[0]
        return (
          <article key={record.id} className="timeline-card">
            <div className="timeline-card__head">
              <Link to={`/${subsystem.slug}/${tab.slug}/${record.id}`} className="table-link">
                {record.id}
              </Link>
              <StatusBadge label={currentStatus.label} tone={currentStatus.tone} />
            </div>
            <p className="timeline-card__title">{record.title}</p>
            <ol className="timeline-steps">
              {tab.statuses.map((status, index) => (
                <li
                  key={`${record.id}-${status.key}`}
                  className={index < currentStatusIndex ? 'done' : index === currentStatusIndex ? 'current' : ''}
                >
                  {status.label}
                </li>
              ))}
            </ol>
          </article>
        )
      })}
    </div>
  )

  return (
    <>
      <header className="page-head">
        <div>
          <Breadcrumbs
            items={[
              { label: subsystem.title, to: `/${subsystem.slug}` },
              { label: tab.title },
            ]}
          />
          <h3>{tab.entityNamePlural}</h3>
          <p>Сценарий экрана: список сущностей с фильтрацией, поиском и быстрыми действиями.</p>
        </div>
        <div className="context-actions">
        {can('create') ? (
          <button className="btn-primary btn-primary--sm" onClick={openCreateModal}>
            {tab.actions.find((action) => action.key === 'create')?.label ?? 'Создать'}
          </button>
        ) : (
            <button className="btn-disabled" title={createDeniedReason} disabled>
              Создание недоступно
            </button>
          )}
        </div>
      </header>

      <section className="quick-actions-panel">
        <form className="quick-jump" onSubmit={submitQuickJump}>
          <label className="field field--compact">
            <span>Быстрый переход по ID</span>
            <input
              ref={jumpInputRef}
              value={quickJumpId}
              onChange={(event) => setQuickJumpId(event.target.value)}
              placeholder={`${tab.idPrefix}-0001`}
            />
          </label>
          <button type="submit" className="btn-secondary">
            Открыть карточку
          </button>
        </form>

        <div className="quick-panel__actions">
          <button className="btn-secondary" onClick={savePreset}>
            Сохранить пресет
          </button>
          <button className="btn-secondary" onClick={resetPreferences}>
            Сбросить пресет
          </button>
          <details className="column-picker">
            <summary>Колонки</summary>
            <div className="column-picker__body">
              {tab.columns.map((column) => (
                <label key={column.key}>
                  <input
                    type="checkbox"
                    checked={visibleColumns.includes(column.key)}
                    onChange={() => toggleColumn(column.key)}
                  />
                  <span>{column.label}</span>
                </label>
              ))}
            </div>
          </details>
        </div>
      </section>

      <p className="hint-row">Hotkeys: / поиск, N создать, G быстрый переход.</p>
      {lastPresetSavedAt ? <p className="hint-row">Пресет сохранен в {lastPresetSavedAt}.</p> : null}
      {jumpError ? <p className="form-error form-error--inline">{jumpError}</p> : null}

      <section className="list-controls">
        <label className="field">
          <span>Поиск</span>
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
            }}
            placeholder={`Поиск по ${tab.entityNamePlural.toLowerCase()}`}
          />
        </label>
        <label className="field">
          <span>Статус</span>
          <select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value)
              setPage(1)
            }}
          >
            <option value="all">Все статусы</option>
            {tab.statuses.map((status) => (
              <option key={status.key} value={status.key}>
                {status.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Сортировка</span>
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value)}>
            <option value="title">Название</option>
            {tab.columns.map((column) => (
              <option key={column.key} value={column.key}>
                {column.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn-secondary"
          onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
        >
          {sortDirection === 'asc' ? 'Сортировка: по возрастанию' : 'Сортировка: по убыванию'}
        </button>
      </section>

      {records.length === 0
        ? renderEmptyState(
            `Нет ни одной сущности типа "${tab.entityName}"`,
            'Начните с создания первой карточки. Все действия будут доступны из списка и карточки.',
            true,
          )
        : null}

      {records.length > 0 && filtered.length === 0
        ? renderEmptyState(
            'Ничего не найдено',
            'По текущим фильтрам и запросу нет результатов. Сбросьте пресет или измените условия поиска.',
          )
        : null}

      {records.length > 0 && filtered.length > 0
        ? tab.view === 'kanban'
          ? renderKanban()
          : tab.view === 'timeline'
            ? renderTimeline()
            : renderTable()
        : null}

      {tab.view === 'table' && filtered.length > 0 ? (
        <footer className="pagination">
          <p>
            Показано {pageItems.length} из {filtered.length}
          </p>
          <div className="pagination__actions">
            <button
              className="btn-secondary"
              onClick={() =>
                setPage((prev) => {
                  const clamped = Math.min(pageCount, prev)
                  return Math.max(1, clamped - 1)
                })
              }
              disabled={currentPage === 1}
            >
              Назад
            </button>
            <span>
              Страница {currentPage} / {pageCount}
            </span>
            <button
              className="btn-secondary"
              onClick={() =>
                setPage((prev) => {
                  const clamped = Math.min(pageCount, prev)
                  return Math.min(pageCount, clamped + 1)
                })
              }
              disabled={currentPage === pageCount}
            >
              Вперед
            </button>
          </div>
        </footer>
      ) : null}

      {isCreateOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal">
            <header className="modal__head">
              <h4>{tab.actions.find((action) => action.key === 'create')?.label ?? 'Создать'}</h4>
              <button className="btn-ghost" onClick={closeCreateModal}>
                Закрыть
              </button>
            </header>

            <form className="modal__body modal__body--grid" onSubmit={submitCreate}>
              {tab.createFields.map((field) => renderCreateField(field))}
              {createError ? <p className="form-error">{createError}</p> : null}
              <div className="modal__actions modal__actions--full">
                <button type="button" className="btn-secondary" onClick={closeCreateModal}>
                  Отмена
                </button>
                <button type="submit" className="btn-primary btn-primary--sm">
                  Создать
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <ClientQuickCreateModal
        key={clientCreateVersion}
        isOpen={isClientCreateOpen}
        onCancel={() => setIsClientCreateOpen(false)}
        onCreated={(client) => {
          setFormValues((prev) => ({ ...prev, client: client.title }))
          setCreateCustomMode((prev) => ({ ...prev, client: false }))
          setIsClientCreateOpen(false)
        }}
      />
    </>
  )
}

export function EntityListPage() {
  const { subsystemSlug, tabSlug } = useParams()
  const subsystem = subsystemSlug ? getSubsystemBySlug(subsystemSlug) : undefined
  const tab = subsystem?.tabs.find((entityTab) => entityTab.slug === tabSlug)

  if (!subsystem || !tab) {
    return <Navigate to="/crm-sales" replace />
  }

  return <EntityListPageContent key={`${subsystem.slug}/${tab.slug}`} subsystem={subsystem} tab={tab} />
}
