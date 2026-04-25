import { synchronizeCarStatuses } from './carStatusSync'
import { DEALS_STORE_KEY } from './dealCarInfo'
import {
  applyFinancePaymentInvoiceContext,
  buildFinanceInvoiceState,
  buildFinanceInvoiceSubtitle,
  buildFinancePaymentSubtitle,
  FINANCE_DOCUMENTS_STORE_KEY,
  FINANCE_INVOICES_STORE_KEY,
  FINANCE_PAYMENTS_STORE_KEY,
  FINANCE_REPORTS_STORE_KEY,
  inferFinanceReportType,
} from './finance'
import { resolveEntityCreateField } from './fieldOptions'
import {
  getReferenceTextFieldKey,
  isStoreReferenceField,
  matchStoreReferenceRecords,
} from './entityReferences'
import {
  INVENTORY_DOCUMENTS_STORE_KEY,
  INVENTORY_PURCHASES_STORE_KEY,
  INVENTORY_STOCK_STORE_KEY,
} from './inventory'
import { buildStoreKey, type EntityRecord } from './model'
import {
  buildPlatformRoleSubtitle,
  buildPlatformRoleValues,
  buildPlatformUserSubtitle,
  PLATFORM_ROLES_STORE_KEY,
  PLATFORM_ROLE_ADMIN_ID,
  PLATFORM_ROLE_ANALYST_ID,
  PLATFORM_ROLE_MECHANIC_ID,
  PLATFORM_ROLE_SALES_ID,
  PLATFORM_USERS_STORE_KEY,
  normalizePlatformUserValues,
  resolvePlatformUserLabel,
} from './platform'
import { getRoleByRecordId, isAccessRole } from './rbac'
import { seedData } from './seedData'
import { subsystems } from './subsystems'

export type EntityStoreSnapshot = Record<string, EntityRecord[]>

type MigrationStep = {
  key: string
  migrate: (store: EntityStoreSnapshot) => EntityStoreSnapshot
}

const SALES_DOCUMENTS_STORE_KEY = 'crm-sales/documents'
const DEFAULT_FINANCE_OWNER = 'Финансовый отдел'

const PLATFORM_USER_BUSINESS_ROLE_TEXT_KEY = getReferenceTextFieldKey('businessRoleId')

const LEGACY_PLATFORM_ROLE_ID_MAPPINGS: Record<string, string> = {
  'RLB-4101': PLATFORM_ROLE_SALES_ID,
  'RLB-4102': PLATFORM_ROLE_ANALYST_ID,
  'RLB-4104': PLATFORM_ROLE_MECHANIC_ID,
  'RLB-4105': PLATFORM_ROLE_MECHANIC_ID,
  sales_manager: PLATFORM_ROLE_SALES_ID,
  finance_accountant: PLATFORM_ROLE_ANALYST_ID,
  legacy_operator: '',
}

type StoreReferenceField = {
  storeKey: string
  fieldKey: string
  sourceStoreKey: string
  sourceValueKey: string
  sourceLabelKey?: string
}

const storeReferenceFields: StoreReferenceField[] = subsystems.flatMap((subsystem) =>
  subsystem.tabs.flatMap((tab) =>
    tab.createFields.flatMap((field) => {
      const resolvedField = resolveEntityCreateField(buildStoreKey(subsystem.slug, tab.slug), field)
      if (!isStoreReferenceField(resolvedField)) {
        return []
      }

      return [
        {
          storeKey: buildStoreKey(subsystem.slug, tab.slug),
          fieldKey: field.key,
          sourceStoreKey: resolvedField.optionsSource.storeKey,
          sourceValueKey: resolvedField.optionsSource.valueKey,
          sourceLabelKey: resolvedField.optionsSource.labelKey,
        },
      ]
    }),
  ),
)

function cloneStore(store: EntityStoreSnapshot): EntityStoreSnapshot {
  return structuredClone(store)
}

function buildStoreGetter(store: EntityStoreSnapshot) {
  return (storeKey: string) => store[storeKey] ?? []
}

function historyId(): string {
  return `h-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
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

function buildRelatedItem(
  ownRecordId: string,
  label: string,
  value: string,
  storeKey: string,
  recordId: string,
) {
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

function upsertRelatedRecord(
  entity: EntityRecord,
  label: string,
  value: string,
  storeKey: string,
  recordId: string,
): EntityRecord {
  if (hasRelatedRecord(entity, storeKey, recordId)) {
    return entity
  }

  return {
    ...entity,
    related: [buildRelatedItem(entity.id, label, value, storeKey, recordId), ...entity.related],
  }
}

function buildFinanceRelatedValue(record: EntityRecord): string {
  const number = (record.values.number ?? '').trim()
  if (number && record.title.includes(number)) {
    return record.title
  }
  if (number) {
    return `${record.title} (${number})`
  }
  return `${record.id}: ${record.title}`
}

function buildDealRelatedValue(record: EntityRecord): string {
  return `${record.id}: ${record.title}`
}

function isInventoryInvoiceRecord(record: EntityRecord): boolean {
  return Boolean(record.values.purchaseId || record.values.stockItemId)
}

function shouldResetInventoryData(store: EntityStoreSnapshot): boolean {
  const stockRecords = store[INVENTORY_STOCK_STORE_KEY] ?? []
  const purchaseRecords = store[INVENTORY_PURCHASES_STORE_KEY] ?? []
  const documentRecords = store[INVENTORY_DOCUMENTS_STORE_KEY] ?? []

  if (stockRecords.some((record) => record.status === 'closed')) {
    return true
  }

  if (
    purchaseRecords.some(
      (record) =>
        record.status === 'received' ||
        !record.values.quantity?.trim() ||
        !record.values.unitPrice?.trim(),
    )
  ) {
    return true
  }

  return documentRecords.some((record) => record.status === 'active')
}

function applyInventorySeedReset(store: EntityStoreSnapshot): EntityStoreSnapshot {
  const next = cloneStore(store)

  next[INVENTORY_STOCK_STORE_KEY] = structuredClone(seedData[INVENTORY_STOCK_STORE_KEY] ?? [])
  next[INVENTORY_PURCHASES_STORE_KEY] = structuredClone(seedData[INVENTORY_PURCHASES_STORE_KEY] ?? [])
  next[INVENTORY_DOCUMENTS_STORE_KEY] = structuredClone(seedData[INVENTORY_DOCUMENTS_STORE_KEY] ?? [])

  const preservedInvoices = (next[FINANCE_INVOICES_STORE_KEY] ?? []).filter(
    (record) => !isInventoryInvoiceRecord(record),
  )
  const inventoryInvoices = (seedData[FINANCE_INVOICES_STORE_KEY] ?? []).filter(
    isInventoryInvoiceRecord,
  )

  next[FINANCE_INVOICES_STORE_KEY] = [...preservedInvoices, ...structuredClone(inventoryInvoices)]
  return next
}

function shouldResetFinanceData(store: EntityStoreSnapshot): boolean {
  const invoiceRecords = store[FINANCE_INVOICES_STORE_KEY] ?? []
  const reportRecords = store[FINANCE_REPORTS_STORE_KEY] ?? []

  if ((store['finance/cars'] ?? []).length > 0) {
    return true
  }

  if (
    invoiceRecords.some(
      (record) =>
        ['draft', 'partially_paid', 'closed', 'overdue'].includes(record.status) ||
        !record.values.direction?.trim() ||
        record.values.paidAmount === undefined,
    )
  ) {
    return true
  }

  return reportRecords.some(
    (record) =>
      record.status === 'sent' ||
      record.values.openInvoiceTotal === undefined ||
      record.values.reconciledPaymentsTotal === undefined,
  )
}

function applyFinanceSeedReset(store: EntityStoreSnapshot): EntityStoreSnapshot {
  const next = cloneStore(store)
  next[FINANCE_INVOICES_STORE_KEY] = structuredClone(seedData[FINANCE_INVOICES_STORE_KEY] ?? [])
  next[FINANCE_PAYMENTS_STORE_KEY] = structuredClone(seedData[FINANCE_PAYMENTS_STORE_KEY] ?? [])
  next[FINANCE_REPORTS_STORE_KEY] = structuredClone(seedData[FINANCE_REPORTS_STORE_KEY] ?? [])
  next[FINANCE_DOCUMENTS_STORE_KEY] = structuredClone(seedData[FINANCE_DOCUMENTS_STORE_KEY] ?? [])
  delete next['finance/cars']
  return next
}

function normalizePlatformUserStatus(status: string): string {
  return status === 'disabled' || status === 'suspended' ? 'disabled' : 'active'
}

function mapLegacyPlatformRoleId(value: string): string {
  const trimmedValue = value.trim()
  if (!trimmedValue) {
    return ''
  }
  if (getRoleByRecordId(trimmedValue)) {
    return trimmedValue
  }
  return LEGACY_PLATFORM_ROLE_ID_MAPPINGS[trimmedValue] ?? ''
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase()
}

function mapLegacyRoleName(value: string): string {
  const normalized = normalizeToken(value)
  if (!normalized) {
    return ''
  }
  if (normalized === 'admin' || normalized === 'administrator' || normalized === 'администратор') {
    return PLATFORM_ROLE_ADMIN_ID
  }
  if (
    normalized === 'sales' ||
    normalized === 'менеджер-консультант' ||
    normalized === 'продажник'
  ) {
    return PLATFORM_ROLE_SALES_ID
  }
  if (
    normalized === 'mechanic' ||
    normalized === 'механик' ||
    normalized === 'сервис-консультант' ||
    normalized === 'оператор склада'
  ) {
    return PLATFORM_ROLE_MECHANIC_ID
  }
  if (
    normalized === 'analyst' ||
    normalized === 'accountant' ||
    normalized === 'аналитик' ||
    normalized === 'бухгалтер'
  ) {
    return PLATFORM_ROLE_ANALYST_ID
  }
  return mapLegacyPlatformRoleId(value)
}

function mapLegacyDepartment(department: string): string {
  const normalized = normalizeToken(department)
  if (!normalized) {
    return ''
  }
  if (normalized === 'продажи') {
    return PLATFORM_ROLE_SALES_ID
  }
  if (normalized === 'сервис' || normalized === 'склад' || normalized === 'сервис и склад') {
    return PLATFORM_ROLE_MECHANIC_ID
  }
  if (normalized === 'финансы') {
    return PLATFORM_ROLE_ANALYST_ID
  }
  return ''
}

function normalizeLegacyBusinessRoleId(value: string): string {
  return mapLegacyPlatformRoleId(value) || mapLegacyRoleName(value)
}

function deriveBusinessRoleId(values: Record<string, string>): string {
  const explicitBusinessRoleId = normalizeLegacyBusinessRoleId(values.businessRoleId ?? '')
  if (explicitBusinessRoleId) {
    return explicitBusinessRoleId
  }

  const legacyRoleName = mapLegacyRoleName(values.role ?? '')
  if (legacyRoleName) {
    return legacyRoleName
  }

  const legacyAccessRole = (values.accessRole ?? '').trim()
  if (isAccessRole(legacyAccessRole)) {
    return legacyAccessRole === 'administrator'
      ? PLATFORM_ROLE_ADMIN_ID
      : legacyAccessRole === 'sales'
        ? PLATFORM_ROLE_SALES_ID
        : legacyAccessRole === 'mechanic'
          ? PLATFORM_ROLE_MECHANIC_ID
          : PLATFORM_ROLE_ANALYST_ID
  }
  if (legacyAccessRole === 'admin') {
    return PLATFORM_ROLE_ADMIN_ID
  }
  if (legacyAccessRole === 'accountant') {
    return PLATFORM_ROLE_ANALYST_ID
  }
  if (legacyAccessRole === 'manager') {
    return mapLegacyDepartment(values.department ?? '')
  }
  if (legacyAccessRole === 'viewer') {
    return mapLegacyDepartment(values.department ?? '')
  }

  return mapLegacyDepartment(values.department ?? '')
}

function normalizePlatformUserRecord(
  user: EntityRecord,
  getRoleRecords: ReturnType<typeof buildStoreGetter>,
): EntityRecord {
  const normalizedBusinessRoleId = deriveBusinessRoleId(user.values)
  const fallbackRoleText = [
    user.values[PLATFORM_USER_BUSINESS_ROLE_TEXT_KEY] ?? '',
    user.values.role ?? '',
  ]
    .map((value) => value.trim())
    .find(Boolean)
  const nextValues = normalizePlatformUserValues({
    ...user.values,
    businessRoleId: normalizedBusinessRoleId,
    [PLATFORM_USER_BUSINESS_ROLE_TEXT_KEY]:
      normalizedBusinessRoleId ? '' : fallbackRoleText || 'Требует назначения роли',
  })

  return {
    ...user,
    status: normalizePlatformUserStatus(user.status),
    subtitle: buildPlatformUserSubtitle(nextValues, getRoleRecords) || user.subtitle,
    values: nextValues,
  }
}

function normalizePlatformStore(store: EntityStoreSnapshot): EntityStoreSnapshot {
  const next = cloneStore(store)
  const canonicalRoles = structuredClone(seedData[PLATFORM_ROLES_STORE_KEY] ?? [])
  next[PLATFORM_ROLES_STORE_KEY] = canonicalRoles

  const roleStoreSnapshot = {
    ...next,
    [PLATFORM_ROLES_STORE_KEY]: canonicalRoles,
  }
  const getRoleRecords = buildStoreGetter(roleStoreSnapshot)
  const normalizedUsers = (next[PLATFORM_USERS_STORE_KEY] ?? []).map((user) =>
    normalizePlatformUserRecord(user, getRoleRecords),
  )

  const existingUserIds = new Set(normalizedUsers.map((user) => user.id))
  const existingUserTitles = new Set(
    normalizedUsers
      .map((user) => user.title.trim().toLowerCase())
      .filter(Boolean),
  )
  const seedServiceUsers = structuredClone(seedData[PLATFORM_USERS_STORE_KEY] ?? []).filter(
    (user) =>
      normalizePlatformUserStatus(user.status) === 'active' &&
      (user.values.businessRoleId ?? '').trim() === PLATFORM_ROLE_MECHANIC_ID,
  )
  for (const seedUser of seedServiceUsers) {
    const normalizedSeedUser = normalizePlatformUserRecord(seedUser, getRoleRecords)
    const normalizedTitle = normalizedSeedUser.title.trim().toLowerCase()
    if (
      existingUserIds.has(normalizedSeedUser.id) ||
      (normalizedTitle && existingUserTitles.has(normalizedTitle))
    ) {
      continue
    }

    normalizedUsers.push(normalizedSeedUser)
    existingUserIds.add(normalizedSeedUser.id)
    if (normalizedTitle) {
      existingUserTitles.add(normalizedTitle)
    }
  }

  const usersByRoleId = normalizedUsers.reduce<Map<string, number>>((map, user) => {
    const businessRoleId = (user.values.businessRoleId ?? '').trim()
    if (!businessRoleId) {
      return map
    }
    map.set(businessRoleId, (map.get(businessRoleId) ?? 0) + 1)
    return map
  }, new Map())

  next[PLATFORM_USERS_STORE_KEY] = normalizedUsers
  next[PLATFORM_ROLES_STORE_KEY] = canonicalRoles.map((role) => {
    const nextValues = buildPlatformRoleValues(role.id, usersByRoleId.get(role.id) ?? 0)
    return {
      ...role,
      status: 'active',
      subtitle: buildPlatformRoleSubtitle(nextValues) || role.subtitle,
      values: nextValues,
    }
  })

  return next
}

function migrateStoreReferenceValues(store: EntityStoreSnapshot): EntityStoreSnapshot {
  const next = cloneStore(store)
  const getRecords = buildStoreGetter(next)

  for (const field of storeReferenceFields) {
    const textKey = getReferenceTextFieldKey(field.fieldKey)
    next[field.storeKey] = (next[field.storeKey] ?? []).map((record) => {
      const currentValue = (record.values[field.fieldKey] ?? '').trim()
      const currentText = (record.values[textKey] ?? '').trim()
      if (!currentValue) {
        return record
      }

      const matches = matchStoreReferenceRecords(
        {
          type: 'store',
          storeKey: field.sourceStoreKey,
          valueKey: field.sourceValueKey,
          labelKey: field.sourceLabelKey,
        },
        currentValue,
        getRecords,
      )

      if (matches.length === 1) {
        const matchedRecord = matches[0]
        return {
          ...record,
          values: {
            ...record.values,
            [field.fieldKey]: matchedRecord.id,
            [textKey]: '',
          },
        }
      }

      return {
        ...record,
        values: {
          ...record.values,
          [field.fieldKey]: '',
          [textKey]: currentText || currentValue,
        },
      }
    })
  }

  return next
}

function normalizeFinanceStore(store: EntityStoreSnapshot): EntityStoreSnapshot {
  const next = cloneStore(store)
  const invoiceRecords = next[FINANCE_INVOICES_STORE_KEY] ?? []
  const paymentRecords = next[FINANCE_PAYMENTS_STORE_KEY] ?? []
  const dealRecords = next[DEALS_STORE_KEY] ?? []
  const salesDocumentRecords = next[SALES_DOCUMENTS_STORE_KEY] ?? []
  const getRecords = buildStoreGetter(next)

  const normalizedInvoices: EntityRecord[] = invoiceRecords.map((invoice): EntityRecord => {
    const relatedDealId =
      invoice.related.find((item) => item.storeKey === DEALS_STORE_KEY && item.recordId)?.recordId ?? ''
    const relatedPurchaseId =
      invoice.related.find((item) => item.storeKey === INVENTORY_PURCHASES_STORE_KEY && item.recordId)
        ?.recordId ?? ''
    const nextInvoice = {
      ...invoice,
      values: {
        ...invoice.values,
        direction: (invoice.values.direction ?? '').trim() || 'outgoing',
        dealId: (invoice.values.dealId ?? '').trim() || relatedDealId,
        purchaseId: (invoice.values.purchaseId ?? '').trim() || relatedPurchaseId,
      },
    }
    const nextState = buildFinanceInvoiceState(
      {
        ...nextInvoice,
        status: invoice.status === 'draft' ? 'issued' : invoice.status,
      },
      paymentRecords,
    )
    const nextValues = {
      ...nextInvoice.values,
      paidAmount: nextState.paidAmount,
    }

    return {
      ...nextInvoice,
      status: nextState.status,
      subtitle: buildFinanceInvoiceSubtitle(nextValues, getRecords),
      values: nextValues,
    }
  })

  const invoiceById = new Map(normalizedInvoices.map((invoice) => [invoice.id, invoice]))
  const normalizedPayments: EntityRecord[] = paymentRecords.map((payment): EntityRecord => {
    const invoiceRecord = invoiceById.get((payment.values.invoice ?? '').trim())
    const nextValues = applyFinancePaymentInvoiceContext(payment.values, invoiceRecord)
    return {
      ...payment,
      subtitle: buildFinancePaymentSubtitle(nextValues),
      values: nextValues,
    }
  })

  next[FINANCE_PAYMENTS_STORE_KEY] = normalizedPayments

  const dealIdByInvoiceId = new Map<string, string>()
  const purchaseIdByInvoiceId = new Map<string, string>()

  const hydratedInvoices: EntityRecord[] = normalizedInvoices.map((invoice): EntityRecord => {
    let nextInvoice: EntityRecord = invoice
    const dealId = (invoice.values.dealId ?? '').trim()
    const purchaseId = (invoice.values.purchaseId ?? '').trim()

    if (dealId) {
      dealIdByInvoiceId.set(invoice.id, dealId)
      const dealRecord = dealRecords.find((deal) => deal.id === dealId)
      nextInvoice = upsertRelatedRecord(
        nextInvoice,
        'Сделка',
        dealRecord ? buildDealRelatedValue(dealRecord) : dealId,
        DEALS_STORE_KEY,
        dealId,
      )
    }
    if (purchaseId) {
      purchaseIdByInvoiceId.set(invoice.id, purchaseId)
      nextInvoice = upsertRelatedRecord(
        nextInvoice,
        'Закупка',
        purchaseId,
        INVENTORY_PURCHASES_STORE_KEY,
        purchaseId,
      )
    }

    return nextInvoice
  })

  const finalInvoices: EntityRecord[] = [...hydratedInvoices]
  const invoiceIdsByDealId = new Map<string, string>()
  for (const invoice of hydratedInvoices) {
    const dealId = (invoice.values.dealId ?? '').trim()
    if (dealId) {
      invoiceIdsByDealId.set(dealId, invoice.id)
    }
  }

  const nextDeals = dealRecords.map((deal) => {
    const existingInvoiceId = invoiceIdsByDealId.get(deal.id)
    if (existingInvoiceId) {
      const existingInvoice = finalInvoices.find((invoice) => invoice.id === existingInvoiceId)
      return upsertRelatedRecord(
        deal,
        'Счет',
        existingInvoice ? buildFinanceRelatedValue(existingInvoice) : existingInvoiceId,
        FINANCE_INVOICES_STORE_KEY,
        existingInvoiceId,
      )
    }

    const nextInvoiceId = nextId(finalInvoices, 'INV')
    const nextInvoiceValues = {
      number: nextInvoiceId,
      counterparty: deal.values.client ?? '',
      counterpartyText: deal.values.clientText ?? '',
      direction: 'outgoing',
      amount: deal.values.amount ?? '',
      paidAmount: '0',
      dueDate: '',
      owner:
        resolvePlatformUserLabel(
          deal.values.manager ?? '',
          getRecords,
          deal.values.managerText,
        ).trim() || DEFAULT_FINANCE_OWNER,
      dealId: deal.id,
    }
    const nextInvoice: EntityRecord = {
      id: nextInvoiceId,
      title: `Исходящий счет ${nextInvoiceId}`,
      subtitle: buildFinanceInvoiceSubtitle(nextInvoiceValues, getRecords),
      status: 'issued',
      values: nextInvoiceValues,
      history: [
        {
          id: historyId(),
          at: new Date().toLocaleString('ru-RU'),
          text: `Счет добавлен миграцией для сделки ${deal.id}.`,
        },
      ],
      related: [
        buildRelatedItem(nextInvoiceId, 'Сделка', buildDealRelatedValue(deal), DEALS_STORE_KEY, deal.id),
      ],
    }

    finalInvoices.unshift(nextInvoice)
    invoiceIdsByDealId.set(deal.id, nextInvoice.id)

    const linkedDeal = upsertRelatedRecord(
      deal,
      'Счет',
      buildFinanceRelatedValue(nextInvoice),
      FINANCE_INVOICES_STORE_KEY,
      nextInvoice.id,
    )

    const relatedContract = salesDocumentRecords.find(
      (document) =>
        document.values.docType === 'Договор' &&
        document.related.some((item) => item.storeKey === DEALS_STORE_KEY && item.recordId === deal.id),
    )
    if (relatedContract) {
      nextInvoice.related.unshift(
        buildRelatedItem(
          nextInvoice.id,
          'Договор',
          buildFinanceRelatedValue(relatedContract),
          SALES_DOCUMENTS_STORE_KEY,
          relatedContract.id,
        ),
      )
    }

    return linkedDeal
  })

  const nextSalesDocuments = salesDocumentRecords.map((document) => {
    const relatedDeal = document.related.find(
      (item) => item.storeKey === DEALS_STORE_KEY && item.recordId,
    )
    if (!relatedDeal?.recordId || document.values.docType !== 'Договор') {
      return document
    }

    const invoiceId = invoiceIdsByDealId.get(relatedDeal.recordId)
    if (!invoiceId) {
      return document
    }

    const invoiceRecord = finalInvoices.find((invoice) => invoice.id === invoiceId)
    if (!invoiceRecord) {
      return document
    }

    return upsertRelatedRecord(
      document,
      'Счет',
      buildFinanceRelatedValue(invoiceRecord),
      FINANCE_INVOICES_STORE_KEY,
      invoiceId,
    )
  })

  const nextPayments = normalizedPayments.map((payment) => {
    const invoiceId = (payment.values.invoice ?? '').trim()
    const invoiceRecord = finalInvoices.find((invoice) => invoice.id === invoiceId)
    let nextPayment = payment
    if (invoiceRecord) {
      nextPayment = upsertRelatedRecord(
        nextPayment,
        'Счет',
        buildFinanceRelatedValue(invoiceRecord),
        FINANCE_INVOICES_STORE_KEY,
        invoiceRecord.id,
      )
    }

    const dealId = (nextPayment.values.dealId ?? '').trim() || dealIdByInvoiceId.get(invoiceId) || ''
    if (dealId) {
      const dealRecord = nextDeals.find((deal) => deal.id === dealId)
      nextPayment = upsertRelatedRecord(
        nextPayment,
        'Сделка',
        dealRecord ? buildDealRelatedValue(dealRecord) : dealId,
        DEALS_STORE_KEY,
        dealId,
      )
    }

    const purchaseId =
      (nextPayment.values.purchaseId ?? '').trim() || purchaseIdByInvoiceId.get(invoiceId) || ''
    if (purchaseId) {
      nextPayment = upsertRelatedRecord(
        nextPayment,
        'Закупка',
        purchaseId,
        INVENTORY_PURCHASES_STORE_KEY,
        purchaseId,
      )
    }

    return nextPayment
  })

  next[FINANCE_INVOICES_STORE_KEY] = finalInvoices
  next[FINANCE_PAYMENTS_STORE_KEY] = nextPayments
  next[DEALS_STORE_KEY] = nextDeals
  next[SALES_DOCUMENTS_STORE_KEY] = nextSalesDocuments

  return next
}

function normalizeFinanceReportTypes(store: EntityStoreSnapshot): EntityStoreSnapshot {
  const next = cloneStore(store)
  next[FINANCE_REPORTS_STORE_KEY] = (next[FINANCE_REPORTS_STORE_KEY] ?? []).map((report) => ({
    ...report,
    values: {
      ...report.values,
      type: inferFinanceReportType(report.values.type, report.title),
    },
  }))
  return next
}

export const entityStoreMigrationSteps: MigrationStep[] = [
  {
    key: 'inventory-seed-reset',
    migrate: (store) => (shouldResetInventoryData(store) ? applyInventorySeedReset(store) : store),
  },
  {
    key: 'finance-seed-reset',
    migrate: (store) => (shouldResetFinanceData(store) ? applyFinanceSeedReset(store) : store),
  },
  {
    key: 'platform-normalization',
    migrate: normalizePlatformStore,
  },
  {
    key: 'reference-id-migration',
    migrate: migrateStoreReferenceValues,
  },
  {
    key: 'finance-normalization',
    migrate: normalizeFinanceStore,
  },
  {
    key: 'finance-report-type-normalization',
    migrate: normalizeFinanceReportTypes,
  },
  {
    key: 'car-status-sync',
    migrate: synchronizeCarStatuses,
  },
]

export function migrateEntityStore(store: EntityStoreSnapshot): EntityStoreSnapshot {
  return entityStoreMigrationSteps.reduce((currentStore, step) => step.migrate(currentStore), store)
}
