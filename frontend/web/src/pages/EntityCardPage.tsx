import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'

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
  resolveStoreReferenceRecord,
  resolveStoreReferencePath,
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
  buildFinanceInvoiceState,
  buildFinanceInvoiceSubtitle,
  buildFinancePaymentSubtitle,
  buildFinanceReportSubtitle,
  buildFinanceReportValuesFromSummary,
  canCancelFinanceInvoice,
  canFinancePaymentFitInvoice,
  CRM_SALES_DOCUMENTS_STORE_KEY,
  financeReportPeriodFromMonthInputValue,
  financeReportPeriodToMonthInputValue,
  FINANCE_DOCUMENTS_STORE_KEY,
  FINANCE_INVOICES_STORE_KEY,
  FINANCE_PAYMENTS_STORE_KEY,
  FINANCE_REPORTS_STORE_KEY,
  formatFinanceInvoiceDirection,
  getFinanceDocumentSourceRecord,
  getFinanceInvoiceAmount,
  getFinanceInvoiceAvailableAmount,
  getFinancePaymentAmount,
  inferFinanceReportType,
  isFinanceReportPeriod,
  isFinanceDocumentProxyRecord,
  isFinanceInternalFieldKey,
  normalizeFinanceInvoiceValues,
  normalizeFinancePaymentValues,
  resolveEntityRecord,
} from '../domain/finance'
import { downloadFinanceReport, exportFinanceReport } from '../domain/financeReportingApi'
import { formatMoneyString, normalizePhoneStrict } from '../domain/formatters'
import {
  buildInventoryPurchaseTitle,
  canCancelInventoryPurchase,
  computeInventoryPurchaseAmount,
  computeInventoryStockStatusFromValues,
  findInventoryPurchaseDocument,
  findInventoryPurchaseInvoice,
  findLatestInventoryPurchaseUnitPrice,
  getInventoryPurchaseQuantity,
  getInventoryPurchaseUnitPrice,
  INVENTORY_DOCUMENTS_STORE_KEY,
  INVENTORY_PURCHASE_RECEIVED_STATUS,
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
} from '../domain/platform'
import {
  applyWorkorderPartDraftLinePreview,
  buildInventoryStockProjection,
  closeServiceWorkorder,
  buildServiceWorkorderSyncPayload,
  buildWorkorderPartsStatusNote,
  createEmptyWorkorderPartDraftLine,
  ensureServiceWorkorder,
  fetchInventoryStockBySKU,
  fetchWorkorderPartsPlan,
  resolveServiceWorkorderClosePreparation,
  normalizeWorkorderPartDraftLines,
  prepareWorkorderPartPlanLines,
  resolveWorkorderPartTitle,
  saveWorkorderPartsPlan,
  toDraftWorkorderPartLines,
  updateServiceWorkorderStatus,
  writeoffWorkorderParts,
  type WorkorderPartDraftLine,
  type WorkorderPartPlanLine,
  type WorkorderPartsWriteoffResponse,
  type ServiceWorkorderRecord,
} from '../domain/serviceWorkorderParts'
import {
  buildStoreKey,
  type ActionKey,
  type EntityCreateField,
  type EntityRecord,
  type EntityStoreKey,
  type EntityTabDefinition,
  type SubsystemDefinition,
} from '../domain/model'
import { getAvailableActions, getStatusDefinition, isClosedStatus } from '../domain/selectors'
import { downloadSalesDocument, generateSalesDocument } from '../domain/salesDocumentsApi'
import { getSubsystemBySlug } from '../domain/subsystems'
import { formatAccessRoleLabel, getActionDeniedReason } from '../domain/rbac'

const CARS_CATALOG_STORE_KEY = 'crm-sales/cars'
const CLIENTS_STORE_SOURCE = {
  type: 'store',
  storeKey: 'crm-sales/clients',
  valueKey: 'id',
  labelKey: 'title',
} as const
const SERVICE_ORDERS_STORE_KEY = 'service/orders'
const VIN_FIELD_KEY = 'vin'
const SALES_DOCUMENT_PDF_ID_FIELD = 'salesPdfDocumentId'
const SALES_DOCUMENT_PDF_DOWNLOAD_URL_FIELD = 'salesPdfDownloadUrl'
const SALES_DOCUMENT_PDF_FILE_NAME_FIELD = 'salesPdfFileName'
const SALES_DOCUMENT_PDF_GENERATED_AT_FIELD = 'salesPdfGeneratedAt'

type EntityCardNavigationState = {
  openCreateForStoreKey?: string
  prefillCreateValues?: Record<string, string>
  prefillCreateCustomMode?: Record<string, boolean>
  prefillQueryForStoreKey?: string
  prefillQuery?: string
}

const inventoryPurchaseFields: EntityCreateField[] = [
  { key: 'quantity', label: 'Количество', placeholder: '1', required: true },
  { key: 'unitPrice', label: 'Цена за штуку', placeholder: '17 000', required: true },
  { key: 'amount', label: 'Сумма', placeholder: 'Рассчитывается автоматически' },
]

function normalizeVIN(value: string): string {
  return value.trim().toUpperCase()
}

function formatMoneyDisplay(value: string): string {
  const formatted = formatMoneyString(value)
  return formatted || value
}

function parseInventoryNumber(value: string | undefined): number {
  const normalized = (value ?? '').replace(/\s+/g, '')
  const parsed = Number(normalized)
  return Number.isNaN(parsed) ? Number.NaN : parsed
}

function buildRecordPath(storeKey?: string, recordId?: string): string | null {
  if (!storeKey || !recordId) {
    return null
  }
  const [subsystemSlug, tabSlug] = storeKey.split('/')
  if (!subsystemSlug || !tabSlug) {
    return null
  }
  return `/${subsystemSlug}/${tabSlug}/${recordId}`
}

function buildStorePath(storeKey?: string): string | null {
  if (!storeKey) {
    return null
  }
  const [subsystemSlug, tabSlug] = storeKey.split('/')
  if (!subsystemSlug || !tabSlug) {
    return null
  }
  return `/${subsystemSlug}/${tabSlug}`
}

function buildRelatedRecordPath(item: EntityRecord['related'][number]): string | null {
  return buildRecordPath(item.storeKey, item.recordId)
}

function isDealTechnicalValueKey(key: string): boolean {
  return key.startsWith('car')
}

function isSalesDocumentTechnicalValueKey(key: string): boolean {
  return [
    SALES_DOCUMENT_PDF_ID_FIELD,
    SALES_DOCUMENT_PDF_DOWNLOAD_URL_FIELD,
    SALES_DOCUMENT_PDF_FILE_NAME_FIELD,
    SALES_DOCUMENT_PDF_GENERATED_AT_FIELD,
  ].includes(key)
}

function findRelatedRecordId(record: EntityRecord, targetStoreKey: string): string {
  return (
    record.related.find((item) => item.storeKey === targetStoreKey && item.recordId?.trim())?.recordId?.trim() ??
    ''
  )
}

type CardPanel = 'details' | 'history' | 'related'

type ActionState = {
  key: ActionKey
  label: string
  nextStatus?: string
  critical?: boolean
  disabled: boolean
  reason: string
}

type EntityCardViewProps = {
  subsystem: SubsystemDefinition
  tab: EntityTabDefinition
  storeKey: EntityStoreKey
  record: EntityRecord
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function EntityCardView({ subsystem, tab: rawTab, storeKey, record }: EntityCardViewProps) {
  const navigate = useNavigate()
  const { can, role } = useAuth()
  const { createRecord, updateRecord, updateStatus, deleteRecord, getRecords } = useEntityStore()
  const tab = rawTab
  const currentStatus = getStatusDefinition(tab, record.status) ?? tab.statuses[0]
  const isDealCard = storeKey === DEALS_STORE_KEY
  const isCarCatalogCard = storeKey === CARS_CATALOG_STORE_KEY
  const isServiceOrderCard = storeKey === SERVICE_ORDERS_STORE_KEY
  const isInventoryStockCard = storeKey === INVENTORY_STOCK_STORE_KEY
  const isInventoryPurchasesCard = storeKey === INVENTORY_PURCHASES_STORE_KEY
  const isFinanceInvoicesCard = storeKey === FINANCE_INVOICES_STORE_KEY
  const isFinancePaymentsCard = storeKey === FINANCE_PAYMENTS_STORE_KEY
  const isFinanceReportsCard = storeKey === FINANCE_REPORTS_STORE_KEY
  const isFinanceDocumentsCard = storeKey === FINANCE_DOCUMENTS_STORE_KEY
  const isSalesDocumentCard = storeKey === CRM_SALES_DOCUMENTS_STORE_KEY
  const isFinanceDocumentProxyCard = isFinanceDocumentsCard && isFinanceDocumentProxyRecord(record)
  const hideCardStatusBadge = Boolean(tab.hideStatusUi)
  const readOnly = ((!tab.hideStatusUi && isClosedStatus(tab, record.status)) || isFinanceDocumentProxyCard)
  const stockRecords = getRecords(INVENTORY_STOCK_STORE_KEY)
  const purchaseRecords = getRecords(INVENTORY_PURCHASES_STORE_KEY)
  const documentRecords = getRecords(INVENTORY_DOCUMENTS_STORE_KEY)
  const financeInvoiceRecords = getRecords(FINANCE_INVOICES_STORE_KEY)
  const financePaymentRecords = getRecords(FINANCE_PAYMENTS_STORE_KEY)
  const carRecords = getRecords(DEAL_CARS_STORE_KEY)

  const [activePanel, setActivePanel] = useState<CardPanel>('details')
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isClientCreateOpen, setIsClientCreateOpen] = useState(false)
  const [clientCreateVersion, setClientCreateVersion] = useState(0)
  const [editError, setEditError] = useState('')
  const [editTitle, setEditTitle] = useState(record.title)
  const [editSubtitle, setEditSubtitle] = useState(record.subtitle)
  const [editValues, setEditValues] = useState<Record<string, string>>(record.values)
  const [editCustomMode, setEditCustomMode] = useState<Record<string, boolean>>({})
  const [editSelectFilter, setEditSelectFilter] = useState<Record<string, string>>({})
  const [isEditPurchaseUnitPriceDirty, setIsEditPurchaseUnitPriceDirty] = useState(false)
  const [partsLines, setPartsLines] = useState<WorkorderPartDraftLine[]>(() => [
    createEmptyWorkorderPartDraftLine(),
  ])
  const [isPartsLoading, setIsPartsLoading] = useState(false)
  const [isPartsSaving, setIsPartsSaving] = useState(false)
  const [isPartsWriteoffRunning, setIsPartsWriteoffRunning] = useState(false)
  const [isServiceOrderClosing, setIsServiceOrderClosing] = useState(false)
  const [isPartsDirty, setIsPartsDirty] = useState(false)
  const [partsError, setPartsError] = useState('')
  const [partsNotice, setPartsNotice] = useState('')
  const [isReportGenerating, setIsReportGenerating] = useState(false)
  const [isReportDownloading, setIsReportDownloading] = useState(false)
  const [isSalesDocumentDownloading, setIsSalesDocumentDownloading] = useState(false)
  const [reportActionError, setReportActionError] = useState('')
  const [salesDocumentActionError, setSalesDocumentActionError] = useState('')
  const fieldLabelMap = new Map(
    [...tab.createFields, ...tab.columns].map((field) => [field.key, field.label]),
  )
  const getFormField = useCallback(
    (fieldKey: string): EntityCreateField | undefined =>
      [...tab.createFields, ...inventoryPurchaseFields].find((field) => field.key === fieldKey),
    [tab.createFields],
  )
  const getStockTargetRecords = useCallback((targetStoreKey: string): EntityRecord[] => {
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
  }, [documentRecords, financeInvoiceRecords, getRecords, purchaseRecords, record.id, record.related])

  const getSuggestedPurchaseUnitPrice = useCallback(
    (stockItemId: string, excludedRecordId?: string) =>
      findLatestInventoryPurchaseUnitPrice(purchaseRecords, stockItemId, excludedRecordId),
    [purchaseRecords],
  )

  const openPurchaseCreate = useCallback(() => {
    navigate('/inventory/purchases', {
      state: {
        openCreateForStoreKey: INVENTORY_PURCHASES_STORE_KEY,
        prefillCreateValues: {
          title: buildInventoryPurchaseTitle(record.title),
          stockItemId: record.id,
        },
      } satisfies EntityCardNavigationState,
    })
  }, [navigate, record.id, record.title])

  const openStockRelatedRecords = useCallback((targetStoreKey: string) => {
    const relatedRecords = getStockTargetRecords(targetStoreKey)
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
      } satisfies EntityCardNavigationState,
    })
  }, [getStockTargetRecords, navigate, record.id])

  const stockDocumentCount = isInventoryStockCard
    ? getStockTargetRecords(INVENTORY_DOCUMENTS_STORE_KEY).length
    : 0
  const stockInvoiceCount = isInventoryStockCard
    ? getStockTargetRecords(FINANCE_INVOICES_STORE_KEY).length
    : 0
  const stockOpenPurchaseCount = isInventoryStockCard
    ? purchaseRecords.filter(
        (purchase) =>
          purchase.values.stockItemId === record.id &&
          purchase.status !== 'closed' &&
          purchase.status !== 'cancelled',
      ).length
    : 0

  const relatedPurchaseDocument = isInventoryPurchasesCard
    ? findInventoryPurchaseDocument(documentRecords, record.id)
    : undefined
  const relatedPurchaseInvoice = isInventoryPurchasesCard
    ? findInventoryPurchaseInvoice(financeInvoiceRecords, record.id)
    : undefined
  const financeDocumentSource = isFinanceDocumentProxyCard
    ? getFinanceDocumentSourceRecord(record)
    : null
  const workorderPartOptions = Array.from(
    stockRecords.reduce((accumulator, stockRecord) => {
      const sku = (stockRecord.values.sku ?? '').trim().toUpperCase()
      if (!sku || accumulator.has(sku)) {
        return accumulator
      }
      accumulator.set(sku, {
        sku,
        title: stockRecord.title,
      })
      return accumulator
    }, new Map<string, { sku: string; title: string }>()),
  )
    .map(([, value]) => value)
    .sort((left, right) => left.sku.localeCompare(right.sku))

  const syncFinanceInvoiceFromPayments = useCallback(
    (invoiceId: string, nextPaymentRecords: EntityRecord[], note: string) => {
      const invoiceRecord = financeInvoiceRecords.find((item) => item.id === invoiceId)
      if (!invoiceRecord) {
        return
      }

      const nextState = buildFinanceInvoiceState(invoiceRecord, nextPaymentRecords)
      updateRecord({
        storeKey: FINANCE_INVOICES_STORE_KEY,
        recordId: invoiceRecord.id,
        title: invoiceRecord.title,
        subtitle: buildFinanceInvoiceSubtitle({
          ...invoiceRecord.values,
          paidAmount: nextState.paidAmount,
        }, getRecords),
        values: {
          ...invoiceRecord.values,
          paidAmount: nextState.paidAmount,
        },
        status: nextState.status,
        note,
      })
    },
    [financeInvoiceRecords, updateRecord],
  )

  const syncServiceWorkorderRecord = useCallback(async (): Promise<ServiceWorkorderRecord | undefined> => {
    if (!isServiceOrderCard) {
      return
    }
    const payload = buildServiceWorkorderSyncPayload(record, carRecords)
    if (!payload.vehicle_vin) {
      throw new Error('У заказ-наряда не заполнен VIN для синхронизации с сервисом.')
    }
    return await ensureServiceWorkorder(payload)
  }, [carRecords, isServiceOrderCard, record])

  const syncInventoryProjection = useCallback(
    async (lines: WorkorderPartPlanLine[]) => {
      const uniqueLines = Array.from(
        lines.reduce((accumulator, line) => {
          if (!line.sku || accumulator.has(line.sku)) {
            return accumulator
          }
          accumulator.set(line.sku, line)
          return accumulator
        }, new Map<string, WorkorderPartPlanLine>()),
      ).map(([, line]) => line)

      for (const line of uniqueLines) {
        const item = await fetchInventoryStockBySKU(line.sku)
        if (!item) {
          continue
        }

        const existingRecord = stockRecords.find(
          (stockRecord) => (stockRecord.values.sku ?? '').trim().toUpperCase() === line.sku,
        )
        const projection = buildInventoryStockProjection(
          item,
          existingRecord,
          line.title || resolveWorkorderPartTitle(line.sku, stockRecords),
        )

        if (existingRecord) {
          updateRecord({
            storeKey: INVENTORY_STOCK_STORE_KEY,
            recordId: existingRecord.id,
            title: projection.title,
            subtitle: projection.subtitle,
            values: projection.values,
            status: projection.status,
            note: `Остаток синхронизирован после списания по заказ-наряду ${record.id}.`,
          })
          continue
        }

        createRecord({
          storeKey: INVENTORY_STOCK_STORE_KEY,
          idPrefix: 'STK',
          initialStatus: projection.status,
          title: projection.title,
          subtitle: projection.subtitle,
          values: projection.values,
          createdHistoryText: `Складская позиция создана из проекции inventory-stock после заказ-наряда ${record.id}.`,
        })
      }
    },
    [createRecord, record.id, stockRecords, updateRecord],
  )

  useEffect(() => {
    if (stockRecords.length === 0) {
      return
    }
    void reconcileInventoryStockRecords(stockRecords).catch((error) => {
      console.error('Failed to reconcile inventory stock records', error)
    })
  }, [stockRecords])

  const loadWorkorderPartsPlan = useCallback(async () => {
    if (!isServiceOrderCard) {
      return
    }
    setIsPartsLoading(true)
    setPartsError('')
    try {
      const response = await fetchWorkorderPartsPlan(record.id)
      const draftLines = toDraftWorkorderPartLines(response.lines).map((line) =>
        applyWorkorderPartDraftLinePreview(line, stockRecords),
      )
      setPartsLines(draftLines)
      setIsPartsDirty(false)
      setPartsNotice('')
      try {
        prepareWorkorderPartPlanLines(draftLines, stockRecords)
      } catch (validationError) {
        setPartsError(
          validationError instanceof Error
            ? validationError.message
            : 'План запчастей содержит SKU, которых нет на складе.',
        )
      }
    } catch (error) {
      setPartsError(error instanceof Error ? error.message : 'Не удалось загрузить план запчастей.')
      setPartsLines([createEmptyWorkorderPartDraftLine()])
    } finally {
      setIsPartsLoading(false)
    }
  }, [isServiceOrderCard, record.id, stockRecords])

  const persistWorkorderPartsPlan = useCallback(
    async (lines: WorkorderPartDraftLine[] = partsLines) => {
      if (!isServiceOrderCard) {
        return null
      }
      setIsPartsSaving(true)
      setPartsError('')
      try {
        const preparedLines = prepareWorkorderPartPlanLines(lines, stockRecords)
        const response = await saveWorkorderPartsPlan(record.id, preparedLines)
        setPartsLines(
          toDraftWorkorderPartLines(response.lines).map((line) =>
            applyWorkorderPartDraftLinePreview(line, stockRecords),
          ),
        )
        setIsPartsDirty(false)
        setPartsNotice(
          response.lines.length === 0 ? 'План запчастей очищен.' : 'План запчастей сохранен.',
        )
        return response
      } catch (error) {
        setPartsError(error instanceof Error ? error.message : 'Не удалось сохранить план запчастей.')
        return null
      } finally {
        setIsPartsSaving(false)
      }
    },
    [isServiceOrderCard, partsLines, record.id, stockRecords],
  )

  const handleWorkorderPartsWriteoff = useCallback(async (
    lines: WorkorderPartDraftLine[] = partsLines,
  ): Promise<WorkorderPartsWriteoffResponse | null> => {
    if (!isServiceOrderCard) {
      return null
    }
    setIsPartsWriteoffRunning(true)
    setPartsError('')
    setPartsNotice('')
    try {
      if (normalizeWorkorderPartDraftLines(lines).length === 0) {
        throw new Error('Добавьте хотя бы одну строку запчастей с положительным количеством.')
      }

      const savedPlan = await persistWorkorderPartsPlan(lines)
      if (!savedPlan) {
        return null
      }

      setPartsNotice('')
      await syncServiceWorkorderRecord()
      const response = await writeoffWorkorderParts(record.id)
      const refreshedPlan = await fetchWorkorderPartsPlan(record.id)
      setPartsLines(
        toDraftWorkorderPartLines(refreshedPlan.lines).map((line) =>
          applyWorkorderPartDraftLinePreview(line, stockRecords),
        ),
      )
      setIsPartsDirty(false)
      await syncInventoryProjection(refreshedPlan.lines)
      updateRecord({
        storeKey,
        recordId: record.id,
        title: record.title,
        subtitle: record.subtitle,
        values: record.values,
        status: response.workorder_status,
        note: buildWorkorderPartsStatusNote(response),
      })
      setPartsNotice(
        response.result === 'waiting_parts'
          ? `Создано заявок в закупку: ${response.procurement_requests.length}.`
          : 'Материалы списаны и остатки склада синхронизированы.',
      )
      return response
    } catch (error) {
      setPartsError(error instanceof Error ? error.message : 'Не удалось списать материалы.')
      return null
    } finally {
      setIsPartsWriteoffRunning(false)
    }
  }, [
    isServiceOrderCard,
    partsLines,
    persistWorkorderPartsPlan,
    record.id,
    record.subtitle,
    record.title,
    record.values,
    stockRecords,
    storeKey,
    syncServiceWorkorderRecord,
    syncInventoryProjection,
    updateRecord,
  ])

  const handleServiceWorkorderClose = useCallback(async () => {
    if (!isServiceOrderCard) {
      return
    }

    setIsServiceOrderClosing(true)
    setPartsError('')
    setPartsNotice('')

    try {
      let effectiveLines = partsLines
      if (isPartsDirty) {
        const savedPlan = await persistWorkorderPartsPlan(partsLines)
        if (!savedPlan) {
          return
        }
        effectiveLines = toDraftWorkorderPartLines(savedPlan.lines).map((line) =>
          applyWorkorderPartDraftLinePreview(line, stockRecords),
        )
      }

      const hasPlannedParts = normalizeWorkorderPartDraftLines(effectiveLines).length > 0
      const hasPendingParts = effectiveLines.some((line) => {
        const quantity = Number(line.quantity.trim())
        return Boolean(line.sku.trim()) && Number.isFinite(quantity) && quantity > 0 && line.state !== 'written_off'
      })

      let currentStatus = record.status
      let backendPrepared = false
      if (hasPlannedParts && hasPendingParts) {
        const writeoffResponse = await handleWorkorderPartsWriteoff(effectiveLines)
        if (!writeoffResponse) {
          return
        }
        currentStatus = writeoffResponse.workorder_status
        backendPrepared = true
        if (writeoffResponse.result !== 'written_off') {
          setPartsNotice(
            `Заказ-наряд не закрыт: создано заявок в закупку ${writeoffResponse.procurement_requests.length}.`,
          )
          return
        }
      }

      if (!backendPrepared) {
        const syncedWorkorder = await syncServiceWorkorderRecord()
        if (syncedWorkorder) {
          currentStatus = syncedWorkorder.status
          updateRecord({
            storeKey,
            recordId: record.id,
            title: record.title,
            subtitle: record.subtitle,
            values: record.values,
            status: syncedWorkorder.status,
            note: 'Статус заказ-наряда синхронизирован перед закрытием.',
          })
        }
      }

      const closePreparation = resolveServiceWorkorderClosePreparation(currentStatus)

      if (closePreparation === 'already_closed') {
        updateRecord({
          storeKey,
          recordId: record.id,
          title: record.title,
          subtitle: record.subtitle,
          values: record.values,
          status: 'closed',
          note: 'Карточка синхронизирована: заказ-наряд уже был закрыт в сервисе.',
        })
        setPartsNotice('Заказ-наряд уже закрыт.')
        return
      }

      if (closePreparation === 'blocked') {
        throw new Error(
          `Заказ-наряд находится в статусе "${currentStatus}" и не может быть закрыт автоматически.`,
        )
      }

      if (closePreparation === 'prepare_before_close') {
        const preparedWorkorder = await updateServiceWorkorderStatus(record.id, 'ready')
        currentStatus = preparedWorkorder.status
        updateRecord({
          storeKey,
          recordId: record.id,
          title: record.title,
          subtitle: record.subtitle,
          values: record.values,
          status: preparedWorkorder.status,
          note: 'Заказ-наряд подготовлен к закрытию.',
        })
      }

      const closeResponse = await closeServiceWorkorder(record.id)
      updateRecord({
        storeKey,
        recordId: record.id,
        title: record.title,
        subtitle: record.subtitle,
        values: record.values,
        status: closeResponse.workorder.status,
        note:
          hasPlannedParts
            ? 'Заказ-наряд закрыт после списания материалов.'
            : 'Заказ-наряд закрыт.',
      })
      setPartsNotice(
        hasPlannedParts
          ? 'Материалы списаны, заказ-наряд закрыт.'
          : 'Заказ-наряд закрыт.',
      )
    } catch (error) {
      setPartsError(error instanceof Error ? error.message : 'Не удалось закрыть заказ-наряд.')
    } finally {
      setIsServiceOrderClosing(false)
    }
  }, [
    handleWorkorderPartsWriteoff,
    isPartsDirty,
    isServiceOrderCard,
    partsLines,
    persistWorkorderPartsPlan,
    record.id,
    record.status,
    record.subtitle,
    record.title,
    record.values,
    stockRecords,
    storeKey,
    syncServiceWorkorderRecord,
    updateRecord,
  ])

  useEffect(() => {
    if (!isServiceOrderCard) {
      return
    }
    void loadWorkorderPartsPlan()
  }, [isServiceOrderCard, loadWorkorderPartsPlan])

  const financeReportType = isFinanceReportsCard
    ? inferFinanceReportType(record.values.type, record.title)
    : ''
  const financeReportFormat = (record.values.format ?? '').trim().toUpperCase()
  const canDownloadFinanceReport =
    isFinanceReportsCard &&
    record.status === 'generated' &&
    financeReportFormat === 'PDF' &&
    Boolean((record.values.downloadUrl ?? '').trim())
  const canCreateDealFromCar =
    isCarCatalogCard &&
    can('create', DEALS_STORE_KEY) &&
    (record.status === 'active' || record.status === 'in_service')
  const createDealFromCarReason = canCreateDealFromCar
    ? ''
    : !isCarCatalogCard
      ? ''
      : !can('create', DEALS_STORE_KEY)
        ? getActionDeniedReason(role, 'create', DEALS_STORE_KEY)
        : 'Сделку можно открыть только для активного автомобиля или автомобиля в сервисе.'
  const salesContextDealId = isDealCard
    ? record.id
    : isSalesDocumentCard
      ? findRelatedRecordId(record, DEALS_STORE_KEY)
      : ''
  const salesContextInvoiceIDs = new Set(
    record.related
      .filter((item) => item.storeKey === FINANCE_INVOICES_STORE_KEY && item.recordId?.trim())
      .map((item) => item.recordId as string),
  )
  const salesContextInvoiceRecords =
    isDealCard || isSalesDocumentCard
      ? financeInvoiceRecords.filter(
          (invoice) =>
            salesContextInvoiceIDs.has(invoice.id) ||
            (salesContextDealId && (invoice.values.dealId ?? '').trim() === salesContextDealId),
        )
      : []
  const linkedIssuedInvoiceRecords = salesContextInvoiceRecords.filter(
    (invoice) => invoice.status === 'issued',
  )
  const singleLinkedIssuedInvoice = linkedIssuedInvoiceRecords.length === 1
    ? linkedIssuedInvoiceRecords[0]
    : undefined
  const canCreatePaymentFromCard =
    (isDealCard || isSalesDocumentCard) &&
    can('create', FINANCE_PAYMENTS_STORE_KEY) &&
    linkedIssuedInvoiceRecords.length > 0
  const createPaymentFromCardReason = canCreatePaymentFromCard
    ? ''
    : !can('create', FINANCE_PAYMENTS_STORE_KEY)
      ? getActionDeniedReason(role, 'create', FINANCE_PAYMENTS_STORE_KEY)
      : 'Для этой карточки нет связанных выставленных счетов.'
  const salesDocumentType = (record.values.docType ?? '').trim().toLowerCase()
  const salesContractDeal = salesContextDealId
    ? resolveEntityRecord(DEALS_STORE_KEY, salesContextDealId, getRecords)
    : undefined
  const salesContractCarReference = (salesContractDeal?.values.carRecordId ?? '').trim()
  const salesContractCar =
    (salesContractCarReference
      ? resolveEntityRecord(DEAL_CARS_STORE_KEY, salesContractCarReference, getRecords)
      : undefined) ??
    carRecords.find((car) =>
      normalizeVIN(car.values[VIN_FIELD_KEY] ?? '') ===
      normalizeVIN(
        salesContractDeal?.values.carVin ??
        salesContractDeal?.values[VIN_FIELD_KEY] ??
        '',
      ),
    )
  const canDownloadSalesContractPdf =
    isSalesDocumentCard &&
    (salesDocumentType.includes('договор') || salesDocumentType.includes('contract')) &&
    Boolean(salesContractDeal)

  const actionStates: ActionState[] = getAvailableActions(tab, record.status).map((action) => {
      let reason = ''

      if (isFinanceDocumentProxyCard) {
        reason = 'Документ подгружается из другого отдела. Откройте исходную карточку.'
      } else if (isFinanceReportsCard && action.key === 'post' && isReportGenerating) {
        reason = 'Отчет уже формируется.'
      } else if (isFinanceReportsCard && action.key === 'post' && financeReportFormat !== 'PDF') {
        reason = 'Реальная генерация доступна только для PDF.'
      } else if (isFinanceReportsCard && action.key === 'post' && financeReportType !== 'ar-ap') {
        reason = 'Реальная генерация пока доступна только для отчета AR/AP.'
      } else if (
        isFinanceReportsCard &&
        action.key === 'post' &&
        !isFinanceReportPeriod(record.values.period)
      ) {
        reason = 'Период отчета должен быть в формате MM.YYYY.'
      } else if (readOnly && action.key !== 'reopen' && action.key !== 'delete') {
        reason = 'Объект закрыт: действие доступно только в режиме просмотра.'
      } else if (
        isFinanceInvoicesCard &&
        action.key === 'cancel' &&
        !canCancelFinanceInvoice(record, financePaymentRecords)
      ) {
        reason = 'Нельзя отменить счет, пока по нему есть активные платежи.'
      } else if (
        isInventoryPurchasesCard &&
        action.key === 'cancel' &&
        !canCancelInventoryPurchase(relatedPurchaseInvoice)
      ) {
        reason = 'Нельзя отменить закупку, пока по входящему счету есть оплата.'
      } else if (
        isServiceOrderCard &&
        (action.key === 'writeoff' || action.key === 'close') &&
        (isPartsLoading || isPartsSaving || isPartsWriteoffRunning || isServiceOrderClosing)
      ) {
        reason = 'Операция по заказ-наряду уже выполняется.'
      } else if (!can(action.key, storeKey)) {
        reason = getActionDeniedReason(role, action.key, storeKey)
      }

      return {
        key: action.key,
        label: action.label,
        nextStatus: action.nextStatus,
        critical: action.critical,
        disabled: Boolean(reason),
        reason,
      }
    })

  const disabledActions = actionStates.filter((action) => action.disabled)
  const editActionEnabled = actionStates.some((action) => action.key === 'edit' && !action.disabled)
  const reopenAction = actionStates.find((action) => action.key === 'reopen')

  const resolveValueLabel = (key: string) => {
    if (isFinanceInternalFieldKey(key)) {
      return ''
    }
    if (isReferenceTextFieldKey(key)) {
      return ''
    }
    const metadataLabel = fieldLabelMap.get(key)
    if (metadataLabel) {
      return metadataLabel
    }
    if (key === 'stockItemId') {
      return 'Товар'
    }
    if (key === 'quantity') {
      return 'Количество'
    }
    if (key === 'unitPrice') {
      return 'Цена за штуку'
    }
    if (key === 'purchaseId') {
      return 'Закупка'
    }
    if (key === 'dealId') {
      return 'Сделка'
    }
    if (key === 'number') {
      return 'Номер'
    }
    if (key === 'owner') {
      return 'Ответственный'
    }
    if (key === 'paidAmount') {
      return 'Оплачено'
    }
    if (key === 'direction') {
      return 'Тип счета'
    }
    if (key === 'source') {
      return 'Источник'
    }
    if (key === 'counterparty') {
      return 'Контрагент'
    }
    if (key === 'invoice') {
      return 'Счет'
    }
    if (key === 'method') {
      return 'Метод'
    }
    if (key === 'dueDate') {
      return 'Срок оплаты'
    }
    if (key === 'period') {
      return 'Период'
    }
    if (key === 'type') {
      return 'Тип отчета'
    }
    if (key === 'format') {
      return 'Формат'
    }
    if (key === 'exportId') {
      return 'Экспорт'
    }
    if (key === 'fileName') {
      return 'Файл'
    }
    if (key === 'generatedAt') {
      return 'Сформирован'
    }
    if (key === 'invoiceCount') {
      return 'Количество счетов'
    }
    if (key === 'paymentCount') {
      return 'Количество платежей'
    }
    if (key === 'incomingIssuedTotal') {
      return 'Входящие выставлено'
    }
    if (key === 'incomingPaidTotal') {
      return 'Входящие оплачено'
    }
    if (key === 'outgoingIssuedTotal') {
      return 'Исходящие выставлено'
    }
    if (key === 'outgoingPaidTotal') {
      return 'Исходящие оплачено'
    }
    if (key === 'openInvoiceTotal') {
      return 'Открытый остаток'
    }
    if (key === 'reconciledPaymentsTotal') {
      return 'Сверенные платежи'
    }
    if (storeKey === CARS_CATALOG_STORE_KEY && key === 'price') {
      return 'Стоимость'
    }
    return key
  }

  const resolveFieldDisplayLabelForKey = (key: string, value: string, values: Record<string, string>) => {
    const baseField = getFormField(key)
    if (!baseField) {
      return value
    }
    const resolvedField = resolveEntityCreateField(storeKey, baseField)
    if (isStoreReferenceField(resolvedField)) {
      return resolveStoreReferenceLabel(
        resolvedField.optionsSource,
        value,
        getRecords,
        values[getReferenceTextFieldKey(key)],
      )
    }
    const option = resolvedField.options?.find((item) => item.value === value)
    return option?.label ?? value
  }

  const resolveValueDisplay = (key: string, value: string) => {
    if (key === 'stockItemId') {
      return value ? resolveInventoryStockValue(value, stockRecords) : '-'
    }
    if (key === 'quantity') {
      return value || String(getInventoryPurchaseQuantity(record)) || '-'
    }
    if (key === 'unitPrice') {
      const resolvedValue =
        value || normalizeInventoryPurchaseUnitPrice(String(getInventoryPurchaseUnitPrice(record)))
      return resolvedValue ? formatMoneyDisplay(resolvedValue) : '-'
    }
    if (key === 'amount' && isInventoryPurchasesCard) {
      const resolvedValue =
        value ||
        computeInventoryPurchaseAmount(
          record.values.unitPrice || normalizeInventoryPurchaseUnitPrice(String(getInventoryPurchaseUnitPrice(record))),
          record.values.quantity || String(getInventoryPurchaseQuantity(record)),
        )
      return resolvedValue ? formatMoneyDisplay(resolvedValue) : '-'
    }
    if (key === 'direction') {
      return formatFinanceInvoiceDirection(value)
    }
    if (!value) {
      return '-'
    }
    if (key === 'generatedAt') {
      const parsed = new Date(value)
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleString('ru-RU')
      }
    }
    if (
      [
        'amount',
        'carPrice',
        'price',
        'paidAmount',
        'incomingIssuedTotal',
        'incomingPaidTotal',
        'outgoingIssuedTotal',
        'outgoingPaidTotal',
        'openInvoiceTotal',
        'reconciledPaymentsTotal',
      ].includes(key)
    ) {
      return formatMoneyDisplay(value)
    }
    if (key === 'role') {
      return formatAccessRoleLabel(value)
    }
    const resolvedLabel = resolveFieldDisplayLabelForKey(key, value, record.values)
    return resolvedLabel || value
  }

  const resolveValuePath = (key: string, value: string) => {
    const trimmedValue = value.trim()
    if (!trimmedValue || trimmedValue === '-') {
      return null
    }

    if (key === 'dealId') {
      return buildRecordPath(DEALS_STORE_KEY, trimmedValue)
    }
    if (key === 'purchaseId') {
      return buildRecordPath(INVENTORY_PURCHASES_STORE_KEY, trimmedValue)
    }
    if (key === 'stockItemId') {
      return buildRecordPath(INVENTORY_STOCK_STORE_KEY, trimmedValue)
    }
    if (key === 'invoice') {
      return buildRecordPath(FINANCE_INVOICES_STORE_KEY, trimmedValue)
    }

    const baseField = getFormField(key)
    if (!baseField) {
      return null
    }
    const resolvedField = resolveEntityCreateField(storeKey, baseField)
    if (!isStoreReferenceField(resolvedField)) {
      return null
    }
    return resolveStoreReferencePath(resolvedField.optionsSource, trimmedValue, getRecords)
  }

  const dealPrimaryValueKeys = ['client', 'vin', 'amount', 'manager']
  const dealVisibleEntries = isDealCard
    ? Object.entries(record.values).filter(
        ([key]) => !isDealTechnicalValueKey(key) && !isReferenceTextFieldKey(key),
      )
    : []
  const dealPrimaryEntries = isDealCard
    ? dealPrimaryValueKeys.flatMap((key) => {
        if (!(key in record.values) || isDealTechnicalValueKey(key)) {
          return []
        }
        return [[key, record.values[key] ?? ''] satisfies [string, string]]
      })
    : []
  const dealSecondaryEntries = isDealCard
    ? dealVisibleEntries.filter(([key]) => !dealPrimaryValueKeys.includes(key))
    : []
  const detailEntries = isDealCard
    ? dealSecondaryEntries
    : isInventoryPurchasesCard
      ? [
          ...Object.entries(record.values),
          ...(['quantity', 'unitPrice'] as const)
            .filter((key) => !(key in record.values))
            .map((key) => [key, ''] satisfies [string, string]),
        ]
      : Object.entries(record.values).filter(([key]) => {
          if (isFinanceInternalFieldKey(key) || isReferenceTextFieldKey(key)) {
            return false
          }
          if (isSalesDocumentCard && isSalesDocumentTechnicalValueKey(key)) {
            return false
          }
          if (isFinanceReportsCard && key === 'downloadUrl') {
            return false
          }
          return true
        })
  const dealCarTitle = record.values.carRecordTitle?.trim() ?? ''
  const dealCarSubtitle = record.values.carRecordSubtitle?.trim() ?? ''
  const dealCarVin = record.values.carVin?.trim() ?? ''
  const dealCarRecordId = record.values.carRecordId?.trim() ?? ''
  const dealCarPath = buildRecordPath(DEAL_CARS_STORE_KEY, dealCarRecordId)
  const dealCarValue = dealCarTitle || (dealCarVin ? `VIN ${dealCarVin}` : dealCarRecordId)
  const dealCarMeta = dealCarVin || dealCarSubtitle
  const showDealCarLink = isDealCard && Boolean(dealCarValue)
  const dealEditFieldKeys = isDealCard
    ? [
        ...tab.createFields
          .filter((field) => field.key !== 'title' && field.key !== 'subtitle')
          .map((field) => field.key),
        ...Object.keys(editValues).filter(
          (key) =>
            key !== 'title' &&
            key !== 'subtitle' &&
            !isDealTechnicalValueKey(key) &&
            !tab.createFields.some((field) => field.key === key),
        ),
      ]
    : []
  const inventoryPurchaseEditFieldKeys = isInventoryPurchasesCard
    ? [
        'stockItemId',
        'supplier',
        'quantity',
        'unitPrice',
        'amount',
        'eta',
        ...Object.keys(editValues).filter(
          (key) =>
            !['title', 'subtitle', 'stockItemId', 'supplier', 'quantity', 'unitPrice', 'amount', 'eta'].includes(
              key,
            ),
        ),
      ].filter((key, index, array) => array.indexOf(key) === index)
    : []
  const genericEditEntries = Object.entries(editValues).filter(([key]) => {
    if (isFinanceInternalFieldKey(key)) {
      return false
    }
    if (isReferenceTextFieldKey(key)) {
      return false
    }
    if (isFinanceInvoicesCard && key === 'paidAmount') {
      return false
    }
    if (isFinanceDocumentsCard && key === 'source') {
      return false
    }
    if (isSalesDocumentCard && isSalesDocumentTechnicalValueKey(key)) {
      return false
    }
    if (
      isFinanceReportsCard &&
      ['exportId', 'downloadUrl', 'fileName', 'generatedAt'].includes(key)
    ) {
      return false
    }
    if (
      storeKey === PLATFORM_USERS_STORE_KEY &&
      ['accessRole', 'department', 'businessRoleIdText'].includes(key)
    ) {
      return false
    }
    return true
  })

  const buildEditValues = useCallback(
  (values: Record<string, string>) => {
    const defaults = Object.fromEntries(
      tab.createFields
        .filter((field) => field.key !== 'title' && field.key !== 'subtitle')
        .map((field) => [field.key, values[field.key] ?? '']),
    )
    const merged = {
      ...defaults,
      ...Object.fromEntries(Object.entries(values).filter(([key]) => !isFinanceInternalFieldKey(key))),
    }
    if (storeKey === INVENTORY_PURCHASES_STORE_KEY) {
      merged.quantity = merged.quantity || String(getInventoryPurchaseQuantity(values))
      merged.unitPrice =
        merged.unitPrice || normalizeInventoryPurchaseUnitPrice(String(getInventoryPurchaseUnitPrice(values)))
      merged.amount = computeInventoryPurchaseAmount(merged.unitPrice, merged.quantity)
      return merged
    }
    if (storeKey === PLATFORM_USERS_STORE_KEY) {
      return normalizePlatformUserValues(merged)
    }
    return storeKey === DEALS_STORE_KEY
      ? enrichDealValuesWithCarInfo(merged, getRecords(DEAL_CARS_STORE_KEY))
      : merged
  },
  [getRecords, storeKey, tab.createFields],
)

  const openEditModal = useCallback(() => {
    setEditTitle(record.title)
    setEditSubtitle(record.subtitle)
    setEditValues(buildEditValues(record.values))
    setEditCustomMode({})
    setEditSelectFilter({})
    setIsEditPurchaseUnitPriceDirty(false)
    setEditError('')
    setIsClientCreateOpen(false)
    setIsEditOpen(true)
  }, [buildEditValues, record.subtitle, record.title, record.values, setEditSelectFilter])
  const closeEditModal = useCallback(() => {
    setIsClientCreateOpen(false)
    setIsEditOpen(false)
  }, [setIsClientCreateOpen, setIsEditOpen])

  const openClientCreateModal = useCallback(() => {
    setClientCreateVersion((prev) => prev + 1)
    setIsClientCreateOpen(true)
  }, [setClientCreateVersion, setIsClientCreateOpen])

  const handleFinanceReportDownload = useCallback(async () => {
    const downloadUrl = (record.values.downloadUrl ?? '').trim()
    if (!downloadUrl || isReportDownloading) {
      return
    }

    setReportActionError('')
    setIsReportDownloading(true)
    try {
      await downloadFinanceReport(downloadUrl, record.values.fileName)
    } catch (error) {
      setReportActionError(
        error instanceof Error ? error.message : 'Не удалось скачать отчет.',
      )
    } finally {
      setIsReportDownloading(false)
    }
  }, [isReportDownloading, record.values.downloadUrl, record.values.fileName])

  const handleCreateDealFromCar = useCallback(() => {
    if (!canCreateDealFromCar) {
      return
    }

    const ownerClientValue = (record.values.ownerClient ?? '').trim()
    const matchedClient = ownerClientValue
      ? resolveStoreReferenceRecord(CLIENTS_STORE_SOURCE, ownerClientValue, getRecords, {
          allowLegacyMatch: true,
        })
      : undefined
    const prefillCreateValues: Record<string, string> = {
      title: `Продажа ${record.title}`.trim(),
      vin: record.id,
      amount: formatMoneyString(record.values.price ?? ''),
    }
    const prefillCreateCustomMode: Record<string, boolean> = {}

    if (matchedClient) {
      prefillCreateValues.client = matchedClient.id
    } else if (ownerClientValue) {
      prefillCreateValues.client = ''
      prefillCreateValues.clientText = ownerClientValue
      prefillCreateCustomMode.client = true
    }

    navigate('/crm-sales/deals', {
      state: {
        openCreateForStoreKey: DEALS_STORE_KEY,
        prefillCreateValues,
        prefillCreateCustomMode,
      } satisfies EntityCardNavigationState,
    })
  }, [canCreateDealFromCar, getRecords, navigate, record.id, record.title, record.values.ownerClient, record.values.price])

  const handleCreatePaymentFromCard = useCallback(() => {
    if (!canCreatePaymentFromCard) {
      return
    }

    const titleSource = (record.values.number ?? '').trim() || record.id
    const title = isSalesDocumentCard
      ? `Оплата по договору ${titleSource}`
      : `Оплата по сделке ${record.id}`
    const prefillCreateValues: Record<string, string> = {
      title,
    }

    if (salesContextDealId) {
      prefillCreateValues.dealId = salesContextDealId
    }
    if (singleLinkedIssuedInvoice) {
      prefillCreateValues.invoice = singleLinkedIssuedInvoice.id
    }

    navigate('/finance/payments', {
      state: {
        openCreateForStoreKey: FINANCE_PAYMENTS_STORE_KEY,
        prefillCreateValues,
      } satisfies EntityCardNavigationState,
    })
  }, [canCreatePaymentFromCard, isSalesDocumentCard, navigate, record.id, record.values.number, salesContextDealId, singleLinkedIssuedInvoice])

  const handleSalesContractDownload = useCallback(async () => {
    if (!canDownloadSalesContractPdf || !salesContractDeal || isSalesDocumentDownloading) {
      return
    }

    const clientValue = (record.values.client ?? salesContractDeal.values.client ?? '').trim()
    const clientText = (record.values.clientText ?? salesContractDeal.values.clientText ?? '').trim()
    const buyerRecord = clientValue
      ? resolveStoreReferenceRecord(CLIENTS_STORE_SOURCE, clientValue, getRecords, {
          allowLegacyMatch: true,
        })
      : undefined
    const buyerName = (buyerRecord?.title ?? clientText) || clientValue
    const vehicleTitle =
      (salesContractCar?.title ?? salesContractDeal.values.carRecordTitle ?? '').trim()
    const vehicleVin = (
      salesContractCar?.values.vin ??
      salesContractDeal.values.carVin ??
      salesContractDeal.values[VIN_FIELD_KEY] ??
      ''
    ).trim()

    if (!buyerName) {
      setSalesDocumentActionError('Не удалось определить покупателя для договора.')
      return
    }

    if (!vehicleTitle && !vehicleVin) {
      setSalesDocumentActionError('Не удалось определить автомобиль для договора.')
      return
    }

    const total = Number((salesContractDeal.values.amount ?? '0').replace(/\s+/g, ''))
    const documentDate =
      /^\d{4}-\d{2}-\d{2}$/.test((record.values.date ?? '').trim())
        ? (record.values.date ?? '').trim()
        : new Date().toISOString().slice(0, 10)

    setSalesDocumentActionError('')
    setIsSalesDocumentDownloading(true)
    try {
      const generatedDocument = await generateSalesDocument({
        templateId: 'tpl-contract',
        dealId: salesContractDeal.id,
        clientId: buyerRecord?.id,
        sourceDocumentId: record.id,
        documentNumber: (record.values.number ?? '').trim() || record.id,
        documentDate,
        responsible: (record.values.owner ?? '').trim(),
        buyerName,
        vehicleTitle,
        vehicleVin,
        vehicleBrand: (salesContractCar?.values.brand ?? salesContractDeal.values.carBrand ?? '').trim(),
        vehicleModel: (salesContractCar?.values.model ?? salesContractDeal.values.carModel ?? '').trim(),
        vehicleYear: (salesContractCar?.values.year ?? salesContractDeal.values.carYear ?? '').trim(),
        vehicleColor: (salesContractCar?.values.color ?? salesContractDeal.values.carColor ?? '').trim(),
        vehiclePrice: (salesContractCar?.values.price ?? salesContractDeal.values.carPrice ?? '').trim(),
        total: Number.isFinite(total) ? total : 0,
      })

      const nextValues = {
        ...record.values,
        [SALES_DOCUMENT_PDF_ID_FIELD]: generatedDocument.id,
        [SALES_DOCUMENT_PDF_DOWNLOAD_URL_FIELD]: generatedDocument.downloadUrl ?? '',
        [SALES_DOCUMENT_PDF_FILE_NAME_FIELD]: generatedDocument.fileName ?? '',
        [SALES_DOCUMENT_PDF_GENERATED_AT_FIELD]: generatedDocument.generatedAt ?? generatedDocument.createdAt,
      }

      updateRecord({
        storeKey,
        recordId: record.id,
        title: record.title,
        subtitle: record.subtitle,
        values: nextValues,
        note: 'PDF договора обновлен.',
      })

      if (!generatedDocument.downloadUrl) {
        throw new Error('Сервис не вернул ссылку на скачивание PDF.')
      }

      await downloadSalesDocument(
        generatedDocument.downloadUrl,
        generatedDocument.fileName || `${record.values.number ?? record.id}.pdf`,
      )
    } catch (error) {
      setSalesDocumentActionError(
        error instanceof Error ? error.message : 'Не удалось подготовить PDF договора.',
      )
    } finally {
      setIsSalesDocumentDownloading(false)
    }
  }, [
    canDownloadSalesContractPdf,
    getRecords,
    isSalesDocumentDownloading,
    record.id,
    record.subtitle,
    record.title,
    record.values,
    salesContractCar,
    salesContractDeal,
    storeKey,
    updateRecord,
  ])

  const applyEditFieldValue = (fieldKey: string, nextValue: string) => {
    if (isInventoryPurchasesCard && fieldKey === 'unitPrice') {
      setIsEditPurchaseUnitPriceDirty(Boolean(nextValue.trim()))
    }
    setEditValues((prev) => {
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
      if (isCarCatalogCard) {
        if (fieldKey === 'brand' && !isCarModelValidForBrand(next.brand ?? '', next.model ?? '')) {
          next.model = ''
          setEditCustomMode((customPrev) => ({ ...customPrev, model: false }))
          setEditSelectFilter((filterPrev) => ({ ...filterPrev, model: '' }))
        }
        setEditTitle(buildCarTitle(next.brand ?? '', next.model ?? '', next.year ?? ''))
      }
      if (
        isDealCard &&
        (fieldKey === DEAL_VIN_FIELD_KEY || companionBaseKey === DEAL_VIN_FIELD_KEY)
      ) {
        const enriched = enrichDealValuesWithCarInfo(next, getRecords(DEAL_CARS_STORE_KEY))
        return prefillDealAmountFromCarInfo(prev, enriched)
      }
      if (isInventoryPurchasesCard) {
        if (fieldKey === 'stockItemId' && !isEditPurchaseUnitPriceDirty && !(prev.unitPrice ?? '').trim()) {
          next.unitPrice = getSuggestedPurchaseUnitPrice(nextValue, record.id)
        }
        if (fieldKey === 'quantity') {
          next.quantity = normalizeInventoryPurchaseQuantity(nextValue)
        }
        if (fieldKey === 'unitPrice') {
          next.unitPrice = normalizeInventoryPurchaseUnitPrice(nextValue)
        }
        next.amount = computeInventoryPurchaseAmount(next.unitPrice, next.quantity)
      }
      return next
    })
  }

  const runAction = async (actionKey: ActionKey, label: string, critical?: boolean) => {
    const actionState = actionStates.find((action) => action.key === actionKey)
    if (!actionState || actionState.disabled) {
      return
    }

    if (actionKey === 'edit') {
      openEditModal()
      return
    }

    if (isServiceOrderCard && actionKey === 'writeoff') {
      if (isPartsLoading || isPartsSaving || isPartsWriteoffRunning || isServiceOrderClosing) {
        return
      }
      if (critical && !window.confirm(`Подтвердить действие: "${label}"?`)) {
        return
      }
      await handleWorkorderPartsWriteoff()
      return
    }

    if (isServiceOrderCard && actionKey === 'close') {
      if (isPartsLoading || isPartsSaving || isPartsWriteoffRunning || isServiceOrderClosing) {
        return
      }
      if (critical && !window.confirm(`Подтвердить действие: "${label}"?`)) {
        return
      }
      await handleServiceWorkorderClose()
      return
    }

    if (critical) {
      const confirmationText =
        actionKey === 'delete'
          ? `Удалить "${record.title}"?\n\nЗапись будет удалена без возможности восстановления, связанные ссылки будут очищены.`
          : `Подтвердить действие: "${label}"?`
      const confirmed = window.confirm(confirmationText)
      if (!confirmed) {
        return
      }
    }

    if (actionKey === 'delete') {
      deleteRecord({
        storeKey,
        recordId: record.id,
      })
      navigate(`/${subsystem.slug}/${tab.slug}`)
      return
    }

    const nextStatus = actionState.nextStatus
    if (!nextStatus) {
      return
    }

    if (isInventoryPurchasesCard && actionKey === 'cancel') {
      if (relatedPurchaseDocument && relatedPurchaseDocument.status !== 'cancelled') {
        updateStatus({
          storeKey: INVENTORY_DOCUMENTS_STORE_KEY,
          recordId: relatedPurchaseDocument.id,
          status: 'cancelled',
          note: `Накладная отменена после отмены закупки ${record.id}.`,
        })
      }

      if (
        relatedPurchaseInvoice &&
        relatedPurchaseInvoice.status === 'issued'
      ) {
        updateStatus({
          storeKey: FINANCE_INVOICES_STORE_KEY,
          recordId: relatedPurchaseInvoice.id,
          status: 'cancelled',
          note: `Входящий счет отменен после отмены закупки ${record.id}.`,
        })
      }

      updateStatus({
        storeKey,
        recordId: record.id,
        status: nextStatus,
        note: `Выполнено действие "${label}"`,
      })
      return
    }

    if (isInventoryPurchasesCard && actionKey === 'close') {
      const stockRecord = stockRecords.find((item) => item.id === record.values.stockItemId)
      const quantity = getInventoryPurchaseQuantity(record)

      if (!stockRecord || quantity <= 0) {
        window.alert('Нельзя принять закупку без корректной складской позиции и количества.')
        return
      }

      const nextStockValues = {
        ...stockRecord.values,
        available: String(parseInventoryNumber(stockRecord.values.available) + quantity),
      }

      try {
        await upsertInventoryStockValues(nextStockValues, stockRecord.id)
      } catch (error) {
        window.alert(
          error instanceof Error
            ? error.message
            : 'Не удалось синхронизировать остаток с inventory-stock.',
        )
        return
      }

      updateRecord({
        storeKey: INVENTORY_STOCK_STORE_KEY,
        recordId: stockRecord.id,
        title: stockRecord.title,
        subtitle: stockRecord.subtitle,
        values: nextStockValues,
        status: computeInventoryStockStatusFromValues(nextStockValues),
        note: `Приход по закупке ${record.id}: +${quantity} шт.`,
      })

      if (relatedPurchaseDocument) {
        updateStatus({
          storeKey: INVENTORY_DOCUMENTS_STORE_KEY,
          recordId: relatedPurchaseDocument.id,
          status: 'received',
          note: `Накладная принята по закупке ${record.id}.`,
        })
        updateStatus({
          storeKey: INVENTORY_DOCUMENTS_STORE_KEY,
          recordId: relatedPurchaseDocument.id,
          status: 'archived',
          note: `Накладная архивирована после приемки закупки ${record.id}.`,
        })
      }

      updateStatus({
        storeKey,
        recordId: record.id,
        status: INVENTORY_PURCHASE_RECEIVED_STATUS,
        note: `Товар принят на склад по закупке ${record.id}.`,
      })
      updateStatus({
        storeKey,
        recordId: record.id,
        status: nextStatus,
        note: `Закупка закрыта после приемки товара.`,
      })
      return
    }

    if (isFinancePaymentsCard) {
      const invoiceId = (record.values.invoice ?? '').trim()
      const invoiceRecord = financeInvoiceRecords.find((item) => item.id === invoiceId)
      if (actionKey === 'close') {
        if (!invoiceRecord || !canFinancePaymentFitInvoice(invoiceRecord, financePaymentRecords, record.values.amount, record.id)) {
          window.alert('Нельзя сверить платеж: сумма превышает доступный остаток по счету.')
          return
        }
      }

      const nextPaymentRecords = financePaymentRecords.map((payment) =>
        payment.id === record.id ? { ...payment, status: nextStatus } : payment,
      )

      updateStatus({
        storeKey,
        recordId: record.id,
        status: nextStatus,
        note: `Выполнено действие "${label}"`,
      })

      if (invoiceId && (actionKey === 'close' || actionKey === 'cancel')) {
        syncFinanceInvoiceFromPayments(
          invoiceId,
          nextPaymentRecords,
          `Счет пересчитан после действия "${label}" по платежу ${record.id}.`,
        )
      }
      return
    }

    if (isFinanceReportsCard && actionKey === 'post') {
      setReportActionError('')
      setIsReportGenerating(true)
      try {
        const exportResponse = await exportFinanceReport({
          report: financeReportType,
          format: financeReportFormat.toLowerCase(),
          owner: record.values.owner,
          period: (record.values.period ?? '').trim(),
        })
        const summaryValues = exportResponse.summary
          ? buildFinanceReportValuesFromSummary(exportResponse.summary)
          : {}
        const nextValues = {
          ...record.values,
          type: financeReportType,
          exportId: exportResponse.id,
          downloadUrl: exportResponse.downloadUrl ?? '',
          fileName: exportResponse.fileName ?? '',
          generatedAt: exportResponse.generatedAt ?? exportResponse.createdAt,
          ...summaryValues,
        }
        updateRecord({
          storeKey,
          recordId: record.id,
          title: record.title,
          subtitle: buildFinanceReportSubtitle(nextValues),
          values: nextValues,
          status: nextStatus,
          note: exportResponse.downloadUrl
            ? 'Отчет сформирован и готов к скачиванию.'
            : 'Отчет сформирован.',
        })
      } catch (error) {
        setReportActionError(
          error instanceof Error ? error.message : 'Не удалось сформировать отчет.',
        )
      } finally {
        setIsReportGenerating(false)
      }
      return
    }

    updateStatus({
      storeKey,
      recordId: record.id,
      status: nextStatus,
      note: `Выполнено действие "${label}"`,
    })
  }

  const updatePartsLine = (
    lineKey: string,
    field: 'sku' | 'title' | 'quantity',
    nextValue: string,
  ) => {
    setPartsLines((currentLines) =>
      currentLines.map((line) => {
        if (line.key !== lineKey) {
          return line
        }

        if (field === 'sku') {
          return applyWorkorderPartDraftLinePreview({
            ...line,
            sku: nextValue.trim().toUpperCase(),
            title: resolveWorkorderPartTitle(nextValue, stockRecords) || line.title,
            state: 'draft',
            procurementRequestId: '',
          }, stockRecords)
        }

        if (field === 'quantity') {
          return applyWorkorderPartDraftLinePreview({
            ...line,
            quantity: nextValue,
            state: 'draft',
            procurementRequestId: '',
          }, stockRecords)
        }

        return applyWorkorderPartDraftLinePreview({
          ...line,
          title: nextValue,
        }, stockRecords)
      }),
    )
    setIsPartsDirty(true)
    setPartsNotice('')
    setPartsError('')
  }

  const addPartsLine = () => {
    setPartsLines((currentLines) => [...currentLines, createEmptyWorkorderPartDraftLine()])
    setIsPartsDirty(true)
    setPartsNotice('')
  }

  const removePartsLine = (lineKey: string) => {
    setPartsLines((currentLines) => {
      const nextLines = currentLines.filter((line) => line.key !== lineKey)
      return nextLines.length > 0 ? nextLines : [createEmptyWorkorderPartDraftLine()]
    })
    setIsPartsDirty(true)
    setPartsNotice('')
    setPartsError('')
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isEditOpen) {
        closeEditModal()
        return
      }

      if (isEditableTarget(event.target)) {
        return
      }

      if (event.key.toLowerCase() === 'e' && editActionEnabled) {
        event.preventDefault()
        openEditModal()
      }

      if (event.key.toLowerCase() === 'r' && reopenAction && !reopenAction.disabled) {
        event.preventDefault()
        const nextStatus = reopenAction.nextStatus
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
  }, [closeEditModal, editActionEnabled, isEditOpen, openEditModal, record.id, reopenAction, storeKey, updateStatus])

  const submitEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isCarCatalogCard && !editTitle.trim()) {
      setEditError('Название обязательно')
      return
    }
    let nextValues = { ...editValues }

    const phoneValue = (nextValues.phone ?? '').trim()
    if (phoneValue) {
      const normalized = normalizePhoneStrict(phoneValue)
      if (!normalized.ok) {
        setEditError('Неверный формат телефона. Используйте +7 9XX XXXXXXX.')
        return
      }
      nextValues.phone = normalized.formatted
    }

    if (isInventoryStockCard) {
      nextValues.reserved = (nextValues.reserved ?? '').trim() || '0'
      const available = parseInventoryNumber(nextValues.available)
      const reserved = parseInventoryNumber(nextValues.reserved)
      const minimum = parseInventoryNumber(nextValues.min)
      if ([available, reserved, minimum].some((value) => Number.isNaN(value) || value < 0)) {
        setEditError('Остаток, резерв и минимальный остаток должны быть неотрицательными числами.')
        return
      }
      if (reserved > available) {
        setEditError('Резерв не может превышать доступный остаток.')
        return
      }
    }

    if (isInventoryPurchasesCard) {
      Object.assign(nextValues, normalizeInventoryPurchaseValues(nextValues))
      const quantity = Number(nextValues.quantity ?? '0')
      if (!nextValues.quantity || Number.isNaN(quantity) || quantity <= 0) {
        setEditError('Количество должно быть больше нуля.')
        return
      }
      if (nextValues.unitPrice === '') {
        setEditError('Цена за штуку обязательна.')
        return
      }
    }

    if (isCarCatalogCard) {
      const normalizedVIN = normalizeVIN(nextValues[VIN_FIELD_KEY] ?? '')
      if (!normalizedVIN) {
        setEditError('VIN обязателен для каталога автомобилей')
        return
      }
      if (!isCarModelValidForBrand(nextValues.brand ?? '', nextValues.model ?? '')) {
        setEditError('Модель должна соответствовать выбранной марке.')
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
      if (nextValues.price) {
        nextValues.price = formatMoneyString(nextValues.price)
      }
    }

    if (isDealCard) {
      const enriched = enrichDealValuesWithCarInfo(nextValues, getRecords(DEAL_CARS_STORE_KEY))
      Object.assign(nextValues, enriched)
    }

    let nextStatusOverride: string | undefined

    if (isFinanceInvoicesCard) {
      Object.assign(nextValues, normalizeFinanceInvoiceValues(nextValues))
      if (!nextValues.amount || Number(nextValues.amount.replace(/\s+/g, '')) <= 0) {
        setEditError('Сумма счета должна быть больше нуля.')
        return
      }

      const allocatedAmount = financePaymentRecords.reduce((sum, payment) => {
        if (payment.values.invoice !== record.id || payment.status === 'cancelled') {
          return sum
        }
        return sum + getFinancePaymentAmount(payment)
      }, 0)

      if (getFinanceInvoiceAmount(nextValues) < allocatedAmount) {
        setEditError('Сумма счета не может быть меньше суммы активных платежей.')
        return
      }

      const nextInvoiceRecord = {
        ...record,
        values: nextValues,
      }
      const nextInvoiceState = buildFinanceInvoiceState(nextInvoiceRecord, financePaymentRecords)
      nextValues.paidAmount = nextInvoiceState.paidAmount
      nextStatusOverride = nextInvoiceState.status
    }

    if (isFinancePaymentsCard) {
      Object.assign(nextValues, normalizeFinancePaymentValues(nextValues))
      const invoiceRecord = financeInvoiceRecords.find((item) => item.id === nextValues.invoice)
      if (!invoiceRecord) {
        setEditError('Выберите существующий счет для платежа.')
        return
      }
      if (invoiceRecord.id !== record.values.invoice && invoiceRecord.status !== 'issued') {
        setEditError('Новый счет для платежа должен быть в статусе "Выставлен".')
        return
      }
      if (!canFinancePaymentFitInvoice(invoiceRecord, financePaymentRecords, nextValues.amount, record.id)) {
        const availableAmount = getFinanceInvoiceAvailableAmount(invoiceRecord, financePaymentRecords, record.id)
        setEditError(`Сумма платежа превышает доступный остаток по счету: ${formatMoneyDisplay(String(availableAmount))}.`)
        return
      }
      Object.assign(nextValues, applyFinancePaymentInvoiceContext(nextValues, invoiceRecord))
    }
    if (storeKey === PLATFORM_USERS_STORE_KEY) {
      nextValues = normalizePlatformUserValues(nextValues)
    }

    const nextTitle = isCarCatalogCard
      ? buildCarTitle(nextValues.brand ?? '', nextValues.model ?? '', nextValues.year ?? '')
      : editTitle.trim()
    if (!nextTitle) {
      setEditError('Название обязательно')
      return
    }

    const warehouse = (nextValues.warehouse ?? '').trim()
    const nextSubtitle = isInventoryStockCard
      ? editSubtitle.trim() || (warehouse ? `Склад: ${warehouse}` : 'Карточка обновлена')
      : isInventoryPurchasesCard
        ? (() => {
            const supplier = (nextValues.supplier ?? '').trim()
            const stockLabel = resolveInventoryStockValue(nextValues.stockItemId ?? '', stockRecords)
            const parts = [
              supplier ? `Поставщик: ${supplier}` : '',
              stockLabel !== '-' ? stockLabel : '',
            ].filter(Boolean)
            return parts.join(' • ') || editSubtitle.trim() || 'Карточка обновлена'
          })()
        : isFinanceInvoicesCard
          ? buildFinanceInvoiceSubtitle(nextValues, getRecords)
          : isFinancePaymentsCard
            ? buildFinancePaymentSubtitle(nextValues)
            : isFinanceReportsCard
              ? buildFinanceReportSubtitle(nextValues)
              : isFinanceDocumentsCard
                ? buildFinanceDocumentSubtitle(nextValues, getRecords)
                : storeKey === PLATFORM_USERS_STORE_KEY
                  ? buildPlatformUserSubtitle(nextValues, getRecords) || editSubtitle.trim() || 'Карточка обновлена'
                  : storeKey === PLATFORM_ROLES_STORE_KEY
                  ? buildPlatformRoleSubtitle(nextValues) || editSubtitle.trim() || 'Карточка обновлена'
                    : editSubtitle.trim() || 'Карточка обновлена'

    if (isInventoryStockCard) {
      try {
        await upsertInventoryStockValues(nextValues, record.id)
      } catch (error) {
        setEditError(
          error instanceof Error
            ? error.message
            : 'Не удалось синхронизировать складскую позицию с inventory-stock.',
        )
        return
      }
    }

    updateRecord({
      storeKey,
      recordId: record.id,
      title: nextTitle,
      subtitle: nextSubtitle,
      values: nextValues,
      status:
        nextStatusOverride ??
        (isInventoryStockCard ? computeInventoryStockStatusFromValues(nextValues) : undefined),
    })
    setIsEditOpen(false)
  }

  const renderEditField = (key: string, value: string) => {
    const inventoryPurchaseField = inventoryPurchaseFields.find((field) => field.key === key)
    const baseField: EntityCreateField =
      tab.createFields.find((field) => field.key === key) ??
      inventoryPurchaseField ?? {
        key,
        label: key,
        placeholder: '',
      }
    const resolvedField = resolveEntityCreateField(storeKey, baseField)
    const isStoreReference = isStoreReferenceField(resolvedField)
    const isDealClientField = isDealCard && key === 'client'
    const isInventoryPurchaseAmountField = isInventoryPurchasesCard && key === 'amount'
    const isInventoryPurchaseNumericField =
      isInventoryPurchasesCard && (key === 'quantity' || key === 'unitPrice')
    const customText = isStoreReference ? editValues[getReferenceTextFieldKey(key)] ?? '' : ''

    if (isInventoryPurchaseAmountField) {
      return (
        <label key={key} className="field">
          <span>{resolvedField.label}</span>
          <input value={formatMoneyDisplay(value) || ''} placeholder={resolvedField.placeholder} readOnly />
        </label>
      )
    }

    if (resolvedField.inputType === 'date') {
      return (
        <label key={key} className="field">
          <span>{resolvedField.label}</span>
          <input
            type="date"
            value={value}
            onChange={(event) => applyEditFieldValue(key, event.target.value)}
          />
        </label>
      )
    }

    if (resolvedField.inputType === 'month') {
      const monthValue =
        storeKey === FINANCE_REPORTS_STORE_KEY && key === 'period'
          ? financeReportPeriodToMonthInputValue(value)
          : value
      return (
        <label key={key} className="field">
          <span>{resolvedField.label}</span>
          <input
            type="month"
            value={monthValue}
            onChange={(event) =>
              applyEditFieldValue(
                key,
                storeKey === FINANCE_REPORTS_STORE_KEY && key === 'period'
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
        <label key={key} className="field">
          <span>{resolvedField.label}</span>
          <input
            value={value}
            onChange={(event) => applyEditFieldValue(key, event.target.value)}
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
      formValues: editValues,
    })
    const filterValue = editSelectFilter[key] ?? ''
    const filteredOptions = filterValue
      ? options.filter((option) => option.label.toLowerCase().includes(filterValue.toLowerCase()))
      : options
    const hasMatchingOption = options.some((item) => item.value === value)
    const allowInlineCustom = !isDealClientField && !(isInventoryPurchasesCard && key === 'stockItemId')
    const showSelectSearch = !(storeKey === 'service/orders' && key === 'vin')
    const isCustom =
      resolvedField.allowCustom &&
      allowInlineCustom &&
      (editCustomMode[key] ||
        (isStoreReference ? Boolean(customText.trim()) : value.trim() !== '' && !hasMatchingOption))
    const selectValue = isCustom ? CUSTOM_SELECT_OPTION_VALUE : value

    const handleSelectChange = (nextValue: string) => {
      if (isDealClientField && nextValue === CUSTOM_SELECT_OPTION_VALUE) {
        openClientCreateModal()
        return
      }

      if (nextValue === CUSTOM_SELECT_OPTION_VALUE) {
        setEditCustomMode((prev) => ({ ...prev, [key]: true }))
        setEditValues((prev) => {
          const previous = prev[key] ?? ''
          const previousText = prev[getReferenceTextFieldKey(key)] ?? ''
          const previousIsKnown = options.some((item) => item.value === previous)
          const next =
            isStoreReference
              ? setStoreReferenceCustomText(
                  prev,
                  key,
                  previousIsKnown ? previousText : previousText || previous,
                )
              : { ...prev, [key]: previousIsKnown ? '' : previous }
          if (isDealCard && key === DEAL_VIN_FIELD_KEY) {
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
        {showSelectSearch ? (
          <input
            type="search"
            value={filterValue}
            onChange={(event) => setEditSelectFilter((prev) => ({ ...prev, [key]: event.target.value }))}
            placeholder="Поиск..."
          />
        ) : null}
        <select value={selectValue} onChange={(event) => handleSelectChange(event.target.value)}>
          <option value="">{resolvedField.emptyOptionLabel}</option>
          {filteredOptions.map((option) => (
            <option key={`${key}-${option.value}`} value={option.value}>
              {option.label}
            </option>
          ))}
          {resolvedField.allowCustom && allowInlineCustom ? (
            <option value={CUSTOM_SELECT_OPTION_VALUE}>Свой вариант...</option>
          ) : null}
        </select>
        {isCustom ? (
          <input
            value={isStoreReference ? customText : value}
            onChange={(event) => {
              setEditCustomMode((prev) => ({ ...prev, [key]: true }))
              applyEditFieldValue(
                isStoreReference ? getReferenceTextFieldKey(key) : key,
                event.target.value,
              )
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
          {!hideCardStatusBadge ? <StatusBadge label={currentStatus.label} tone={currentStatus.tone} /> : null}
          {isCarCatalogCard ? (
            <button
              className="btn-secondary"
              disabled={!canCreateDealFromCar}
              title={createDealFromCarReason}
              onClick={() => {
                handleCreateDealFromCar()
              }}
            >
              Оформить сделку
            </button>
          ) : null}
          {isDealCard || isSalesDocumentCard ? (
            <button
              className="btn-secondary"
              disabled={!canCreatePaymentFromCard}
              title={createPaymentFromCardReason}
              onClick={() => {
                handleCreatePaymentFromCard()
              }}
            >
              Оформить оплату
            </button>
          ) : null}
          {canDownloadSalesContractPdf ? (
            <button
              className="btn-secondary"
              disabled={isSalesDocumentDownloading}
              onClick={() => {
                void handleSalesContractDownload()
              }}
            >
              {isSalesDocumentDownloading ? 'Подготовка PDF...' : 'Скачать PDF договора'}
            </button>
          ) : null}
          {canDownloadFinanceReport ? (
            <button
              className="btn-secondary"
              disabled={isReportDownloading || isReportGenerating}
              onClick={() => {
                void handleFinanceReportDownload()
              }}
            >
              {isReportDownloading ? 'Скачивание...' : 'Скачать PDF'}
            </button>
          ) : null}
          {actionStates.map((action) => (
            <button
              key={action.key}
              className={action.critical ? 'btn-danger' : 'btn-secondary'}
              disabled={action.disabled}
              title={action.reason}
              onClick={() => {
                void runAction(action.key, action.label, action.critical)
              }}
            >
              {isFinanceReportsCard && action.key === 'post' && isReportGenerating
                ? 'Формирование...'
                : action.label}
            </button>
          ))}
        </div>
      </header>

      {reportActionError ? <p className="form-error">{reportActionError}</p> : null}
      {salesDocumentActionError ? <p className="form-error">{salesDocumentActionError}</p> : null}
      <p className="hint-row">Hotkeys: E редактировать, R переоткрыть, Esc закрыть диалог.</p>
      {isFinanceDocumentProxyCard && financeDocumentSource ? (
        <p className="hint-row">
          Источник:{' '}
          <Link to={buildRecordPath(financeDocumentSource.storeKey, financeDocumentSource.recordId) ?? '#'}>
            {financeDocumentSource.storeKey} / {financeDocumentSource.recordId}
          </Link>
        </p>
      ) : null}

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
          {isFinanceDocumentProxyCard
            ? 'Документ подгружается из другого отдела и доступен только для просмотра.'
            : 'Объект закрыт. Редактирование запрещено, доступны только разрешенные системные действия.'}
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
          {isInventoryStockCard ? (
            <p className="hint-row">
              Открытых закупок: {stockOpenPurchaseCount} • Накладных: {stockDocumentCount} • Счетов:{' '}
              {stockInvoiceCount}
            </p>
          ) : null}
          <div className="detail-grid">
            <div>
              <span>ID</span>
              <strong>{record.id}</strong>
            </div>
            <div>
              <span>Название</span>
              <strong>{record.title}</strong>
            </div>
            {!isDealCard ? (
              <div>
                <span>Описание</span>
                <strong>{record.subtitle}</strong>
              </div>
            ) : null}
            {dealPrimaryEntries.map(([key, value]) => (
              <div key={key}>
                <span>{resolveValueLabel(key)}</span>
                {(() => {
                  const displayValue = resolveValueDisplay(key, value)
                  const valuePath = resolveValuePath(key, value)
                  return valuePath && displayValue !== '-' ? (
                    <Link className="table-link" to={valuePath}>
                      {displayValue}
                    </Link>
                  ) : (
                    <strong>{displayValue}</strong>
                  )
                })()}
              </div>
            ))}
            {showDealCarLink ? (
              <div>
                <span>Автомобиль</span>
                {dealCarPath ? (
                  <Link className="table-link" to={dealCarPath}>
                    {dealCarValue}
                  </Link>
                ) : (
                  <strong>{dealCarValue}</strong>
                )}
                {dealCarMeta ? <p className="table-link__subtitle">{dealCarMeta}</p> : null}
              </div>
            ) : null}
            {detailEntries.map(([key, value]) => (
              <div key={key}>
                <span>{resolveValueLabel(key)}</span>
                {(() => {
                  const displayValue = resolveValueDisplay(key, value)
                  const valuePath = resolveValuePath(key, value)
                  return valuePath && displayValue !== '-' ? (
                    <Link className="table-link" to={valuePath}>
                      {displayValue}
                    </Link>
                  ) : (
                    <strong>{displayValue}</strong>
                  )
                })()}
              </div>
            ))}
          </div>
          {isServiceOrderCard ? (
            <section className="parts-panel">
              <div className="parts-panel__head">
                <div>
                  <h5>Запчасти</h5>
                  <p className="hint-row">
                    Выберите SKU и количество. Фактическое списание выполняется действием
                    {' '}
                    "Списать материалы".
                  </p>
                </div>
                <div className="detail-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void loadWorkorderPartsPlan()}
                    disabled={isPartsLoading || isPartsSaving || isPartsWriteoffRunning || isServiceOrderClosing}
                  >
                    Обновить
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={addPartsLine}
                    disabled={readOnly || isPartsLoading || isPartsSaving || isPartsWriteoffRunning || isServiceOrderClosing}
                  >
                    Добавить строку
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void persistWorkorderPartsPlan()}
                    disabled={
                      readOnly ||
                      !isPartsDirty ||
                      isPartsLoading ||
                      isPartsSaving ||
                      isPartsWriteoffRunning ||
                      isServiceOrderClosing
                    }
                  >
                    Сохранить строки
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => void handleWorkorderPartsWriteoff()}
                    disabled={
                      readOnly || isPartsLoading || isPartsSaving || isPartsWriteoffRunning || isServiceOrderClosing
                    }
                  >
                    {isPartsWriteoffRunning ? 'Списание...' : 'Списать сейчас'}
                  </button>
                </div>
              </div>
              <datalist id={`workorder-parts-${record.id}`}>
                {workorderPartOptions.map((option) => (
                  <option key={option.sku} value={option.sku}>
                    {option.title}
                  </option>
                ))}
              </datalist>
              {partsError ? <p className="parts-panel__message parts-panel__message--error">{partsError}</p> : null}
              {partsNotice ? <p className="parts-panel__message parts-panel__message--ok">{partsNotice}</p> : null}
              {isPartsLoading ? (
                <p className="hint-row">Загружаем план запчастей...</p>
              ) : (
                <div className="parts-panel__list">
                  {partsLines.map((line) => (
                    <div key={line.key} className="parts-panel__row">
                      <label className="field field--compact">
                        <span>SKU</span>
                        <input
                          list={`workorder-parts-${record.id}`}
                          value={line.sku}
                          onChange={(event) => updatePartsLine(line.key, 'sku', event.target.value)}
                          disabled={readOnly || isPartsSaving || isPartsWriteoffRunning || isServiceOrderClosing}
                          placeholder="PART-FILTER"
                        />
                      </label>
                      <label className="field field--compact">
                        <span>Деталь</span>
                          <input
                          value={line.title}
                          onChange={(event) => updatePartsLine(line.key, 'title', event.target.value)}
                          disabled={readOnly || isPartsSaving || isPartsWriteoffRunning || isServiceOrderClosing}
                          placeholder="Масляный фильтр"
                        />
                      </label>
                      <label className="field field--compact">
                        <span>Кол-во</span>
                        <input
                          inputMode="numeric"
                          value={line.quantity}
                          onChange={(event) => updatePartsLine(line.key, 'quantity', event.target.value)}
                          disabled={readOnly || isPartsSaving || isPartsWriteoffRunning || isServiceOrderClosing}
                          placeholder="1"
                        />
                      </label>
                      <div className="parts-panel__status">
                        <span>Доступно: {line.availableQuantity}</span>
                        <span>Дефицит: {line.missingQuantity}</span>
                        <span>Статус: {line.state || 'draft'}</span>
                        <span>Заявка: {line.procurementRequestId || '-'}</span>
                      </div>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => removePartsLine(line.key)}
                        disabled={readOnly || isPartsSaving || isPartsWriteoffRunning || isServiceOrderClosing}
                      >
                        Удалить
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}
          {isInventoryStockCard ? (
            <div className="detail-actions">
              <button type="button" className="btn-secondary" onClick={openPurchaseCreate}>
                Создать закупку
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => openStockRelatedRecords(INVENTORY_DOCUMENTS_STORE_KEY)}
                disabled={stockDocumentCount === 0}
                title={stockDocumentCount === 0 ? 'Связанных накладных пока нет' : ''}
              >
                Накладные
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => openStockRelatedRecords(FINANCE_INVOICES_STORE_KEY)}
                disabled={stockInvoiceCount === 0}
                title={stockInvoiceCount === 0 ? 'Связанных счетов пока нет' : ''}
              >
                Счета
              </button>
            </div>
          ) : null}
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
            {record.related.map((item) => {
              const relatedPath = buildRelatedRecordPath(item)
              return (
                <li key={item.id}>
                  <span>{item.label}</span>
                  {relatedPath ? (
                    <Link className="table-link" to={relatedPath}>
                      {item.value}
                    </Link>
                  ) : (
                    <strong>{item.value}</strong>
                  )}
                </li>
              )
            })}
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
              <button className="btn-ghost" onClick={closeEditModal}>
                Закрыть
              </button>
            </header>
            <form className="modal__body modal__body--grid" onSubmit={submitEdit}>
              {!isCarCatalogCard ? (
                <label className="field">
                  <span>Название</span>
                  <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
                </label>
              ) : null}
              <label className="field">
                <span>Описание</span>
                <input value={editSubtitle} onChange={(event) => setEditSubtitle(event.target.value)} />
              </label>
              {isDealCard
                ? dealEditFieldKeys.map((key) => renderEditField(key, editValues[key] ?? ''))
                : isInventoryPurchasesCard
                  ? inventoryPurchaseEditFieldKeys.map((key) => renderEditField(key, editValues[key] ?? ''))
                  : genericEditEntries.map(([key, value]) => renderEditField(key, value))}
              {editError ? <p className="form-error">{editError}</p> : null}
              <div className="modal__actions modal__actions--full">
                <button type="button" className="btn-secondary" onClick={closeEditModal}>
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

      <ClientQuickCreateModal
        key={clientCreateVersion}
        isOpen={isClientCreateOpen}
        onCancel={() => setIsClientCreateOpen(false)}
        onCreated={(client) => {
          setEditCustomMode((prev) => ({ ...prev, client: false }))
          applyEditFieldValue('client', client.id)
          setIsClientCreateOpen(false)
        }}
      />
    </>
  )
}

export function EntityCardPage() {
  const { subsystemSlug, tabSlug, recordId } = useParams()
  const subsystem = subsystemSlug ? getSubsystemBySlug(subsystemSlug) : undefined
  const tab = subsystem?.tabs.find((entityTab) => entityTab.slug === tabSlug)
  const { getLandingPath } = useAuth()
  const { getRecords } = useEntityStore()

  if (!subsystem || !recordId) {
    return <Navigate to={getLandingPath()} replace />
  }

  if (!tab) {
    return <Navigate to={`/${subsystem.slug}`} replace />
  }

  const storeKey = buildStoreKey(subsystem.slug, tab.slug)
  const record = resolveEntityRecord(storeKey, recordId, getRecords)

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
