import { useMemo, useState, type FormEvent } from 'react'

import { useEntityStore } from '../domain/EntityStoreContext'
import {
  CUSTOM_SELECT_OPTION_VALUE,
  resolveEntityCreateField,
  resolveEntityFieldOptions,
} from '../domain/fieldOptions'
import type { EntityCreateField, EntityRecord, EntityTabDefinition } from '../domain/model'
import { getSubsystemBySlug } from '../domain/subsystems'

const CLIENTS_STORE_KEY = 'crm-sales/clients'

type ClientQuickCreateModalProps = {
  isOpen: boolean
  onCancel: () => void
  onCreated: (client: EntityRecord) => void
}

function resolveClientsTab(): EntityTabDefinition | undefined {
  const subsystem = getSubsystemBySlug('crm-sales')
  return subsystem?.tabs.find((tab) => tab.slug === 'clients')
}

export function ClientQuickCreateModal({
  isOpen,
  onCancel,
  onCreated,
}: ClientQuickCreateModalProps) {
  const { createRecord, getRecords } = useEntityStore()
  const clientsTab = useMemo(() => resolveClientsTab(), [])
  const emptyFormValues = useMemo<Record<string, string>>(() => {
    if (!clientsTab) {
      return {}
    }
    return Object.fromEntries(clientsTab.createFields.map((field) => [field.key, '']))
  }, [clientsTab])

  const [formValues, setFormValues] = useState<Record<string, string>>(() => emptyFormValues)
  const [customMode, setCustomMode] = useState<Record<string, boolean>>({})
  const [createError, setCreateError] = useState('')

  if (!isOpen || !clientsTab) {
    return null
  }

  const applyFieldValue = (fieldKey: string, nextValue: string) => {
    setFormValues((prev) => ({ ...prev, [fieldKey]: nextValue }))
  }

  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const requiredField = clientsTab.createFields.find(
      (field) => field.required && !formValues[field.key]?.trim(),
    )
    if (requiredField) {
      setCreateError(`Поле "${requiredField.label}" обязательно`)
      return
    }

    const title = formValues.title?.trim() || `Новый ${clientsTab.entityName}`
    const subtitleField = clientsTab.createFields.find((field) => field.key !== 'title')
    const subtitleValue = subtitleField ? formValues[subtitleField.key] : ''
    const subtitle = subtitleValue?.trim() || `Карточка ${clientsTab.entityName}`
    const values = Object.fromEntries(
      Object.entries(formValues).filter(([key]) => key !== 'title' && key !== 'subtitle'),
    )

    const created = createRecord({
      storeKey: CLIENTS_STORE_KEY,
      idPrefix: clientsTab.idPrefix,
      initialStatus: clientsTab.statuses[0]?.key ?? 'active',
      title,
      subtitle,
      values,
    })

    setCreateError('')
    onCreated(created)
  }

  const renderField = (field: EntityCreateField) => {
    const resolvedField = resolveEntityCreateField(CLIENTS_STORE_KEY, field)
    const value = formValues[field.key] ?? ''

    if (resolvedField.inputType === 'date') {
      return (
        <label key={field.key} className="field">
          <span>
            {field.label}
            {field.required ? ' *' : ''}
          </span>
          <input
            type="date"
            value={value}
            onChange={(event) => applyFieldValue(field.key, event.target.value)}
          />
        </label>
      )
    }

    if (resolvedField.inputType !== 'select') {
      return (
        <label key={field.key} className="field">
          <span>
            {field.label}
            {field.required ? ' *' : ''}
          </span>
          <input
            value={value}
            onChange={(event) => applyFieldValue(field.key, event.target.value)}
            placeholder={field.placeholder}
          />
        </label>
      )
    }

    const options = resolveEntityFieldOptions({
      storeKey: CLIENTS_STORE_KEY,
      field: resolvedField,
      getRecords,
      currentValue: value,
      formValues,
    })
    const hasMatchingOption = options.some((item) => item.value === value)
    const isCustom =
      resolvedField.allowCustom &&
      (customMode[field.key] || (value.trim() !== '' && !hasMatchingOption))
    const selectValue = isCustom ? CUSTOM_SELECT_OPTION_VALUE : value

    const handleSelectChange = (nextValue: string) => {
      if (nextValue === CUSTOM_SELECT_OPTION_VALUE) {
        setCustomMode((prev) => ({ ...prev, [field.key]: true }))
        setFormValues((prev) => {
          const previous = prev[field.key] ?? ''
          const previousIsKnown = options.some((item) => item.value === previous)
          return { ...prev, [field.key]: previousIsKnown ? '' : previous }
        })
        return
      }

      setCustomMode((prev) => ({ ...prev, [field.key]: false }))
      applyFieldValue(field.key, nextValue)
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
              setCustomMode((prev) => ({ ...prev, [field.key]: true }))
              applyFieldValue(field.key, event.target.value)
            }}
            placeholder={field.placeholder}
          />
        ) : null}
      </label>
    )
  }

  const title =
    clientsTab.actions.find((action) => action.key === 'create')?.label ?? 'Создать клиента'

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal">
        <header className="modal__head">
          <h4>{title}</h4>
          <button className="btn-ghost" onClick={onCancel}>
            Закрыть
          </button>
        </header>

        <form className="modal__body modal__body--grid" onSubmit={submitCreate}>
          {clientsTab.createFields.map((field) => renderField(field))}
          {createError ? <p className="form-error">{createError}</p> : null}
          <div className="modal__actions modal__actions--full">
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Отмена
            </button>
            <button type="submit" className="btn-primary btn-primary--sm">
              Создать
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
