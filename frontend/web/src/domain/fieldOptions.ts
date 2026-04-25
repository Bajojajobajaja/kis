import type {
  EntityCreateField,
  EntityFieldInputType,
  EntityFieldOption,
  EntityFieldOptionsSource,
  EntityRecord,
} from './model'
import { CARS_STORE_KEY, DEALS_STORE_KEY, VIN_FIELD_KEY } from './dealCarInfo'
import {
  getReferenceTextFieldKey,
  isStoreReferenceField,
  resolveStoreReferenceRecord,
} from './entityReferences'
import {
  FINANCE_INVOICES_STORE_KEY,
  extractFinanceInvoiceContext,
  isFinanceInvoiceSelectable,
} from './finance'
import {
  buildInventoryStockOptionLabel,
  INVENTORY_PURCHASES_STORE_KEY,
  INVENTORY_STOCK_STORE_KEY,
} from './inventory'
import {
  isSalesManagerUser,
  isServiceMasterUser,
  PLATFORM_ROLES_STORE_KEY,
  PLATFORM_USERS_STORE_KEY,
} from './platform'

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
  formValues?: Record<string, string>
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

const segmentOptions = options(['Корпоративный', 'Розница', 'Лизинг'])

const channelOptions = options(['Телефон', 'Сайт', 'Email', 'Мессенджер', 'Офис', 'Telegram'])
const leadSourceOptions = options([
  'Реклама',
  'SEO',
  'Контакт-центр',
  'Telegram',
  'Рекомендация',
])
const documentTypeOptions = options([
  'Счет',
  'Договор',
  'Акт',
  'Акт сверки',
  'Накладная',
  'Платежное поручение',
])
const financeDirectionOptions = [
  { value: 'outgoing', label: 'Исходящий' },
  { value: 'incoming', label: 'Входящий' },
]
const ownerOptions = options([
  'Менеджер',
  'Бухгалтер',
  'Кладовщик',
  'Сервис-администратор',
  'Security Team',
  'Platform Team',
])
const warehouseOptions = options(['Основной', 'Центральный', 'Резервный'])
const supplierOptions = options(['ООО Партс', 'ТехСнаб', 'АвтоДеталь'])
export const paymentMethodOptions = options(['Банковский перевод', 'Карта', 'Наличные', 'Безнал'])
const reportFormatOptions = options(['PDF'])
const reportTypeOptions = [{ value: 'ar-ap', label: 'AR/AP' }]
const departmentOptions = options([
  'Продажи',
  'Сервис и склад',
  'Финансы',
  'Платформа',
  'Безопасность',
])
const scopeOptions = options(['CRM', 'Service', 'Inventory', 'Finance', 'Platform'])
export const resourceOptions = options([
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
const DATE_FIELD_KEYS = new Set(['date', 'eta', 'dueDate'])
const carModelsByBrand: Record<string, string[]> = {
  Chery: ['Arrizo 8', 'Tiggo 4', 'Tiggo 7 Pro', 'Tiggo 8 Pro'],
  Geely: ['Atlas', 'Coolray', 'Emgrand', 'Monjaro'],
  Hyundai: ['Creta', 'Elantra', 'Santa Fe', 'Tucson'],
  KIA: ['K5', 'Rio', 'Sorento', 'Sportage'],
  LADA: ['Granta', 'Largus', 'Niva Travel', 'Vesta'],
  Toyota: ['Camry', 'Corolla', 'Land Cruiser Prado', 'RAV4'],
  Volkswagen: ['Polo', 'Taos', 'Tiguan'],
}
const carBrandOptions = options(Object.keys(carModelsByBrand))
const carYearOptions = Array.from({ length: 30 }, (_, index) =>
  String(new Date().getFullYear() - index),
).map((value) => ({ value, label: value }))

function isDateLikeFieldKey(key: string): boolean {
  return DATE_FIELD_KEYS.has(key)
}

function resolveCarModelOptions(brand: string): EntityFieldOption[] {
  const normalizedBrand = brand.trim()
  if (!normalizedBrand) {
    return []
  }
  return options(carModelsByBrand[normalizedBrand] ?? [])
}

export function buildCarTitle(brand: string, model: string, year: string): string {
  return [brand.trim(), model.trim(), year.trim()].filter(Boolean).join(' ')
}

export function isCarModelValidForBrand(brand: string, model: string): boolean {
  const normalizedBrand = brand.trim()
  const normalizedModel = model.trim()
  if (!normalizedModel) {
    return true
  }
  if (!normalizedBrand) {
    return false
  }
  const optionsForBrand = carModelsByBrand[normalizedBrand]
  if (!optionsForBrand) {
    return true
  }
  return optionsForBrand.includes(normalizedModel)
}

const fieldOverrides: Record<string, Record<string, FieldOverride>> = {
  'crm-sales/clients': {
    owner: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите ответственного',
      optionsSource: {
        type: 'store',
        storeKey: PLATFORM_USERS_STORE_KEY,
        valueKey: 'id',
        labelKey: 'title',
      },
    },
    segment: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите сегмент',
      options: segmentOptions,
    },
  },
  'crm-sales/deals': {
    client: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите клиента',
      optionsSource: {
        type: 'store',
        storeKey: 'crm-sales/clients',
        valueKey: 'id',
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
        valueKey: 'id',
        labelKey: 'vin',
      },
    },
    manager: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите менеджера',
      optionsSource: {
        type: 'store',
        storeKey: PLATFORM_USERS_STORE_KEY,
        valueKey: 'id',
        labelKey: 'title',
      },
    },
  },
  'crm-sales/cars': {
    brand: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите марку',
      options: carBrandOptions,
    },
    model: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Сначала выберите марку',
    },
    year: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите год',
      options: carYearOptions,
    },
    ownerClient: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите владельца',
      optionsSource: {
        type: 'store',
        storeKey: 'crm-sales/clients',
        valueKey: 'id',
        labelKey: 'title',
      },
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
      optionsSource: {
        type: 'store',
        storeKey: PLATFORM_USERS_STORE_KEY,
        valueKey: 'id',
        labelKey: 'title',
      },
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
        valueKey: 'id',
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
      optionsSource: {
        type: 'store',
        storeKey: PLATFORM_USERS_STORE_KEY,
        valueKey: 'id',
        labelKey: 'title',
      },
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
        valueKey: 'id',
        labelKey: 'vin',
      },
    },
    master: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите мастера',
      optionsSource: {
        type: 'store',
        storeKey: PLATFORM_USERS_STORE_KEY,
        valueKey: 'id',
        labelKey: 'title',
      },
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
        valueKey: 'id',
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
      optionsSource: {
        type: 'store',
        storeKey: PLATFORM_USERS_STORE_KEY,
        valueKey: 'id',
        labelKey: 'title',
      },
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
    stockItemId: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите товар',
      optionsSource: {
        type: 'store',
        storeKey: INVENTORY_STOCK_STORE_KEY,
        valueKey: 'id',
        labelKey: 'title',
      },
    },
    supplier: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите поставщика',
      options: supplierOptions,
    },
  },
  'inventory/documents': {
    supplier: {
      inputType: 'select',
      allowCustom: true,
      emptyOptionLabel: 'Выберите поставщика',
      options: supplierOptions,
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
        valueKey: 'id',
        labelKey: 'title',
      },
    },
    direction: {
      inputType: 'select',
      allowCustom: false,
      emptyOptionLabel: 'Выберите тип счета',
      options: financeDirectionOptions,
    },
  },
  'finance/payments': {
    invoice: {
      inputType: 'select',
      allowCustom: false,
      emptyOptionLabel: 'Выберите счет',
      optionsSource: {
        type: 'store',
        storeKey: FINANCE_INVOICES_STORE_KEY,
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
    type: {
      inputType: 'select',
      allowCustom: false,
      emptyOptionLabel: 'Выберите тип отчета',
      options: reportTypeOptions,
    },
    period: {
      inputType: 'month',
    },
    format: {
      inputType: 'select',
      allowCustom: false,
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
        valueKey: 'id',
        labelKey: 'title',
      },
    },
  },
  'platform/users': {
    businessRoleId: {
      inputType: 'select',
      allowCustom: false,
      emptyOptionLabel: 'Выберите бизнес-роль',
      optionsSource: {
        type: 'store',
        storeKey: PLATFORM_ROLES_STORE_KEY,
        valueKey: 'id',
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
      allowCustom: false,
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
        valueKey: 'id',
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

function isCarVinStoreSource(
  source: EntityFieldOptionsSource,
): source is EntityFieldOptionsSource & { type: 'store'; storeKey: typeof CARS_STORE_KEY } {
  return source.type === 'store' && source.storeKey === CARS_STORE_KEY && source.labelKey === VIN_FIELD_KEY
}

function formatCarVinLabel(record: EntityRecord, vin: string): string {
  const title = (record.title ?? '').trim()
  const year = (record.values.year ?? '').trim()
  if (!title && !year) {
    return vin.trim() || record.id
  }
  const yearPart = year ? ` (${year})` : ''
  const left = title ? `${title}${yearPart}` : year
  const normalizedVin = vin.trim()
  return normalizedVin ? `${left} — ${normalizedVin}` : left
}

function isSalesManagerField(
  storeKey: string,
  fieldKey: string,
  source: EntityFieldOptionsSource,
): boolean {
  if (!isPlatformUserReferenceSource(source)) {
    return false
  }

  return (
    (storeKey === 'crm-sales/clients' && fieldKey === 'owner') ||
    (storeKey === 'crm-sales/leads' && fieldKey === 'manager') ||
    (storeKey === 'crm-sales/deals' && fieldKey === 'manager') ||
    (storeKey === 'crm-sales/events' && fieldKey === 'owner')
  )
}

function isPlatformUserReferenceSource(
  source: EntityFieldOptionsSource,
): source is EntityFieldOptionsSource & {
  type: 'store'
  storeKey: typeof PLATFORM_USERS_STORE_KEY
  valueKey: 'id'
  labelKey: 'title'
} {
  return (
    source.type === 'store' &&
    source.storeKey === PLATFORM_USERS_STORE_KEY &&
    source.valueKey === 'id' &&
    source.labelKey === 'title'
  )
}

function isServiceMasterField(
  storeKey: string,
  fieldKey: string,
  source: EntityFieldOptionsSource,
): boolean {
  return isPlatformUserReferenceSource(source) && storeKey === 'service/orders' && fieldKey === 'master'
}

function isServiceEventOwnerField(
  storeKey: string,
  fieldKey: string,
  source: EntityFieldOptionsSource,
): boolean {
  return isPlatformUserReferenceSource(source) && storeKey === 'service/events' && fieldKey === 'owner'
}

function isPlatformBusinessRoleField(
  storeKey: string,
  fieldKey: string,
  source: EntityFieldOptionsSource,
): boolean {
  return (
    storeKey === PLATFORM_USERS_STORE_KEY &&
    fieldKey === 'businessRoleId' &&
    source.type === 'store' &&
    source.storeKey === PLATFORM_ROLES_STORE_KEY &&
    source.valueKey === 'id' &&
    source.labelKey === 'title'
  )
}

function mergeDealVinOptions(
  map: Map<string, string>,
  source: EntityFieldOptionsSource,
  getRecords: (storeKey: string) => EntityRecord[],
  currentValue?: string,
) {
  if (source.type !== 'store') {
    return
  }

  const currentCarId = (currentValue ?? '').trim()
  const occupiedCarIds = new Set(
    getRecords(DEALS_STORE_KEY)
      .map((deal) => (deal.values[VIN_FIELD_KEY] ?? '').trim())
      .filter(Boolean),
  )
  const records = getRecords(source.storeKey)
  for (const record of records) {
    const value = record.id
    if (!value) {
      continue
    }
    if (value !== currentCarId && occupiedCarIds.has(value)) {
      continue
    }
    const label = formatCarVinLabel(record, record.values[VIN_FIELD_KEY] ?? '')
    mergeOption(map, value, label)
  }
}

function mergeStoreOptions(
  map: Map<string, string>,
  source: EntityFieldOptionsSource,
  getRecords: (storeKey: string) => EntityRecord[],
  currentValue?: string,
  formValues?: Record<string, string>,
) {
  if (source.type !== 'store') {
    return
  }

  const financeContext = source.storeKey === FINANCE_INVOICES_STORE_KEY
    ? extractFinanceInvoiceContext(formValues ?? {})
    : undefined
  const records = getRecords(source.storeKey)
  for (const record of records) {
    if (
      source.storeKey === FINANCE_INVOICES_STORE_KEY &&
      !isFinanceInvoiceSelectable(record, currentValue, financeContext)
    ) {
      continue
    }
    const value = extractRecordValue(record, source.valueKey)
    if (!value) {
      continue
    }
    const label = isCarVinStoreSource(source)
      ? formatCarVinLabel(record, extractRecordValue(record, VIN_FIELD_KEY))
      : source.labelKey
        ? extractRecordValue(record, source.labelKey)
        : value
    mergeOption(map, value, label)
  }
}

function mergeSalesManagerOptions(
  map: Map<string, string>,
  source: EntityFieldOptionsSource,
  getRecords: (storeKey: string) => EntityRecord[],
) {
  mergeFilteredPlatformUserOptions(map, source, getRecords, isSalesManagerUser)
}

function mergeServiceMasterOptions(
  map: Map<string, string>,
  source: EntityFieldOptionsSource,
  getRecords: (storeKey: string) => EntityRecord[],
) {
  mergeFilteredPlatformUserOptions(map, source, getRecords, isServiceMasterUser)
}

function mergeFilteredPlatformUserOptions(
  map: Map<string, string>,
  source: EntityFieldOptionsSource,
  getRecords: (storeKey: string) => EntityRecord[],
  predicate: (record: EntityRecord) => boolean,
) {
  const records = getRecords(source.storeKey)
  for (const record of records) {
    if (!predicate(record)) {
      continue
    }
    const value = extractRecordValue(record, source.valueKey)
    if (!value) {
      continue
    }
    const label = source.labelKey ? extractRecordValue(record, source.labelKey) : value
    mergeOption(map, value, label)
  }
}

function mergeActivePlatformRoleOptions(
  map: Map<string, string>,
  source: EntityFieldOptionsSource,
  getRecords: (storeKey: string) => EntityRecord[],
) {
  const records = getRecords(source.storeKey)
  for (const record of records) {
    if (record.status !== 'active') {
      continue
    }
    const value = extractRecordValue(record, source.valueKey)
    if (!value) {
      continue
    }
    const label = source.labelKey ? extractRecordValue(record, source.labelKey) : value
    mergeOption(map, value, label)
  }
}

function mergeInventoryStockOptions(
  map: Map<string, string>,
  getRecords: (storeKey: string) => EntityRecord[],
) {
  const records = getRecords(INVENTORY_STOCK_STORE_KEY)
  for (const record of records) {
    mergeOption(map, record.id, buildInventoryStockOptionLabel(record))
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
    inputType: merged.inputType ?? (isDateLikeFieldKey(field.key) ? 'date' : 'text'),
    allowCustom: merged.allowCustom ?? false,
    emptyOptionLabel: merged.emptyOptionLabel ?? DEFAULT_EMPTY_OPTION_LABEL,
  }
}

export function resolveEntityFieldOptions({
  storeKey,
  field,
  getRecords,
  currentValue,
  formValues,
}: ResolveEntityFieldOptionsParams): EntityFieldOption[] {
  const resolvedField = resolveEntityCreateField(storeKey, field)
  if (resolvedField.inputType !== 'select') {
    return []
  }

  const optionsMap = new Map<string, string>()
  for (const option of resolvedField.options ?? []) {
    mergeOption(optionsMap, option.value, option.label)
  }

  if (storeKey === 'crm-sales/cars' && field.key === 'model') {
    const selectedBrand = formValues?.brand ?? ''
    for (const option of resolveCarModelOptions(selectedBrand)) {
      mergeOption(optionsMap, option.value, option.label)
    }
  }

  if (resolvedField.optionsSource) {
    if (
      storeKey === DEALS_STORE_KEY &&
      field.key === 'vin' &&
      resolvedField.optionsSource.type === 'store' &&
      resolvedField.optionsSource.storeKey === CARS_STORE_KEY
    ) {
      mergeDealVinOptions(optionsMap, resolvedField.optionsSource, getRecords, currentValue)
    } else if (storeKey === INVENTORY_PURCHASES_STORE_KEY && field.key === 'stockItemId') {
      mergeInventoryStockOptions(optionsMap, getRecords)
    } else if (isSalesManagerField(storeKey, field.key, resolvedField.optionsSource)) {
      mergeSalesManagerOptions(optionsMap, resolvedField.optionsSource, getRecords)
    } else if (
      isServiceMasterField(storeKey, field.key, resolvedField.optionsSource) ||
      isServiceEventOwnerField(storeKey, field.key, resolvedField.optionsSource)
    ) {
      mergeServiceMasterOptions(optionsMap, resolvedField.optionsSource, getRecords)
    } else if (isPlatformBusinessRoleField(storeKey, field.key, resolvedField.optionsSource)) {
      mergeActivePlatformRoleOptions(optionsMap, resolvedField.optionsSource, getRecords)
    } else {
      mergeStoreOptions(optionsMap, resolvedField.optionsSource, getRecords, currentValue, formValues)
    }
  }

  const current = (currentValue ?? '').trim()
  if (current) {
    if (isStoreReferenceField(resolvedField)) {
      const currentText = (formValues?.[getReferenceTextFieldKey(field.key)] ?? '').trim()
      const currentRecord = resolveStoreReferenceRecord(
        resolvedField.optionsSource,
        current,
        getRecords,
        { allowLegacyMatch: true },
      )

      if (currentRecord) {
        const label =
          storeKey === INVENTORY_PURCHASES_STORE_KEY && field.key === 'stockItemId'
            ? buildInventoryStockOptionLabel(currentRecord)
            : isCarVinStoreSource(resolvedField.optionsSource)
              ? formatCarVinLabel(
                  currentRecord,
                  extractRecordValue(currentRecord, VIN_FIELD_KEY),
                )
            : resolvedField.optionsSource.labelKey
              ? extractRecordValue(currentRecord, resolvedField.optionsSource.labelKey)
              : currentRecord.title || currentRecord.id
        mergeOption(optionsMap, currentRecord.id, label)
      } else {
        mergeOption(optionsMap, current, currentText || current)
      }
    } else {
      mergeOption(optionsMap, current, current)
    }
  }

  const out = Array.from(optionsMap.entries()).map(([value, label]) => ({ value, label }))
  if (storeKey === 'crm-sales/cars' && field.key === 'year') {
    out.sort((left, right) => Number(right.value) - Number(left.value))
    return out
  }
  const sortMode = resolvedField.optionsSource?.sort ?? 'asc'
  if (sortMode === 'asc') {
    out.sort((left, right) => left.label.localeCompare(right.label, 'ru'))
  }
  return out
}


