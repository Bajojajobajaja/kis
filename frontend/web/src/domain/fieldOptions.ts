import type {
  EntityCreateField,
  EntityFieldInputType,
  EntityFieldOption,
  EntityFieldOptionsSource,
  EntityRecord,
} from './model'

export const CUSTOM_SELECT_OPTION_VALUE = '__custom__'

const DEFAULT_EMPTY_OPTION_LABEL = 'Выберите значение'

type FieldOverride = Omit<Partial<EntityCreateField>, 'key' | 'label' | 'placeholder' | 'required'>

export type ResolvedEntityCreateField = EntityCreateField & {
  inputType: EntityFieldInputType
  allowCustom: boolean
  emptyOptionLabel: string
}

type ResolveEntityFieldOptionsParams = {
  storeKey: string
  field: EntityCreateField
  getRecords: (storeKey: string) => EntityRecord[]
  currentValue?: string
}

function options(values: string[]): EntityFieldOption[] {
  return values.map((value) => ({ value, label: value }))
}

const managerOptions = options([
  'Иванов И.И.',
  'Петрова А.А.',
  'Смирнов С.С.',
  'Старший мастер',
  'Финансовый менеджер',
])

const channelOptions = options(['Телефон', 'Сайт', 'Email', 'Мессенджер', 'Офис', 'Telegram'])
const leadSourceOptions = options([
  'Реклама',
  'SEO',
  'Контакт-центр',
  'Telegram',
  'Рекомендация',
])
const documentTypeOptions = options(['Счет', 'Договор', 'Акт', 'Накладная', 'Платежное поручение'])
const ownerOptions = options([
  'Менеджер',
  'Бухгалтер',
  'Кладовщик',
  'Сервис-администратор',
  'Security Team',
  'Platform Team',
])
const serviceMasterOptions = options(['Петров П.П.', 'Сидоров С.С.', 'Старший мастер'])
const warehouseOptions = options(['Основной', 'Центральный', 'Резервный'])
const supplierOptions = options(['ООО Партс', 'ТехСнаб', 'АвтоДеталь'])
const movementOperationOptions = options(['Приход', 'Списание', 'Перемещение', 'Возврат'])
const paymentMethodOptions = options(['Банковский перевод', 'Карта', 'Наличные', 'Безнал'])
const reportFormatOptions = options(['XLSX', 'PDF', 'CSV'])
const departmentOptions = options(['Продажи', 'Сервис', 'Склад', 'Финансы', 'Платформа', 'Безопасность'])
const userRoleOptions = options(['admin', 'manager', 'accountant', 'viewer'])
const scopeOptions = options(['CRM', 'Service', 'Inventory', 'Finance', 'Platform'])
const resourceOptions = options([
  'finance/invoices',
  'finance/payments',
  'crm/deals',
  'inventory/stock',
  'platform/users',
])
const integrationServiceOptions = options([
  'platform-integrations',
  'api-gateway',
  'notification',
  'crm-leads',
  'reporting-bi',
])

const fieldOverrides: Record<string, Record<string, FieldOverride>> = {
  'crm-sales/deals': {
    client: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите клиента',
      optionsSource: {
        type: 'store',
        storeKey: 'crm-sales/clients',
        valueKey: 'title',
        labelKey: 'title',
      },
    },
    vin: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите VIN',
      optionsSource: {
        type: 'store',
        storeKey: 'crm-sales/cars',
        valueKey: 'vin',
        labelKey: 'title',
      },
    },
    manager: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите менеджера',
      options: managerOptions,
    },
  },
  'crm-sales/leads': {
    channel: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите канал',
      options: channelOptions,
    },
    source: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите источник',
      options: leadSourceOptions,
    },
    manager: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите менеджера',
      options: managerOptions,
    },
  },
  'crm-sales/documents': {
    docType: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите тип документа',
      options: documentTypeOptions,
    },
    owner: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите ответственного',
      options: ownerOptions,
    },
    client: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите контрагента',
      optionsSource: {
        type: 'store',
        storeKey: 'crm-sales/clients',
        valueKey: 'title',
        labelKey: 'title',
      },
    },
  },
  'crm-sales/events': {
    channel: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите канал',
      options: channelOptions,
    },
    owner: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите ответственного',
      options: managerOptions,
    },
  },
  'service/orders': {
    vin: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите VIN',
      optionsSource: {
        type: 'store',
        storeKey: 'crm-sales/cars',
        valueKey: 'vin',
        labelKey: 'title',
      },
    },
    master: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите мастера',
      options: serviceMasterOptions,
    },
  },
  'service/appointments': {
    client: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите клиента',
      optionsSource: {
        type: 'store',
        storeKey: 'crm-sales/clients',
        valueKey: 'title',
        labelKey: 'title',
      },
    },
    channel: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите канал',
      options: channelOptions,
    },
  },
  'service/documents': {
    docType: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите тип документа',
      options: documentTypeOptions,
    },
    wo: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите заказ-наряд',
      optionsSource: {
        type: 'store',
        storeKey: 'service/orders',
        valueKey: 'id',
        labelKey: 'title',
      },
    },
  },
  'service/events': {
    wo: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите заказ-наряд',
      optionsSource: {
        type: 'store',
        storeKey: 'service/orders',
        valueKey: 'id',
        labelKey: 'title',
      },
    },
    owner: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите ответственного',
      options: serviceMasterOptions,
    },
  },
  'inventory/stock': {
    warehouse: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите склад',
      options: warehouseOptions,
    },
  },
  'inventory/purchases': {
    supplier: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите поставщика',
      options: supplierOptions,
    },
  },
  'inventory/movements': {
    sku: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите SKU',
      optionsSource: {
        type: 'store',
        storeKey: 'inventory/stock',
        valueKey: 'sku',
        labelKey: 'title',
      },
    },
    operation: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите операцию',
      options: movementOperationOptions,
    },
  },
  'inventory/documents': {
    docType: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите тип документа',
      options: documentTypeOptions,
    },
    owner: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите ответственного',
      options: ownerOptions,
    },
  },
  'finance/invoices': {
    counterparty: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите контрагента',
      optionsSource: {
        type: 'store',
        storeKey: 'crm-sales/clients',
        valueKey: 'title',
        labelKey: 'title',
      },
    },
  },
  'finance/payments': {
    invoice: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите счет',
      optionsSource: {
        type: 'store',
        storeKey: 'finance/invoices',
        valueKey: 'id',
        labelKey: 'title',
      },
    },
    method: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите метод оплаты',
      options: paymentMethodOptions,
    },
  },
  'finance/reports': {
    format: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите формат',
      options: reportFormatOptions,
    },
    owner: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите ответственного',
      options: managerOptions,
    },
  },
  'finance/documents': {
    docType: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите тип документа',
      options: documentTypeOptions,
    },
    owner: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите ответственного',
      options: ownerOptions,
    },
    counterparty: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите контрагента',
      optionsSource: {
        type: 'store',
        storeKey: 'crm-sales/clients',
        valueKey: 'title',
        labelKey: 'title',
      },
    },
  },
  'platform/users': {
    role: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите роль',
      options: userRoleOptions,
      optionsSource: {
        type: 'store',
        storeKey: 'platform/roles',
        valueKey: 'title',
        labelKey: 'title',
      },
    },
    department: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите подразделение',
      options: departmentOptions,
    },
  },
  'platform/roles': {
    scope: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите контур',
      options: scopeOptions,
    },
    owner: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите владельца',
      options: ownerOptions,
    },
  },
  'platform/audits': {
    actor: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите пользователя',
      optionsSource: {
        type: 'store',
        storeKey: 'platform/users',
        valueKey: 'title',
        labelKey: 'title',
      },
    },
    resource: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите ресурс',
      options: resourceOptions,
    },
  },
  'platform/integrations': {
    service: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите сервис',
      options: integrationServiceOptions,
    },
    owner: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите ответственного',
      options: ownerOptions,
    },
  },
}

function extractRecordValue(record: EntityRecord, key: string): string {
  if (key === 'id') {
    return record.id
  }
  if (key === 'title') {
    return record.title
  }
  if (key === 'subtitle') {
    return record.subtitle
  }
  return record.values[key] ?? ''
}

function mergeOption(map: Map<string, string>, value: string, label: string) {
  const normalizedValue = value.trim()
  if (!normalizedValue) {
    return
  }
  if (map.has(normalizedValue)) {
    return
  }
  map.set(normalizedValue, label.trim() || normalizedValue)
}

function mergeStoreOptions(
  map: Map<string, string>,
  source: EntityFieldOptionsSource,
  getRecords: (storeKey: string) => EntityRecord[],
) {
  if (source.type !== 'store') {
    return
  }

  const records = getRecords(source.storeKey)
  for (const record of records) {
    const value = extractRecordValue(record, source.valueKey)
    if (!value) {
      continue
    }
    const label = source.labelKey ? extractRecordValue(record, source.labelKey) : value
    mergeOption(map, value, label)
  }
}

export function resolveEntityCreateField(storeKey: string, field: EntityCreateField): ResolvedEntityCreateField {
  const override = fieldOverrides[storeKey]?.[field.key]
  const merged = {
    ...field,
    ...(override ?? {}),
  }

  return {
    ...merged,
    inputType: merged.inputType ?? 'text',
    allowCustom: merged.allowCustom ?? false,
    emptyOptionLabel: merged.emptyOptionLabel ?? DEFAULT_EMPTY_OPTION_LABEL,
  }
}

export function resolveEntityFieldOptions({
  storeKey,
  field,
  getRecords,
  currentValue,
}: ResolveEntityFieldOptionsParams): EntityFieldOption[] {
  const resolvedField = resolveEntityCreateField(storeKey, field)
  if (resolvedField.inputType !== 'select') {
    return []
  }

  const optionsMap = new Map<string, string>()
  for (const option of resolvedField.options ?? []) {
    mergeOption(optionsMap, option.value, option.label)
  }

  if (resolvedField.optionsSource) {
    mergeStoreOptions(optionsMap, resolvedField.optionsSource, getRecords)
  }

  const current = (currentValue ?? '').trim()
  if (current) {
    mergeOption(optionsMap, current, current)
  }

  const out = Array.from(optionsMap.entries()).map(([value, label]) => ({ value, label }))
  const sortMode = resolvedField.optionsSource?.sort ?? 'asc'
  if (sortMode === 'asc') {
    out.sort((left, right) => left.label.localeCompare(right.label, 'ru'))
  }
  return out
}
