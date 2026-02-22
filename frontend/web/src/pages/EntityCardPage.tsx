import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { Breadcrumbs, StatusBadge } from '../components'
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
  type ActionKey,
  type EntityCreateField,
  type EntityRecord,
  type EntityTabDefinition,
  type SubsystemDefinition,
} from '../domain/model'
import { getStatusDefinition, isClosedStatus } from '../domain/selectors'
import { getSubsystemBySlug } from '../domain/subsystems'
import { getActionDeniedReason } from '../domain/rbac'

const CARS_CATALOG_STORE_KEY = 'crm-sales/cars'
const VIN_FIELD_KEY = 'vin'

function normalizeVIN(value: string): string {
  return value.trim().toUpperCase()
}

type CardPanel = 'details' | 'history' | 'related'

type ActionState = {
  key: ActionKey
  label: string
  critical?: boolean
  disabled: boolean
  reason: string
}

type EntityCardViewProps = {
  subsystem: SubsystemDefinition
  tab: EntityTabDefinition
  storeKey: string
  record: EntityRecord
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function EntityCardView({ subsystem, tab, storeKey, record }: EntityCardViewProps) {
  const { can, role } = useAuth()
  const { updateRecord, updateStatus, getRecords } = useEntityStore()
  const currentStatus = getStatusDefinition(tab, record.status) ?? tab.statuses[0]
  const readOnly = isClosedStatus(tab, record.status)

  const [activePanel, setActivePanel] = useState<CardPanel>('details')
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [editError, setEditError] = useState('')
  const [editTitle, setEditTitle] = useState(record.title)
  const [editSubtitle, setEditSubtitle] = useState(record.subtitle)
  const [editValues, setEditValues] = useState<Record<string, string>>(record.values)
  const [editCustomMode, setEditCustomMode] = useState<Record<string, boolean>>({})

  const actionStates: ActionState[] = tab.actions
    .filter((action) => action.key !== 'create')
    .map((action) => {
      let reason = ''

      if (readOnly && action.key !== 'reopen') {
        reason = 'Объект закрыт: действие доступно только в режиме просмотра.'
      } else if (!can(action.key)) {
        reason = getActionDeniedReason(role, action.key)
      }

      return {
        key: action.key,
        label: action.label,
        critical: action.critical,
        disabled: Boolean(reason),
        reason,
      }
    })

  const disabledActions = actionStates.filter((action) => action.disabled)
  const editActionEnabled = actionStates.some((action) => action.key === 'edit' && !action.disabled)
  const reopenAction = actionStates.find((action) => action.key === 'reopen')

  const openEditModal = () => {
    setEditTitle(record.title)
    setEditSubtitle(record.subtitle)
    setEditValues(
      storeKey === DEALS_STORE_KEY
        ? enrichDealValuesWithCarInfo(record.values, getRecords(DEAL_CARS_STORE_KEY))
        : record.values,
    )
    setEditCustomMode({})
    setEditError('')
    setIsEditOpen(true)
  }

  const applyEditFieldValue = (fieldKey: string, nextValue: string) => {
    setEditValues((prev) => {
      const next = { ...prev, [fieldKey]: nextValue }
      if (storeKey === DEALS_STORE_KEY && fieldKey === DEAL_VIN_FIELD_KEY) {
        return enrichDealValuesWithCarInfo(next, getRecords(DEAL_CARS_STORE_KEY))
      }
      return next
    })
  }

  const runAction = (actionKey: ActionKey, label: string, critical?: boolean) => {
    const actionState = actionStates.find((action) => action.key === actionKey)
    if (!actionState || actionState.disabled) {
      return
    }

    if (actionKey === 'edit') {
      openEditModal()
      return
    }

    if (critical) {
      const confirmed = window.confirm(`Подтвердить действие: "${label}"?`)
      if (!confirmed) {
        return
      }
    }

    const nextStatus = tab.actionStatusMap?.[actionKey]
    if (!nextStatus) {
      return
    }

    updateStatus({
      storeKey,
      recordId: record.id,
      status: nextStatus,
      note: `Выполнено действие "${label}"`,
    })
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isEditOpen) {
        setIsEditOpen(false)
        return
      }

      if (isEditableTarget(event.target)) {
        return
      }

      if (event.key.toLowerCase() === 'e' && editActionEnabled) {
        event.preventDefault()
        setEditTitle(record.title)
        setEditSubtitle(record.subtitle)
        setEditValues(
          storeKey === DEALS_STORE_KEY
            ? enrichDealValuesWithCarInfo(record.values, getRecords(DEAL_CARS_STORE_KEY))
            : record.values,
        )
        setEditCustomMode({})
        setEditError('')
        setIsEditOpen(true)
      }

      if (event.key.toLowerCase() === 'r' && reopenAction && !reopenAction.disabled) {
        event.preventDefault()
        const nextStatus = tab.actionStatusMap?.reopen
        if (!nextStatus) {
          return
        }
        updateStatus({
          storeKey,
          recordId: record.id,
          status: nextStatus,
          note: 'Выполнено действие "Переоткрыть"',
        })
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editActionEnabled, getRecords, isEditOpen, record.id, record.subtitle, record.title, record.values, reopenAction, storeKey, tab.actionStatusMap, updateStatus])

  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editTitle.trim()) {
      setEditError('Название обязательно')
      return
    }
    const nextValues = { ...editValues }

    if (storeKey === CARS_CATALOG_STORE_KEY) {
      const normalizedVIN = normalizeVIN(nextValues[VIN_FIELD_KEY] ?? '')
      if (!normalizedVIN) {
        setEditError('VIN обязателен для каталога автомобилей')
        return
      }
      const duplicate = getRecords(storeKey).find(
        (entity) =>
          entity.id !== record.id &&
          normalizeVIN(entity.values[VIN_FIELD_KEY] ?? '') === normalizedVIN,
      )
      if (duplicate) {
        setEditError(`Автомобиль с VIN "${normalizedVIN}" уже существует (${duplicate.id})`)
        return
      }
      nextValues[VIN_FIELD_KEY] = normalizedVIN
    }

    if (storeKey === DEALS_STORE_KEY) {
      const enriched = enrichDealValuesWithCarInfo(nextValues, getRecords(DEAL_CARS_STORE_KEY))
      Object.assign(nextValues, enriched)
    }

    updateRecord({
      storeKey,
      recordId: record.id,
      title: editTitle.trim(),
      subtitle: editSubtitle.trim() || 'Карточка обновлена',
      values: nextValues,
    })
    setIsEditOpen(false)
  }

  const renderEditField = (key: string, value: string) => {
    const baseField: EntityCreateField =
      tab.createFields.find((field) => field.key === key) ?? {
        key,
        label: key,
        placeholder: '',
      }
    const resolvedField = resolveEntityCreateField(storeKey, baseField)

    if (resolvedField.inputType !== 'select') {
      return (
        <label key={key} className="field">
          <span>{resolvedField.label}</span>
          <input
            value={value}
            onChange={(event) => applyEditFieldValue(key, event.target.value)}
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
    const isCustom =
      resolvedField.allowCustom &&
      (editCustomMode[key] || (value.trim() !== '' && !hasMatchingOption))
    const selectValue = isCustom ? CUSTOM_SELECT_OPTION_VALUE : value

    const handleSelectChange = (nextValue: string) => {
      if (nextValue === CUSTOM_SELECT_OPTION_VALUE) {
        setEditCustomMode((prev) => ({ ...prev, [key]: true }))
        setEditValues((prev) => {
          const previous = prev[key] ?? ''
          const previousIsKnown = options.some((item) => item.value === previous)
          const next = { ...prev, [key]: previousIsKnown ? '' : previous }
          if (storeKey === DEALS_STORE_KEY && key === DEAL_VIN_FIELD_KEY) {
            return enrichDealValuesWithCarInfo(next, getRecords(DEAL_CARS_STORE_KEY))
          }
          return next
        })
        return
      }

      setEditCustomMode((prev) => ({ ...prev, [key]: false }))
      applyEditFieldValue(key, nextValue)
    }

    return (
      <label key={key} className="field">
        <span>{resolvedField.label}</span>
        <select value={selectValue} onChange={(event) => handleSelectChange(event.target.value)}>
          <option value="">{resolvedField.emptyOptionLabel}</option>
          {options.map((option) => (
            <option key={`${key}-${option.value}`} value={option.value}>
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
              setEditCustomMode((prev) => ({ ...prev, [key]: true }))
              applyEditFieldValue(key, event.target.value)
            }}
            placeholder={resolvedField.placeholder}
          />
        ) : null}
      </label>
    )
  }

  return (
    <>
      <header className="page-head">
        <div>
          <Breadcrumbs
            items={[
              { label: subsystem.title, to: `/${subsystem.slug}` },
              { label: tab.title, to: `/${subsystem.slug}/${tab.slug}` },
              { label: record.id },
            ]}
          />
          <h3>{record.title}</h3>
          <p>{record.subtitle}</p>
        </div>
        <div className="context-actions context-actions--wrap">
          <StatusBadge label={currentStatus.label} tone={currentStatus.tone} />
          {actionStates.map((action) => (
            <button
              key={action.key}
              className={action.critical ? 'btn-danger' : 'btn-secondary'}
              disabled={action.disabled}
              title={action.reason}
              onClick={() => runAction(action.key, action.label, action.critical)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </header>

      <p className="hint-row">Hotkeys: E редактировать, R переоткрыть, Esc закрыть диалог.</p>

      {disabledActions.length > 0 ? (
        <article className="access-note">
          <h4>Недоступные действия</h4>
          <ul>
            {disabledActions.map((action) => (
              <li key={action.key}>
                <strong>{action.label}:</strong> {action.reason}
              </li>
            ))}
          </ul>
        </article>
      ) : null}

      {readOnly ? (
        <p className="readonly-note">
          Объект закрыт. Изменения запрещены, доступен только режим просмотра.
        </p>
      ) : null}

      <section className="card-tabs">
        <button className={activePanel === 'details' ? 'active' : ''} onClick={() => setActivePanel('details')}>
          Основные данные
        </button>
        <button className={activePanel === 'history' ? 'active' : ''} onClick={() => setActivePanel('history')}>
          История
        </button>
        <button className={activePanel === 'related' ? 'active' : ''} onClick={() => setActivePanel('related')}>
          Связанные объекты
        </button>
      </section>

      {activePanel === 'details' ? (
        <article className="detail-card">
          <h4>Карточка {tab.entityName}</h4>
          <div className="detail-grid">
            <div>
              <span>ID</span>
              <strong>{record.id}</strong>
            </div>
            <div>
              <span>Название</span>
              <strong>{record.title}</strong>
            </div>
            <div>
              <span>Описание</span>
              <strong>{record.subtitle}</strong>
            </div>
            {Object.entries(record.values).map(([key, value]) => (
              <div key={key}>
                <span>{key}</span>
                <strong>{value || '-'}</strong>
              </div>
            ))}
          </div>
        </article>
      ) : null}

      {activePanel === 'history' ? (
        <article className="detail-card">
          <h4>История изменений</h4>
          <ul className="history-list">
            {record.history.map((item) => (
              <li key={item.id}>
                <p>{item.text}</p>
                <small>{item.at}</small>
              </li>
            ))}
          </ul>
        </article>
      ) : null}

      {activePanel === 'related' ? (
        <article className="detail-card">
          <h4>Связанные объекты</h4>
          <ul className="related-list">
            {record.related.length === 0 ? <li>Связанные объекты отсутствуют</li> : null}
            {record.related.map((item) => (
              <li key={item.id}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </li>
            ))}
          </ul>
          <Link className="table-link" to={`/${subsystem.slug}/${tab.slug}`}>
            Вернуться к списку
          </Link>
        </article>
      ) : null}

      {isEditOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal">
            <header className="modal__head">
              <h4>Редактирование карточки</h4>
              <button className="btn-ghost" onClick={() => setIsEditOpen(false)}>
                Закрыть
              </button>
            </header>
            <form className="modal__body modal__body--grid" onSubmit={submitEdit}>
              <label className="field">
                <span>Название</span>
                <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
              </label>
              <label className="field">
                <span>Описание</span>
                <input value={editSubtitle} onChange={(event) => setEditSubtitle(event.target.value)} />
              </label>
              {Object.entries(editValues).map(([key, value]) => renderEditField(key, value))}
              {editError ? <p className="form-error">{editError}</p> : null}
              <div className="modal__actions modal__actions--full">
                <button type="button" className="btn-secondary" onClick={() => setIsEditOpen(false)}>
                  Отмена
                </button>
                <button type="submit" className="btn-primary btn-primary--sm">
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  )
}

export function EntityCardPage() {
  const { subsystemSlug, tabSlug, recordId } = useParams()
  const subsystem = subsystemSlug ? getSubsystemBySlug(subsystemSlug) : undefined
  const tab = subsystem?.tabs.find((entityTab) => entityTab.slug === tabSlug)
  const { getRecord } = useEntityStore()

  if (!subsystem || !tab || !recordId) {
    return <Navigate to="/crm-sales" replace />
  }

  const storeKey = buildStoreKey(subsystem.slug, tab.slug)
  const record = getRecord(storeKey, recordId)

  if (!record) {
    return <Navigate to={`/${subsystem.slug}/${tab.slug}`} replace />
  }

  return (
    <EntityCardView
      key={record.id}
      subsystem={subsystem}
      tab={tab}
      storeKey={storeKey}
      record={record}
    />
  )
}
