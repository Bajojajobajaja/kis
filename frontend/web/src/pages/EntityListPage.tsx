import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'

import { Breadcrumbs, StatusBadge } from '../components'
import { ClientQuickCreateModal } from '../components/ClientQuickCreateModal'
import { useAuth } from '../auth/AuthContext'
import { useEntityStore } from '../domain/EntityStoreContext'
import {
  CARS_STORE_KEY as DEAL_CARS_STORE_KEY,
  DEALS_STORE_KEY,
  prefillDealAmountFromCarInfo,
  VIN_FIELD_KEY as DEAL_VIN_FIELD_KEY,
  enrichDealValuesWithCarInfo,
} from '../domain/dealCarInfo'
import {
  getReferenceTextFieldKey,
  isReferenceTextFieldKey,
  isStoreReferenceField,
  resolveStoreReferenceLabel,
  setStoreReferenceCustomText,
  setStoreReferenceRecordId,
} from '../domain/entityReferences'
import {
  buildCarTitle,
  CUSTOM_SELECT_OPTION_VALUE,
  isCarModelValidForBrand,
  resolveEntityCreateField,
  resolveEntityFieldOptions,
} from '../domain/fieldOptions'
import {
  applyFinancePaymentInvoiceContext,
  buildFinanceDocumentSubtitle,
  buildFinanceInvoiceSubtitle,
  buildFinancePaymentSubtitle,
  buildFinanceReportSubtitle,
  canFinancePaymentFitInvoice,
  financeReportPeriodFromMonthInputValue,
  financeReportPeriodToMonthInputValue,
  FINANCE_DOCUMENTS_STORE_KEY,
  FINANCE_INVOICES_STORE_KEY,
  FINANCE_PAYMENTS_STORE_KEY,
  FINANCE_REPORTS_STORE_KEY,
  formatFinanceInvoiceDirection,
  getFinanceContextualInvoices,
  getFinanceInvoiceAvailableAmount,
  normalizeFinanceInvoiceValues,
  normalizeFinancePaymentValues,
  resolveEntityRecords,
} from '../domain/finance'
import { formatMoneyString, normalizePhoneStrict } from '../domain/formatters'
import {
  buildInventoryPurchaseTitle,
  buildInventoryStockReference,
  computeInventoryPurchaseAmount,
  findLatestInventoryPurchaseUnitPrice,
  computeInventoryStockStatusFromValues,
  countOpenInventoryPurchases,
  INVENTORY_DOCUMENTS_STORE_KEY,
  INVENTORY_PURCHASES_STORE_KEY,
  INVENTORY_STOCK_STORE_KEY,
  normalizeInventoryPurchaseQuantity,
  normalizeInventoryPurchaseUnitPrice,
  normalizeInventoryPurchaseValues,
  resolveInventoryStockValue,
} from '../domain/inventory'
import {
  reconcileInventoryStockRecords,
  upsertInventoryStockValues,
} from '../domain/inventoryStockService'
import {
  buildPlatformRoleSubtitle,
  buildPlatformUserSubtitle,
  normalizePlatformUserValues,
  PLATFORM_ROLES_STORE_KEY,
  PLATFORM_USERS_STORE_KEY,
  resolvePlatformUserLabel,
} from '../domain/platform'
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
import { formatAccessRoleLabel, getActionDeniedReason } from '../domain/rbac'

const PAGE_SIZE = 8
const PREFERENCES_PREFIX = 'kis.listPrefs.'
const CARS_CATALOG_STORE_KEY = 'crm-sales/cars'
const CRM_SALES_DOCUMENTS_STORE_KEY = 'crm-sales/documents'
const VIN_FIELD_KEY = 'vin'
const DEFAULT_STOCK_WAREHOUSE = 'Основной'
const DEFAULT_STOCK_OWNER = 'Кладовщик'
const DEFAULT_FINANCE_OWNER = 'Финансовый отдел'
const inventoryCustomStockFields: EntityCreateField[] = [
  { key: 'newStockTitle', label: 'Название нового товара', placeholder: 'Тормозной цилиндр', required: true },
  { key: 'newStockSku', label: 'SKU нового товара', placeholder: 'PART-CYLINDER', required: true },
  { key: 'newStockWarehouse', label: 'Склад', placeholder: DEFAULT_STOCK_WAREHOUSE, required: true },
  { key: 'newStockAvailable', label: 'Доступно', placeholder: '0', required: true },
  { key: 'newStockReserved', label: 'В резерве', placeholder: '0' },
  { key: 'newStockMin', label: 'Мин. остаток', placeholder: '0', required: true },
]

const inventoryPurchaseFields: EntityCreateField[] = [
  { key: 'quantity', label: 'Количество', placeholder: '1', required: true },
  { key: 'unitPrice', label: 'Цена за штуку', placeholder: '17 000', required: true },
  { key: 'amount', label: 'Сумма', placeholder: 'Рассчитывается автоматически' },
]

type ListPreferences = {
  query: string
  statusFilter: string
  sortKey: string
  sortDirection: SortDirection
  visibleColumns: string[]
}

type EntityListNavigationState = {
  openCreateForStoreKey?: string
  prefillCreateValues?: Record<string, string>
  prefillCreateCustomMode?: Record<string, boolean>
  prefillQueryForStoreKey?: string
  prefillQuery?: string
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeVIN(value: string): string {
  return value.trim().toUpperCase()
}

function formatMoneyDisplay(value: string): string {
  const formatted = formatMoneyString(value)
  return formatted || value
}

function buildRecordPath(storeKey: string, recordId: string): string | null {
  const [subsystemSlug, tabSlug] = storeKey.split('/')
  if (!subsystemSlug || !tabSlug || !recordId.trim()) {
    return null
  }
  return `/${subsystemSlug}/${tabSlug}/${recordId}`
}

function buildStorePath(storeKey: string): string | null {
  const [subsystemSlug, tabSlug] = storeKey.split('/')
  if (!subsystemSlug || !tabSlug) {
    return null
  }
  return `/${subsystemSlug}/${tabSlug}`
}

function buildDealTitleFromVin(carId: string, cars: EntityRecord[]): string | null {
  const normalizedId = carId.trim()
  if (!normalizedId) {
    return null
  }
  const car = cars.find((item) => item.id === normalizedId)
  if (!car) {
    return null
  }
  const vin = normalizeVIN(car.values[VIN_FIELD_KEY] ?? '')
  const title = (car.title ?? '').trim()
  const year = (car.values.year ?? '').trim()
  const yearPart = year ? ` (${year})` : ''
  const left = title ? `${title}${yearPart}` : year
  return left ? `${left} — ${vin}` : vin
}

function buildNextNumber(records: EntityRecord[], prefix: string): string {
  const maxValue = records.reduce((max, record) => {
    const raw = ((record.values.number ?? '').trim() || record.id.trim())
    if (!raw.startsWith(`${prefix}-`)) {
      return max
    }
    const numeric = Number(raw.slice(prefix.length + 1))
    if (Number.isNaN(numeric)) {
      return max
    }
    return Math.max(max, numeric)
  }, 0)

  return `${prefix}-${String(maxValue + 1).padStart(5, '0')}`
}

function buildRelatedDealValue(record: EntityRecord): string {
  return `${record.id}: ${record.title}`
}

function buildRelatedDocumentValue(record: EntityRecord): string {
  const number = (record.values.number ?? '').trim()
  if (number && record.title.includes(number)) {
    return record.title
  }
  if (number) {
    return `${record.title} (${number})`
  }
  return `${record.id}: ${record.title}`
}

function buildRelatedInvoiceValue(record: EntityRecord): string {
  const number = (record.values.number ?? '').trim()
  if (number && record.title.includes(number)) {
    return record.title
  }
  if (number) {
    return `${record.title} (${number})`
  }
  return `${record.id}: ${record.title}`
}

function buildRelatedPaymentValue(record: EntityRecord): string {
  const amount = formatMoneyString(record.values.amount ?? '')
  return amount ? `${record.title} (${amount})` : `${record.id}: ${record.title}`
}

function buildRelatedPurchaseValue(record: EntityRecord): string {
  return `${record.id}: ${record.title}`
}

function parseInventoryNumber(value: string | undefined): number {
  const normalized = (value ?? '').replace(/\s+/g, '')
  const parsed = Number(normalized)
  return Number.isNaN(parsed) ? Number.NaN : parsed
}

function isInvalidInventoryNumber(value: number): boolean {
  return Number.isNaN(value) || value < 0
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

function EntityListPageContent({ subsystem, tab: rawTab }: EntityListPageContentProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { can, role } = useAuth()
  const { getRecords, createRecord, linkRecords, flushStore } = useEntityStore()
  const storeKey = buildStoreKey(subsystem.slug, rawTab.slug)
  const tab = rawTab
  const createAction = tab.actions.find((action) => action.key === 'create')
  const hasCreateAction = Boolean(createAction)
  const isCarCatalogTab = storeKey === CARS_CATALOG_STORE_KEY
  const isDealsTab = storeKey === DEALS_STORE_KEY
  const isServiceEventsTab = storeKey === 'service/events'
  const isInventoryStockTab = storeKey === 'inventory/stock'
  const isInventoryPurchasesTab = storeKey === 'inventory/purchases'
  const isFinanceInvoicesTab = storeKey === 'finance/invoices'
  const isFinancePaymentsTab = storeKey === 'finance/payments'
  const isFinanceReportsTab = storeKey === 'finance/reports'
  const isFinanceDocumentsTab = storeKey === FINANCE_DOCUMENTS_STORE_KEY
  const hideStatusUi = Boolean(tab.hideStatusUi)
  const records = useMemo(() => resolveEntityRecords(storeKey, getRecords), [getRecords, storeKey])
  const salesDocuments = getRecords(CRM_SALES_DOCUMENTS_STORE_KEY)
  const stockRecords = getRecords(INVENTORY_STOCK_STORE_KEY)
  const purchaseRecords = getRecords(INVENTORY_PURCHASES_STORE_KEY)
  const documentRecords = getRecords(INVENTORY_DOCUMENTS_STORE_KEY)
  const financeInvoiceRecords = getRecords(FINANCE_INVOICES_STORE_KEY)
  const financePaymentRecords = getRecords(FINANCE_PAYMENTS_STORE_KEY)
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
  const [createSelectFilter, setCreateSelectFilter] = useState<Record<string, string>>({})
  const [isCreatePurchaseUnitPriceDirty, setIsCreatePurchaseUnitPriceDirty] = useState(false)
  const [isCreatePaymentAmountDirty, setIsCreatePaymentAmountDirty] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    initialPreferences.visibleColumns.filter((columnKey) =>
      tab.columns.some((column) => column.key === columnKey),
    ),
  )
  const [quickJumpId, setQuickJumpId] = useState('')
  const [jumpError, setJumpError] = useState('')
  const [lastPresetSavedAt, setLastPresetSavedAt] = useState('')

  const getStockTargetRecords = (record: EntityRecord, targetStoreKey: string): EntityRecord[] => {
    const targetRecords =
      targetStoreKey === INVENTORY_DOCUMENTS_STORE_KEY
        ? documentRecords
        : targetStoreKey === FINANCE_INVOICES_STORE_KEY
          ? financeInvoiceRecords
          : targetStoreKey === INVENTORY_PURCHASES_STORE_KEY
            ? purchaseRecords
            : getRecords(targetStoreKey)
    const relatedIds = new Set(
      record.related
        .filter((item) => item.storeKey === targetStoreKey && item.recordId)
        .map((item) => item.recordId as string),
    )

    return targetRecords.filter(
      (targetRecord) =>
        relatedIds.has(targetRecord.id) || targetRecord.values.stockItemId === record.id,
    )
  }

  const getPurchaseRelatedCount = (record: EntityRecord, targetStoreKey: string): number => {
    const targetRecords =
      targetStoreKey === INVENTORY_DOCUMENTS_STORE_KEY
        ? documentRecords
        : targetStoreKey === FINANCE_INVOICES_STORE_KEY
          ? financeInvoiceRecords
          : getRecords(targetStoreKey)
    const relatedIds = new Set(
      record.related
        .filter((item) => item.storeKey === targetStoreKey && item.recordId)
        .map((item) => item.recordId as string),
    )

    return targetRecords.filter(
      (targetRecord) =>
        relatedIds.has(targetRecord.id) || targetRecord.values.purchaseId === record.id,
    ).length
  }

  const getSuggestedPurchaseUnitPrice = useCallback(
    (stockItemId: string) =>
      findLatestInventoryPurchaseUnitPrice(purchaseRecords, stockItemId),
    [purchaseRecords],
  )

  const getSuggestedPaymentAmount = useCallback(
    (invoiceId: string) => {
      const invoiceRecord = financeInvoiceRecords.find((item) => item.id === invoiceId)
      if (!invoiceRecord) {
        return ''
      }

      const availableAmount = getFinanceInvoiceAvailableAmount(invoiceRecord, financePaymentRecords)
      return availableAmount > 0 ? formatMoneyString(String(availableAmount)) : ''
    },
    [financeInvoiceRecords, financePaymentRecords],
  )

  const applyFinancePaymentDraftDefaults = useCallback(
    (
      values: Record<string, string>,
      options: {
        preserveAmount?: boolean
      } = {},
    ) => {
      let next = { ...values }

      if (!next.invoice) {
        const contextualInvoices = getFinanceContextualInvoices(financeInvoiceRecords, next)
        if (contextualInvoices.length === 1) {
          next.invoice = contextualInvoices[0].id
        }
      }

      const invoiceRecord = financeInvoiceRecords.find((item) => item.id === next.invoice)
      if (!invoiceRecord) {
        if (!options.preserveAmount) {
          next.amount = formatMoneyString(next.amount ?? '')
        }
        return next
      }

      next = applyFinancePaymentInvoiceContext(next, invoiceRecord)
      if (!options.preserveAmount) {
        next.amount = getSuggestedPaymentAmount(invoiceRecord.id)
      }
      return next
    },
    [financeInvoiceRecords, getSuggestedPaymentAmount],
  )

  const openCreateModal = useCallback((
    prefillValues: Record<string, string> = {},
    prefillCustomMode: Record<string, boolean> = {},
  ) => {
    const nextFormValues = { ...emptyFormValues, ...prefillValues }
    if (storeKey === INVENTORY_PURCHASES_STORE_KEY) {
      const hasExplicitUnitPrice = Boolean(prefillValues.unitPrice?.trim())
      nextFormValues.quantity = normalizeInventoryPurchaseQuantity(nextFormValues.quantity || '1')
      if (!nextFormValues.unitPrice && nextFormValues.stockItemId) {
        nextFormValues.unitPrice = getSuggestedPurchaseUnitPrice(nextFormValues.stockItemId)
      } else {
        nextFormValues.unitPrice = normalizeInventoryPurchaseUnitPrice(nextFormValues.unitPrice)
      }
      nextFormValues.amount = computeInventoryPurchaseAmount(
        nextFormValues.unitPrice,
        nextFormValues.quantity,
      )
      setIsCreatePurchaseUnitPriceDirty(hasExplicitUnitPrice)
    } else {
      setIsCreatePurchaseUnitPriceDirty(false)
    }
    if (storeKey === FINANCE_PAYMENTS_STORE_KEY) {
      const hasExplicitAmount = Boolean(prefillValues.amount?.trim())
      Object.assign(
        nextFormValues,
        applyFinancePaymentDraftDefaults(nextFormValues, { preserveAmount: hasExplicitAmount }),
      )
      setIsCreatePaymentAmountDirty(hasExplicitAmount)
    } else {
      setIsCreatePaymentAmountDirty(false)
    }
    if (storeKey === INVENTORY_PURCHASES_STORE_KEY && prefillCustomMode.stockItemId) {
      nextFormValues.newStockWarehouse = nextFormValues.newStockWarehouse || DEFAULT_STOCK_WAREHOUSE
      nextFormValues.newStockAvailable = nextFormValues.newStockAvailable || '0'
      nextFormValues.newStockReserved = nextFormValues.newStockReserved || '0'
      nextFormValues.newStockMin = nextFormValues.newStockMin || '0'
    }
    setFormValues(nextFormValues)
    setCreateCustomMode(prefillCustomMode)
    setCreateSelectFilter({})
    setCreateError('')
    setIsCreateOpen(true)
  }, [
    applyFinancePaymentDraftDefaults,
    emptyFormValues,
    getSuggestedPurchaseUnitPrice,
    setCreateCustomMode,
    setCreateError,
    setCreateSelectFilter,
    setFormValues,
    setIsCreateOpen,
  ])

  const closeCreateModal = useCallback(() => {
    setIsCreateOpen(false)
    setIsClientCreateOpen(false)
    setIsCreatePurchaseUnitPriceDirty(false)
    setIsCreatePaymentAmountDirty(false)
  }, [setIsClientCreateOpen, setIsCreateOpen])

  const openClientCreateModal = useCallback(() => {
    setClientCreateVersion((prev) => prev + 1)
    setIsClientCreateOpen(true)
  }, [setClientCreateVersion, setIsClientCreateOpen])

  const openPurchaseCreateFromStock = useCallback((record: EntityRecord) => {
    navigate('/inventory/purchases', {
      state: {
        openCreateForStoreKey: INVENTORY_PURCHASES_STORE_KEY,
        prefillCreateValues: {
          title: buildInventoryPurchaseTitle(record.title),
          stockItemId: record.id,
        },
      } satisfies EntityListNavigationState,
    })
  }, [navigate])

  const openStockRelatedRecords = useCallback((record: EntityRecord, targetStoreKey: string) => {
    const relatedRecords = getStockTargetRecords(record, targetStoreKey)
    if (relatedRecords.length === 1) {
      const path = buildRecordPath(targetStoreKey, relatedRecords[0].id)
      if (path) {
        navigate(path)
        return
      }
    }

    const path = buildStorePath(targetStoreKey)
    if (!path) {
      return
    }

    navigate(path, {
      state: {
        prefillQueryForStoreKey: targetStoreKey,
        prefillQuery: record.id,
      } satisfies EntityListNavigationState,
    })
  }, [getStockTargetRecords, navigate])

  useEffect(() => {
    if (stockRecords.length === 0) {
      return
    }
    void reconcileInventoryStockRecords(stockRecords).catch((error) => {
      console.error('Failed to reconcile inventory stock records', error)
    })
  }, [stockRecords])

  useEffect(() => {
    const state = location.state as EntityListNavigationState | null
    if (!state) {
      return
    }

    let handled = false
    if (state.prefillQueryForStoreKey === storeKey && typeof state.prefillQuery === 'string') {
      setQuery(state.prefillQuery)
      setPage(1)
      handled = true
    }
    if (state.openCreateForStoreKey === storeKey) {
      openCreateModal(state.prefillCreateValues ?? {}, state.prefillCreateCustomMode ?? {})
      handled = true
    }

    if (handled) {
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location.pathname, location.state, navigate, openCreateModal, storeKey])

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

      if (event.key.toLowerCase() === 'n' && hasCreateAction && can('create', storeKey)) {
        event.preventDefault()
        openCreateModal()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [can, hasCreateAction, openCreateModal, storeKey])

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
      if (!hideStatusUi && statusFilter !== 'all' && record.status !== statusFilter) {
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
  const createDeniedReason =
    hasCreateAction && !can('create', storeKey)
      ? getActionDeniedReason(role, 'create', storeKey)
      : ''
  const showTimelineSteps = !hideStatusUi && storeKey !== 'crm-sales/events' && !isServiceEventsTab
  const resolveKanbanStatus = (status: string) => {
    if (isDealsTab && !tab.statuses.some((item) => item.key === status)) {
      return tab.statuses[0]?.key ?? status
    }
    return status
  }
  const isCreatingCustomPurchaseStock = isInventoryPurchasesTab && Boolean(createCustomMode.stockItemId)
  const getFormField = useCallback(
    (fieldKey: string): EntityCreateField | undefined =>
      [...tab.createFields, ...inventoryPurchaseFields, ...inventoryCustomStockFields].find(
        (field) => field.key === fieldKey,
      ),
    [tab.createFields],
  )
  const resolveFieldDisplayLabel = useCallback(
    (record: EntityRecord, key: string, rawValue: string) => {
      const baseField = getFormField(key)
      if (!baseField) {
        return rawValue
      }
      const resolvedField = resolveEntityCreateField(storeKey, baseField)
      if (isStoreReferenceField(resolvedField)) {
        return resolveStoreReferenceLabel(
          resolvedField.optionsSource,
          rawValue,
          getRecords,
          record.values[getReferenceTextFieldKey(key)],
        )
      }
      const option = resolvedField.options?.find((item) => item.value === rawValue)
      return option?.label ?? rawValue
    },
    [getFormField, getRecords, storeKey],
  )

  const formatRecordValue = (record: EntityRecord, key: string, rawValue: string): string => {
    if (key === 'stockItemId') {
      return rawValue && rawValue !== '-'
        ? resolveInventoryStockValue(rawValue, stockRecords)
        : '-'
    }
    if (key === 'quantity') {
      return rawValue && rawValue !== '-'
        ? rawValue
        : normalizeInventoryPurchaseQuantity(record.values.quantity || '1') || '-'
    }
    if (key === 'unitPrice') {
      const derivedUnitPrice =
        rawValue && rawValue !== '-'
          ? rawValue
          : findLatestInventoryPurchaseUnitPrice([record], record.values.stockItemId)
      return derivedUnitPrice ? formatMoneyDisplay(derivedUnitPrice) : '-'
    }
    if (key === 'amount' && isInventoryPurchasesTab) {
      const resolvedAmount =
        rawValue && rawValue !== '-'
          ? rawValue
          : computeInventoryPurchaseAmount(
              record.values.unitPrice || findLatestInventoryPurchaseUnitPrice([record], record.values.stockItemId),
              record.values.quantity || '1',
            )
      return resolvedAmount ? formatMoneyDisplay(resolvedAmount) : '-'
    }
    if (key === 'direction') {
      return formatFinanceInvoiceDirection(rawValue)
    }
    if (
      [
        'paidAmount',
        'incomingIssuedTotal',
        'incomingPaidTotal',
        'outgoingIssuedTotal',
        'outgoingPaidTotal',
        'openInvoiceTotal',
        'reconciledPaymentsTotal',
      ].includes(key)
    ) {
      return formatMoneyDisplay(rawValue || '0')
    }
    if (!rawValue || rawValue === '-') {
      return '-'
    }
    if (['amount', 'price', 'carPrice'].includes(key)) {
      return formatMoneyDisplay(rawValue)
    }
    if (key === 'role') {
      return formatAccessRoleLabel(rawValue)
    }
    return resolveFieldDisplayLabel(record, key, rawValue) || rawValue
  }

  const getStockOpenPurchaseCount = (record: EntityRecord): number =>
    countOpenInventoryPurchases(purchaseRecords, record.id)

  const getRelatedCount = (record: EntityRecord, targetStoreKey: string): number =>
    getStockTargetRecords(record, targetStoreKey).length

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
    if (isInventoryPurchasesTab && fieldKey === 'unitPrice') {
      setIsCreatePurchaseUnitPriceDirty(Boolean(nextValue.trim()))
    }
    if (isFinancePaymentsTab && fieldKey === 'amount') {
      setIsCreatePaymentAmountDirty(Boolean(nextValue.trim()))
    }
    setFormValues((prev) => {
      const companionBaseKey = isReferenceTextFieldKey(fieldKey)
        ? fieldKey.slice(0, -4)
        : ''
      const baseField = getFormField(companionBaseKey || fieldKey)
      const resolvedBaseField = baseField ? resolveEntityCreateField(storeKey, baseField) : undefined
      let next =
        companionBaseKey && resolvedBaseField && isStoreReferenceField(resolvedBaseField)
          ? setStoreReferenceCustomText(prev, companionBaseKey, nextValue)
          : resolvedBaseField && isStoreReferenceField(resolvedBaseField)
            ? setStoreReferenceRecordId(prev, fieldKey, nextValue)
            : { ...prev, [fieldKey]: nextValue }
      if (isCarCatalogTab) {
        if (fieldKey === 'brand' && !isCarModelValidForBrand(next.brand ?? '', next.model ?? '')) {
          next.model = ''
          setCreateCustomMode((customPrev) => ({ ...customPrev, model: false }))
          setCreateSelectFilter((filterPrev) => ({ ...filterPrev, model: '' }))
        }
        next.title = buildCarTitle(next.brand ?? '', next.model ?? '', next.year ?? '')
      }
      if (
        storeKey === DEALS_STORE_KEY &&
        (fieldKey === DEAL_VIN_FIELD_KEY || companionBaseKey === DEAL_VIN_FIELD_KEY)
      ) {
        const enriched = enrichDealValuesWithCarInfo(next, getRecords(DEAL_CARS_STORE_KEY))
        return prefillDealAmountFromCarInfo(prev, enriched)
      }
      if (isInventoryPurchasesTab) {
        if (fieldKey === 'stockItemId') {
          const stockRecord = stockRecords.find((item) => item.id === nextValue)
          if (stockRecord && !prev.title.trim()) {
            next.title = buildInventoryPurchaseTitle(stockRecord.title)
          }
          if (!isCreatePurchaseUnitPriceDirty) {
            next.unitPrice = getSuggestedPurchaseUnitPrice(nextValue)
          }
        }
        if (fieldKey === 'quantity') {
          next.quantity = normalizeInventoryPurchaseQuantity(nextValue)
        }
        if (fieldKey === 'unitPrice') {
          next.unitPrice = normalizeInventoryPurchaseUnitPrice(nextValue)
        }
        next.amount = computeInventoryPurchaseAmount(next.unitPrice, next.quantity)
      }
      if (isFinancePaymentsTab) {
        const preserveAmount =
          fieldKey === 'amount'
            ? Boolean(nextValue.trim())
            : isCreatePaymentAmountDirty
        next = applyFinancePaymentDraftDefaults(next, { preserveAmount })
      }
      return next
    })
  }

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const selectedStockRecord = stockRecords.find((record) => record.id === formValues.stockItemId)
    const derivedPurchaseTitle = isInventoryPurchasesTab
      ? buildInventoryPurchaseTitle(
          isCreatingCustomPurchaseStock
            ? (formValues.newStockTitle ?? '').trim()
            : selectedStockRecord?.title ?? '',
        )
      : ''
    const requiredField = tab.createFields.find((field) => {
      if (!field.required) {
        return false
      }
      if (field.key === 'title' && derivedPurchaseTitle) {
        return false
      }
      if (field.key === 'stockItemId' && isCreatingCustomPurchaseStock) {
        return false
      }
      if (isInventoryPurchasesTab && field.key === 'amount') {
        return false
      }
      return !formValues[field.key]?.trim()
    })

    if (requiredField) {
      setCreateError(`Поле "${requiredField.label}" обязательно`)
      return
    }

    if (isCreatingCustomPurchaseStock) {
      const newStockTitle = (formValues.newStockTitle ?? '').trim()
      const newStockSku = (formValues.newStockSku ?? '').trim().toUpperCase()
      const newStockWarehouse = (formValues.newStockWarehouse ?? '').trim()
      const newStockAvailable = Number(formValues.newStockAvailable ?? '0')
      const newStockReserved = Number(formValues.newStockReserved ?? '0')
      const newStockMin = Number(formValues.newStockMin ?? '0')

      if (!newStockTitle || !newStockSku || !newStockWarehouse) {
        setCreateError('Для нового товара заполните название, SKU и склад.')
        return
      }
      if ([newStockAvailable, newStockReserved, newStockMin].some((value) => Number.isNaN(value) || value < 0)) {
        setCreateError('Остаток, резерв и минимальный остаток должны быть неотрицательными числами.')
        return
      }
      if (newStockReserved > newStockAvailable) {
        setCreateError('Резерв не может превышать доступный остаток.')
        return
      }
    }

    const subtitleField = tab.createFields.find((field) => field.key !== 'title')
    const subtitleValue = subtitleField ? formValues[subtitleField.key] : ''
    let subtitle = subtitleValue?.trim() || `Карточка ${tab.entityName}`
    if (storeKey === 'service/appointments') {
      const appointmentDate = (formValues.date ?? '').trim()
      const appointmentClient = resolveStoreReferenceLabel(
        {
          type: 'store',
          storeKey: 'crm-sales/clients',
          valueKey: 'id',
          labelKey: 'title',
        },
        formValues.client ?? '',
        getRecords,
        formValues.clientText,
      )
      const summary = [appointmentDate, appointmentClient].filter(Boolean).join(' • ')
      subtitle = summary || `Карточка ${tab.entityName}`
    }
    let values = Object.fromEntries(
      Object.entries(formValues).filter(([key]) => key !== 'title' && key !== 'subtitle'),
    )
    for (const transientKey of [
      'newStockTitle',
      'newStockSku',
      'newStockWarehouse',
      'newStockAvailable',
      'newStockReserved',
      'newStockMin',
    ]) {
      delete values[transientKey]
    }

    if (isInventoryStockTab) {
      values.reserved = (values.reserved ?? '').trim() || '0'
      const available = parseInventoryNumber(values.available)
      const reserved = parseInventoryNumber(values.reserved)
      const minimum = parseInventoryNumber(values.min)
      if ([available, reserved, minimum].some(isInvalidInventoryNumber)) {
        setCreateError('Остаток, резерв и минимальный остаток должны быть неотрицательными числами.')
        return
      }
      if (reserved > available) {
        setCreateError('Резерв не может превышать доступный остаток.')
        return
      }
      const warehouse = (values.warehouse ?? '').trim()
      subtitle = warehouse ? `Склад: ${warehouse}` : `Карточка ${tab.entityName}`
    }

    const phoneValue = (values.phone ?? '').trim()
    if (phoneValue) {
      const normalized = normalizePhoneStrict(phoneValue)
      if (!normalized.ok) {
        setCreateError('Неверный формат телефона. Используйте +7 9XX XXXXXXX.')
        return
      }
      values.phone = normalized.formatted
    }

    if (isCarCatalogTab) {
      const normalizedVIN = normalizeVIN(values[VIN_FIELD_KEY] ?? '')
      if (!normalizedVIN) {
        setCreateError('VIN обязателен для каталога автомобилей')
        return
      }
      if (!isCarModelValidForBrand(values.brand ?? '', values.model ?? '')) {
        setCreateError('Модель должна соответствовать выбранной марке.')
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
      if (values.price) {
        values.price = formatMoneyString(values.price)
      }
    }

    if (storeKey === DEALS_STORE_KEY) {
      values = enrichDealValuesWithCarInfo(values, getRecords(DEAL_CARS_STORE_KEY))
    }

    if (isInventoryPurchasesTab) {
      values = normalizeInventoryPurchaseValues(values)
      const quantity = Number(values.quantity ?? '0')
      if (!values.quantity || Number.isNaN(quantity) || quantity <= 0) {
        setCreateError('Количество должно быть больше нуля.')
        return
      }
      if (values.unitPrice === '') {
        setCreateError('Цена за штуку обязательна.')
        return
      }
    }

    if (isFinanceInvoicesTab) {
      values = normalizeFinanceInvoiceValues(values)
      if (!values.amount || Number(values.amount.replace(/\s+/g, '')) <= 0) {
        setCreateError('Сумма счета должна быть больше нуля.')
        return
      }
      subtitle = buildFinanceInvoiceSubtitle(values, getRecords)
    }

    let selectedFinanceInvoice: EntityRecord | undefined
    if (isFinancePaymentsTab) {
      values = normalizeFinancePaymentValues(values)
      const invoiceRecord = financeInvoiceRecords.find((item) => item.id === values.invoice)
      if (!invoiceRecord) {
        setCreateError('Выберите существующий счет для платежа.')
        return
      }
      if (invoiceRecord.status !== 'issued') {
        setCreateError('Платеж можно создать только по выставленному счету.')
        return
      }
      if (!canFinancePaymentFitInvoice(invoiceRecord, financePaymentRecords, values.amount)) {
        setCreateError('Сумма платежа превышает доступный остаток по счету.')
        return
      }
      values = applyFinancePaymentInvoiceContext(values, invoiceRecord)
      selectedFinanceInvoice = invoiceRecord
      subtitle = buildFinancePaymentSubtitle(values)
    }

    if (isFinanceReportsTab) {
      subtitle = buildFinanceReportSubtitle(values)
    }

    if (isFinanceDocumentsTab) {
      values.source = 'Финансы'
      subtitle = buildFinanceDocumentSubtitle(values, getRecords)
    }

    if (storeKey === PLATFORM_USERS_STORE_KEY) {
      values = normalizePlatformUserValues(values)
      subtitle = buildPlatformUserSubtitle(values, getRecords) || `Карточка ${tab.entityName}`
    }

    if (storeKey === PLATFORM_ROLES_STORE_KEY) {
      subtitle = buildPlatformRoleSubtitle(values) || `Карточка ${tab.entityName}`
    }

    let createdStockRecord = selectedStockRecord
    if (isCreatingCustomPurchaseStock) {
      const stockValues = {
        sku: (formValues.newStockSku ?? '').trim().toUpperCase(),
        available: String(parseInventoryNumber(formValues.newStockAvailable ?? '0')),
        reserved: String(parseInventoryNumber(formValues.newStockReserved ?? '0')),
        min: String(parseInventoryNumber(formValues.newStockMin ?? '0')),
        warehouse: (formValues.newStockWarehouse ?? '').trim() || DEFAULT_STOCK_WAREHOUSE,
      }
      try {
        await upsertInventoryStockValues(
          stockValues,
          `draft:${stockValues.sku}@${stockValues.warehouse}`,
        )
      } catch (error) {
        setCreateError(
          error instanceof Error
            ? error.message
            : 'Не удалось синхронизировать новую складскую позицию с inventory-stock.',
        )
        return
      }
      createdStockRecord = createRecord({
        storeKey: INVENTORY_STOCK_STORE_KEY,
        idPrefix: 'STK',
        initialStatus: computeInventoryStockStatusFromValues(stockValues),
        title: (formValues.newStockTitle ?? '').trim(),
        subtitle: `Склад: ${stockValues.warehouse}`,
        values: stockValues,
        createdHistoryText: 'Товар создан автоматически из формы закупки.',
      })
      values.stockItemId = createdStockRecord.id
    }

    if (isInventoryPurchasesTab) {
      const stockLabel = createdStockRecord
        ? buildInventoryStockReference(createdStockRecord)
        : resolveInventoryStockValue(values.stockItemId ?? '', stockRecords)
      const supplier = (values.supplier ?? '').trim()
      const parts = [supplier ? `Поставщик: ${supplier}` : '', stockLabel !== '-' ? stockLabel : '']
      subtitle = parts.filter(Boolean).join(' • ') || `Карточка ${tab.entityName}`
    }

    const title = isCarCatalogTab
      ? buildCarTitle(values.brand ?? '', values.model ?? '', values.year ?? '') || `Новый ${tab.entityName}`
      : formValues.title?.trim() || derivedPurchaseTitle || `Новый ${tab.entityName}`
    const initialStatus = isInventoryStockTab
      ? computeInventoryStockStatusFromValues(values)
      : tab.statuses[0].key

    if (isInventoryStockTab) {
      try {
        await upsertInventoryStockValues(
          values,
          `draft:${values.sku ?? ''}@${values.warehouse ?? ''}`,
        )
      } catch (error) {
        setCreateError(
          error instanceof Error
            ? error.message
            : 'Не удалось синхронизировать складскую позицию с inventory-stock.',
        )
        return
      }
    }

    const created = createRecord({
      storeKey,
      idPrefix: tab.idPrefix,
      initialStatus,
      title,
      subtitle,
      values,
      createdHistoryText:
        isInventoryPurchasesTab && isCreatingCustomPurchaseStock
          ? 'Закупка создана вместе с новой складской позицией.'
          : undefined,
    })

    if (storeKey === DEALS_STORE_KEY) {
      const contractNumber = buildNextNumber(salesDocuments, 'CTR')
      const invoiceNumber = buildNextNumber(financeInvoiceRecords, 'INV')
      const managerOwnerLabel = resolvePlatformUserLabel(
        created.values.manager ?? '',
        getRecords,
        created.values.managerText,
      ).trim()
      const contract = createRecord({
        storeKey: CRM_SALES_DOCUMENTS_STORE_KEY,
        idPrefix: 'DOC',
        initialStatus: 'draft',
        title: `Договор ${contractNumber}`,
        subtitle: `Сделка ${created.id}`,
        values: {
          number: contractNumber,
          docType: 'Договор',
          owner: managerOwnerLabel || 'Менеджер',
          client: created.values.client ?? '',
        },
        createdHistoryText: 'Договор создан автоматически после формирования сделки',
      })
      const invoice = createRecord({
        storeKey: FINANCE_INVOICES_STORE_KEY,
        idPrefix: 'INV',
        initialStatus: 'issued',
        title: `Исходящий счет ${invoiceNumber}`,
        subtitle: buildFinanceInvoiceSubtitle({
          counterparty: created.values.client ?? '',
          direction: 'outgoing',
          dealId: created.id,
        }, getRecords),
        values: {
          number: invoiceNumber,
          counterparty: created.values.client ?? '',
          direction: 'outgoing',
          amount: formatMoneyString(created.values.amount ?? ''),
          paidAmount: '0',
          dueDate: '',
          owner: managerOwnerLabel || DEFAULT_FINANCE_OWNER,
          dealId: created.id,
        },
        createdHistoryText: `Исходящий счет создан автоматически из сделки ${created.id}.`,
      })
      const invoiceValue = buildRelatedInvoiceValue(invoice)

      linkRecords({
        left: {
          storeKey,
          recordId: created.id,
          label: 'Связанный документ',
          value: buildRelatedDocumentValue(contract),
        },
        right: {
          storeKey: CRM_SALES_DOCUMENTS_STORE_KEY,
          recordId: contract.id,
          label: 'Связанная сделка',
          value: buildRelatedDealValue(created),
        },
      })

      linkRecords({
        left: {
          storeKey,
          recordId: created.id,
          label: 'Счет',
          value: invoiceValue,
        },
        right: {
          storeKey: FINANCE_INVOICES_STORE_KEY,
          recordId: invoice.id,
          label: 'Сделка',
          value: buildRelatedDealValue(created),
        },
      })

      linkRecords({
        left: {
          storeKey: CRM_SALES_DOCUMENTS_STORE_KEY,
          recordId: contract.id,
          label: 'Счет',
          value: invoiceValue,
        },
        right: {
          storeKey: FINANCE_INVOICES_STORE_KEY,
          recordId: invoice.id,
          label: 'Договор',
          value: buildRelatedDocumentValue(contract),
        },
      })
    }

    if (isInventoryPurchasesTab && createdStockRecord) {
      const supplier = (created.values.supplier ?? '').trim()
      const documentNumber = buildNextNumber(documentRecords, 'WH')
      const invoiceNumber = buildNextNumber(financeInvoiceRecords, 'INV')
      const stockValue = buildInventoryStockReference(createdStockRecord)
      const purchaseValue = buildRelatedPurchaseValue(created)

      const waybill = createRecord({
        storeKey: INVENTORY_DOCUMENTS_STORE_KEY,
        idPrefix: 'ID',
        initialStatus: 'expected',
        title: `Накладная ${documentNumber}`,
        subtitle: supplier ? `Поставка от ${supplier}` : `Закупка ${created.id}`,
        values: {
          number: documentNumber,
          supplier,
          owner: DEFAULT_STOCK_OWNER,
          purchaseId: created.id,
          stockItemId: createdStockRecord.id,
        },
        createdHistoryText: `Накладная создана автоматически из закупки ${created.id}.`,
      })

      const invoice = createRecord({
        storeKey: FINANCE_INVOICES_STORE_KEY,
        idPrefix: 'INV',
        initialStatus: 'issued',
        title: `Входящий счет ${invoiceNumber}`,
        subtitle: buildFinanceInvoiceSubtitle(
          {
            counterparty: '',
            counterpartyText: supplier,
            direction: 'incoming',
            purchaseId: created.id,
            stockItemId: createdStockRecord.id,
          },
          getRecords,
        ),
        values: {
          number: invoiceNumber,
          counterparty: '',
          counterpartyText: supplier,
          direction: 'incoming',
          amount: created.values.amount ?? '',
          paidAmount: '0',
          dueDate: created.values.eta ?? '',
          owner: DEFAULT_FINANCE_OWNER,
          purchaseId: created.id,
          stockItemId: createdStockRecord.id,
        },
        createdHistoryText: `Входящий счет создан автоматически из закупки ${created.id}.`,
      })

      const documentValue = buildRelatedDocumentValue(waybill)
      const invoiceValue = buildRelatedInvoiceValue(invoice)

      linkRecords({
        left: {
          storeKey: INVENTORY_STOCK_STORE_KEY,
          recordId: createdStockRecord.id,
          label: 'Закупка',
          value: purchaseValue,
        },
        right: {
          storeKey,
          recordId: created.id,
          label: 'Товар',
          value: stockValue,
        },
      })

      linkRecords({
        left: {
          storeKey,
          recordId: created.id,
          label: 'Накладная',
          value: documentValue,
        },
        right: {
          storeKey: INVENTORY_DOCUMENTS_STORE_KEY,
          recordId: waybill.id,
          label: 'Закупка',
          value: purchaseValue,
        },
      })

      linkRecords({
        left: {
          storeKey,
          recordId: created.id,
          label: 'Счет поставщика',
          value: invoiceValue,
        },
        right: {
          storeKey: FINANCE_INVOICES_STORE_KEY,
          recordId: invoice.id,
          label: 'Закупка',
          value: purchaseValue,
        },
      })

      linkRecords({
        left: {
          storeKey: INVENTORY_DOCUMENTS_STORE_KEY,
          recordId: waybill.id,
          label: 'Счет поставщика',
          value: invoiceValue,
        },
        right: {
          storeKey: FINANCE_INVOICES_STORE_KEY,
          recordId: invoice.id,
          label: 'Накладная',
          value: documentValue,
        },
      })

      linkRecords({
        left: {
          storeKey: INVENTORY_STOCK_STORE_KEY,
          recordId: createdStockRecord.id,
          label: 'Накладная',
          value: documentValue,
        },
        right: {
          storeKey: INVENTORY_DOCUMENTS_STORE_KEY,
          recordId: waybill.id,
          label: 'Товар',
          value: stockValue,
        },
      })

      linkRecords({
        left: {
          storeKey: INVENTORY_STOCK_STORE_KEY,
          recordId: createdStockRecord.id,
          label: 'Счет поставщика',
          value: invoiceValue,
        },
        right: {
          storeKey: FINANCE_INVOICES_STORE_KEY,
          recordId: invoice.id,
          label: 'Товар',
          value: stockValue,
        },
      })
    }

    if (isFinancePaymentsTab && selectedFinanceInvoice) {
      const paymentValue = buildRelatedPaymentValue(created)
      const invoiceValue = buildRelatedInvoiceValue(selectedFinanceInvoice)

      linkRecords({
        left: {
          storeKey,
          recordId: created.id,
          label: 'Счет',
          value: invoiceValue,
        },
        right: {
          storeKey: FINANCE_INVOICES_STORE_KEY,
          recordId: selectedFinanceInvoice.id,
          label: 'Платеж',
          value: paymentValue,
        },
      })

      for (const item of selectedFinanceInvoice.related) {
        if (!item.storeKey || !item.recordId) {
          continue
        }

        linkRecords({
          left: {
            storeKey,
            recordId: created.id,
            label: item.label,
            value: item.value,
          },
          right: {
            storeKey: item.storeKey,
            recordId: item.recordId,
            label: 'Платеж',
            value: paymentValue,
          },
        })
      }
    }

    try {
      await flushStore()
    } catch {
      setCreateError('Не удалось сохранить запись. Повторите попытку.')
      return
    }

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
    const isStoreReference = isStoreReferenceField(resolvedField)
    const value = formValues[field.key] ?? ''
    const customText = isStoreReference ? formValues[getReferenceTextFieldKey(field.key)] ?? '' : ''
    const isDealClientField = storeKey === DEALS_STORE_KEY && field.key === 'client'
    const isInventoryPurchaseAmountField = isInventoryPurchasesTab && field.key === 'amount'
    const isInventoryPurchaseNumericField =
      isInventoryPurchasesTab && (field.key === 'quantity' || field.key === 'unitPrice')

    if (isInventoryPurchaseAmountField) {
      return (
        <label key={field.key} className="field">
          <span>
            {field.label}
            {field.required ? ' *' : ''}
          </span>
          <input value={formatMoneyDisplay(value) || ''} placeholder={field.placeholder} readOnly />
        </label>
      )
    }

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
            onChange={(event) => applyCreateFieldValue(field.key, event.target.value)}
          />
        </label>
      )
    }

    if (resolvedField.inputType === 'month') {
      const monthValue =
        storeKey === FINANCE_REPORTS_STORE_KEY && field.key === 'period'
          ? financeReportPeriodToMonthInputValue(value)
          : value
      return (
        <label key={field.key} className="field">
          <span>
            {field.label}
            {field.required ? ' *' : ''}
          </span>
          <input
            type="month"
            value={monthValue}
            onChange={(event) =>
              applyCreateFieldValue(
                field.key,
                storeKey === FINANCE_REPORTS_STORE_KEY && field.key === 'period'
                  ? financeReportPeriodFromMonthInputValue(event.target.value)
                  : event.target.value,
              )
            }
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
            onChange={(event) => applyCreateFieldValue(field.key, event.target.value)}
            placeholder={field.placeholder}
            inputMode={isInventoryPurchaseNumericField ? 'numeric' : undefined}
          />
        </label>
      )
    }

    const options = resolveEntityFieldOptions({
      storeKey,
      field: resolvedField,
      getRecords,
      currentValue: value,
      formValues,
    })
    const filterValue = createSelectFilter[field.key] ?? ''
    const filteredOptions = filterValue
      ? options.filter((option) => option.label.toLowerCase().includes(filterValue.toLowerCase()))
      : options
    const hasMatchingOption = options.some((item) => item.value === value)
    const allowInlineCustom = !isDealClientField
    const isCustom =
      resolvedField.allowCustom &&
      allowInlineCustom &&
      (createCustomMode[field.key] ||
        (isStoreReference ? Boolean(customText.trim()) : value.trim() !== '' && !hasMatchingOption))
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
          const previousText = prev[getReferenceTextFieldKey(field.key)] ?? ''
          const previousIsKnown = options.some((item) => item.value === previous)
          const next =
            isStoreReference
              ? setStoreReferenceCustomText(
                  prev,
                  field.key,
                  previousIsKnown ? previousText : previousText || previous,
                )
              : { ...prev, [field.key]: previousIsKnown ? '' : previous }
          if (isInventoryPurchasesTab && field.key === 'stockItemId') {
            next.newStockWarehouse = next.newStockWarehouse || DEFAULT_STOCK_WAREHOUSE
            next.newStockAvailable = next.newStockAvailable || '0'
            next.newStockReserved = next.newStockReserved || '0'
            next.newStockMin = next.newStockMin || '0'
          }
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
          let next = isStoreReference
            ? setStoreReferenceRecordId(prev, field.key, nextValue)
            : { ...prev, [field.key]: nextValue }
          next = enrichDealValuesWithCarInfo(next, getRecords(DEAL_CARS_STORE_KEY))
          next = prefillDealAmountFromCarInfo(prev, next)
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
        <input
          type="search"
          value={filterValue}
          onChange={(event) =>
            setCreateSelectFilter((prev) => ({ ...prev, [field.key]: event.target.value }))
          }
          placeholder="Поиск..."
        />
        <select value={selectValue} onChange={(event) => handleSelectChange(event.target.value)}>
          <option value="">{resolvedField.emptyOptionLabel}</option>
          {filteredOptions.map((option) => (
            <option key={`${field.key}-${option.value}`} value={option.value}>
              {option.label}
            </option>
          ))}
          {resolvedField.allowCustom ? (
            <option value={CUSTOM_SELECT_OPTION_VALUE}>Свой вариант...</option>
          ) : null}
        </select>
        {isCustom ? (
          isInventoryPurchasesTab && field.key === 'stockItemId' ? (
            <p className="hint-row">Новый товар будет создан ниже и сразу привязан к закупке.</p>
          ) : (
            <input
              value={isStoreReference ? customText : value}
              onChange={(event) => {
                setCreateCustomMode((prev) => ({ ...prev, [field.key]: true }))
                applyCreateFieldValue(
                  isStoreReference ? getReferenceTextFieldKey(field.key) : field.key,
                  event.target.value,
                )
              }}
              placeholder={field.placeholder}
            />
          )
        ) : null}
      </label>
    )
  }

  const renderEmptyState = (title: string, description: string, showCreateButton = false) => (
        <article className="empty-state">
      <h4>{title}</h4>
      <p>{description}</p>
      <div className="empty-state__actions">
        {showCreateButton && hasCreateAction && can('create', storeKey) ? (
          <button className="btn-primary btn-primary--sm" onClick={() => openCreateModal()}>
            {createAction?.label ?? 'Создать'}
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
            {!hideStatusUi ? <th>Статус</th> : null}
            {isInventoryStockTab ? <th>Действия</th> : null}
          </tr>
        </thead>
        <tbody>
          {pageItems.map((record) => {
            const status = getStatusDefinition(tab, record.status) ?? tab.statuses[0]
            const purchaseCount = isInventoryStockTab ? getStockOpenPurchaseCount(record) : 0
            const documentCount = isInventoryStockTab
              ? getRelatedCount(record, INVENTORY_DOCUMENTS_STORE_KEY)
              : 0
            const invoiceCount = isInventoryStockTab
              ? getRelatedCount(record, FINANCE_INVOICES_STORE_KEY)
              : 0
            return (
              <tr key={record.id}>
                <td>{record.id}</td>
                <td>
                  <Link to={`/${subsystem.slug}/${tab.slug}/${record.id}`} className="table-link">
                    {record.title}
                  </Link>
                  <p className="table-link__subtitle">{record.subtitle}</p>
                  {isInventoryStockTab ? (
                    <p className="table-link__subtitle">
                      Открытых закупок: {purchaseCount} • Накладных: {documentCount} • Счетов: {invoiceCount}
                    </p>
                  ) : null}
                </td>
                {selectedColumns.map((column) => {
                  const rawValue = record.values[column.key] ?? '-'
                  const formattedValue = formatRecordValue(record, column.key, String(rawValue))
                  return <td key={`${record.id}-${column.key}`}>{formattedValue}</td>
                })}
                {!hideStatusUi ? (
                  <td>
                    <StatusBadge label={status.label} tone={status.tone} />
                  </td>
                ) : null}
                {isInventoryStockTab ? (
                  <td>
                    <div className="table-actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => openPurchaseCreateFromStock(record)}
                      >
                        Создать закупку
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => openStockRelatedRecords(record, INVENTORY_DOCUMENTS_STORE_KEY)}
                        disabled={documentCount === 0}
                        title={documentCount === 0 ? 'Связанных накладных пока нет' : ''}
                      >
                        Накладные
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => openStockRelatedRecords(record, FINANCE_INVOICES_STORE_KEY)}
                        disabled={invoiceCount === 0}
                        title={invoiceCount === 0 ? 'Связанных счетов пока нет' : ''}
                      >
                        Счета
                      </button>
                    </div>
                  </td>
                ) : null}
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
            <span>{filtered.filter((record) => resolveKanbanStatus(record.status) === status.key).length}</span>
          </header>
          <div className="kanban-cards">
            {filtered
              .filter((record) => resolveKanbanStatus(record.status) === status.key)
              .map((record) => (
                <Link
                  key={record.id}
                  to={`/${subsystem.slug}/${tab.slug}/${record.id}`}
                  className="kanban-card"
                >
                  {isDealsTab ? (
                    <>
                      <p className="kanban-card__title">{record.title}</p>
                      <p>Клиент: {record.values.client ?? '-'}</p>
                      <p>VIN: {record.values.vin ?? '-'}</p>
                      <p>Сумма: {formatMoneyDisplay(record.values.amount ?? '') || '-'}</p>
                      <p>Статус: {getStatusDefinition(tab, record.status)?.label ?? record.status}</p>
                    </>
                  ) : (
                    <>
                      <strong>{record.id}</strong>
                      <p>{record.title}</p>
                      <small>{record.subtitle}</small>
                      {isInventoryPurchasesTab ? (
                        <>
                          <p>Товар: {formatRecordValue(record, 'stockItemId', record.values.stockItemId ?? '-')}</p>
                          <p>Поставщик: {record.values.supplier ?? '-'}</p>
                          <p>Кол-во: {formatRecordValue(record, 'quantity', record.values.quantity ?? '-')}</p>
                          <p>Цена: {formatRecordValue(record, 'unitPrice', record.values.unitPrice ?? '-')}</p>
                          <p>Сумма: {formatRecordValue(record, 'amount', record.values.amount ?? '-')}</p>
                          <p>ETA: {record.values.eta ?? '-'}</p>
                          <p>
                            Документы: {getPurchaseRelatedCount(record, INVENTORY_DOCUMENTS_STORE_KEY)} • Счета:{' '}
                            {getPurchaseRelatedCount(record, FINANCE_INVOICES_STORE_KEY)}
                          </p>
                        </>
                      ) : null}
                    </>
                  )}
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
              {!isServiceEventsTab ? <StatusBadge label={currentStatus.label} tone={currentStatus.tone} /> : null}
            </div>
            <p className="timeline-card__title">{record.title}</p>
            {showTimelineSteps ? (
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
            ) : null}
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
        {hasCreateAction && can('create', storeKey) ? (
          <button className="btn-primary btn-primary--sm" onClick={() => openCreateModal()}>
            {createAction?.label ?? 'Создать'}
          </button>
        ) : hasCreateAction ? (
            <button className="btn-disabled" title={createDeniedReason} disabled>
              Создание недоступно
            </button>
          ) : null}
        </div>
      </header>

      <>
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
        {!hideStatusUi ? (
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
        ) : null}
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
      </>

      {isCreateOpen && hasCreateAction ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal">
            <header className="modal__head">
              <h4>{createAction?.label ?? 'Создать'}</h4>
              <button className="btn-ghost" onClick={closeCreateModal}>
                Закрыть
              </button>
            </header>

            <form className="modal__body modal__body--grid" onSubmit={submitCreate}>
              {isInventoryPurchasesTab
                ? tab.createFields
                    .filter(
                      (field) =>
                        !(isCarCatalogTab && field.key === 'title') &&
                        field.key !== 'amount' &&
                        field.key !== 'eta',
                    )
                    .map((field) => renderCreateField(field))
                : tab.createFields
                    .filter((field) => !(isCarCatalogTab && field.key === 'title'))
                    .map((field) => renderCreateField(field))}
              {isInventoryPurchasesTab ? inventoryPurchaseFields.map((field) => renderCreateField(field)) : null}
              {isInventoryPurchasesTab
                ? tab.createFields
                    .filter((field) => field.key === 'eta')
                    .map((field) => renderCreateField(field))
                : null}
              {isCreatingCustomPurchaseStock ? (
                <>
                  <p className="hint-row">
                    Новый товар создается вместе с закупкой. Статус остатка рассчитается автоматически.
                  </p>
                  {inventoryCustomStockFields.map((field) => renderCreateField(field))}
                </>
              ) : null}
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
          setFormValues((prev) => setStoreReferenceRecordId(prev, 'client', client.id))
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
  const { getLandingPath } = useAuth()

  if (!subsystem) {
    return <Navigate to={getLandingPath()} replace />
  }

  if (!tab) {
    return <Navigate to={`/${subsystem.slug}`} replace />
  }

  return <EntityListPageContent key={`${subsystem.slug}/${tab.slug}`} subsystem={subsystem} tab={tab} />
}
