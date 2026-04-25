import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { StatusBadge } from '../components'
import type { SubsystemNavItem } from '../config/navigation'
import { useEntityStore } from '../domain/EntityStoreContext'
import {
  buildCarDemandAnalytics,
  buildPartsDemandAnalytics,
  type CarDemandModelItem,
  type CarDemandVehicleItem,
  type PartsDemandItem,
} from '../domain/demandAnalytics'
import { buildFinanceAnalyticsSummary } from '../domain/financeAnalytics'
import {
  FINANCE_DOCUMENTS_STORE_KEY,
  FINANCE_INVOICES_STORE_KEY,
  FINANCE_PAYMENTS_STORE_KEY,
  FINANCE_REPORTS_STORE_KEY,
  resolveEntityRecords,
} from '../domain/finance'
import { formatMoneyString } from '../domain/formatters'
import type { EntityRecord, EntityTabDefinition, StatusTone } from '../domain/model'
import { getStatusDefinition } from '../domain/selectors'
import { fetchPartsUsages } from '../domain/servicePartsUsageApi'
import { getSubsystemBySlug } from '../domain/subsystems'

type QuickLink = {
  to: string
  label: string
  note: string
}

type DomainCard = {
  key: string
  title: string
  value: string
  caption: string
  note: string
}

type ExposureInvoice = {
  record: EntityRecord
  openAmount: number
}

type ChartDatum = {
  key: string
  label: string
  value: number
  toneClassName?: string
}

const invoiceStatusToneClassByStatus: Record<string, string> = {
  paid: 'finance-analytics__bar-fill--positive',
  partially_paid: 'finance-analytics__bar-fill--warn',
  issued: 'finance-analytics__bar-fill--primary',
  overdue: 'finance-analytics__bar-fill--danger',
  cancelled: 'finance-analytics__bar-fill--neutral',
}

const quickLinks: QuickLink[] = [
  { to: '/finance/invoices', label: 'Счета', note: 'AR/AP и сроки оплаты' },
  { to: '/finance/payments', label: 'Платежи', note: 'Подтверждение и сверка' },
  { to: '/finance/reports', label: 'Отчеты', note: 'Срезы и экспорт' },
  { to: '/finance/documents', label: 'Документы', note: 'Финансовый документооборот' },
]

function parseMoney(value: string | undefined): number {
  const normalized = (value ?? '').replace(/\s+/g, '')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatMoney(value: number): string {
  return formatMoneyString(String(Math.round(value))) || '0'
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('ru-RU').format(value)
}

function invoiceOpenAmount(record: EntityRecord): number {
  return Math.max(0, parseMoney(record.values.amount) - parseMoney(record.values.paidAmount))
}

function resolveStatusMeta(
  tab: EntityTabDefinition | undefined,
  status: string,
): { label: string; tone: StatusTone } {
  const definition = tab ? getStatusDefinition(tab, status) : undefined
  return {
    label: definition?.label ?? status,
    tone: definition?.tone ?? 'neutral',
  }
}

function renderEmpty(message: string) {
  return <p className="finance-analytics__empty">{message}</p>
}

function renderDemandList<T extends CarDemandModelItem | CarDemandVehicleItem | PartsDemandItem>(
  items: T[],
  renderDescription: (item: T) => string,
) {
  return (
    <ul className="finance-analytics__rank-list">
      {items.map((item) => (
        <li key={item.key} className="finance-analytics__rank-item">
          <div>
            <strong>{'title' in item ? item.title : item.label}</strong>
            <p>{renderDescription(item)}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

function normalizeDueMonthToken(value: string | undefined): string | null {
  const normalized = (value ?? '').trim()
  const match = normalized.match(/^(\d{4})-(\d{2})-\d{2}$/)
  if (!match) {
    return null
  }
  const [, year, month] = match
  const monthNumber = Number(month)
  if (monthNumber < 1 || monthNumber > 12) {
    return null
  }
  return `${year}-${month}`
}

function formatMonthToken(token: string): string {
  const match = token.match(/^(\d{4})-(\d{2})$/)
  if (!match) {
    return token
  }
  return `${match[2]}.${match[1]}`
}

function renderBarChart(
  items: ChartDatum[],
  valueFormatter: (value: number) => string,
) {
  if (items.length === 0) {
    return null
  }
  const maxValue = Math.max(...items.map((item) => item.value), 1)
  return (
    <div className="finance-analytics__bar-chart">
      {items.map((item) => {
        const widthPercent = item.value <= 0 ? 0 : (item.value / maxValue) * 100
        return (
          <div key={item.key} className="finance-analytics__bar-row">
            <span className="finance-analytics__bar-label">{item.label}</span>
            <div className="finance-analytics__bar-track">
              <span
                className={`finance-analytics__bar-fill ${item.toneClassName ?? ''}`}
                style={{ width: `${widthPercent}%` }}
              />
            </div>
            <strong className="finance-analytics__bar-value">{valueFormatter(item.value)}</strong>
          </div>
        )
      })}
    </div>
  )
}

function renderTrendChart(points: ChartDatum[]) {
  if (points.length === 0) {
    return null
  }

  const width = 560
  const height = 170
  const left = 16
  const top = 12
  const right = width - 16
  const bottom = height - 24
  const plotWidth = right - left
  const plotHeight = bottom - top
  const maxValue = Math.max(...points.map((point) => point.value), 1)
  const stepX = points.length > 1 ? plotWidth / (points.length - 1) : 0

  const coordinates = points.map((point, index) => {
    const x = left + index * stepX
    const y = bottom - (point.value / maxValue) * plotHeight
    return { x, y, point }
  })

  const linePath =
    coordinates.length > 1
      ? coordinates
          .map((coordinate, index) =>
            `${index === 0 ? 'M' : 'L'} ${coordinate.x.toFixed(2)} ${coordinate.y.toFixed(2)}`,
          )
          .join(' ')
      : ''
  const areaPath =
    coordinates.length > 1
      ? `${linePath} L ${coordinates[coordinates.length - 1].x.toFixed(2)} ${bottom.toFixed(2)} L ${coordinates[0].x.toFixed(2)} ${bottom.toFixed(2)} Z`
      : ''

  return (
    <div className="finance-analytics__trend">
      <svg
        className="finance-analytics__trend-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Finance trend chart"
      >
        <line
          x1={left}
          y1={bottom}
          x2={right}
          y2={bottom}
          className="finance-analytics__trend-axis-line"
        />
        {coordinates.length > 1 ? <path d={areaPath} className="finance-analytics__trend-area" /> : null}
        {coordinates.length > 1 ? <path d={linePath} className="finance-analytics__trend-line" /> : null}
        {coordinates.map((coordinate) => (
          <circle
            key={coordinate.point.key}
            cx={coordinate.x}
            cy={coordinate.y}
            r={3}
            className="finance-analytics__trend-point"
          />
        ))}
      </svg>
      <div
        className="finance-analytics__trend-axis-labels"
        style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
      >
        {points.map((point) => (
          <span key={point.key}>{point.label}</span>
        ))}
      </div>
    </div>
  )
}

export function FinanceAnalyticsDashboard({ item }: { item: SubsystemNavItem }) {
  const { getRecords } = useEntityStore()
  const [partsDemandError, setPartsDemandError] = useState('')
  const [partsDemandLoading, setPartsDemandLoading] = useState(true)
  const [partsDemandSnapshot, setPartsDemandSnapshot] = useState<
    Awaited<ReturnType<typeof fetchPartsUsages>>
  >([])

  const subsystem = getSubsystemBySlug('finance')
  const invoicesTab = subsystem?.tabs.find((tab) => tab.slug === 'invoices')
  const reportsTab = subsystem?.tabs.find((tab) => tab.slug === 'reports')

  const invoiceRecords = getRecords(FINANCE_INVOICES_STORE_KEY)
  const paymentRecords = getRecords(FINANCE_PAYMENTS_STORE_KEY)
  const reportRecords = getRecords(FINANCE_REPORTS_STORE_KEY)
  const dealRecords = getRecords('crm-sales/deals')
  const carRecords = getRecords('crm-sales/cars')
  const stockRecords = getRecords('inventory/stock')
  const documentRecords = useMemo(
    () => resolveEntityRecords(FINANCE_DOCUMENTS_STORE_KEY, getRecords),
    [getRecords],
  )

  useEffect(() => {
    let isCancelled = false

    const loadPartsDemand = async () => {
      setPartsDemandLoading(true)
      setPartsDemandError('')
      try {
        const usages = await fetchPartsUsages('writeoff')
        if (!isCancelled) {
          setPartsDemandSnapshot(usages)
        }
      } catch (error) {
        if (!isCancelled) {
          setPartsDemandError(
            error instanceof Error
              ? error.message
              : 'Не удалось загрузить факт списаний по запчастям.',
          )
        }
      } finally {
        if (!isCancelled) {
          setPartsDemandLoading(false)
        }
      }
    }

    void loadPartsDemand()
    return () => {
      isCancelled = true
    }
  }, [])

  const carDemand = useMemo(
    () => buildCarDemandAnalytics(dealRecords, carRecords),
    [carRecords, dealRecords],
  )
  const partsDemand = useMemo(
    () => buildPartsDemandAnalytics(partsDemandSnapshot, stockRecords),
    [partsDemandSnapshot, stockRecords],
  )
  const summary = useMemo(
    () =>
      buildFinanceAnalyticsSummary({
        invoices: invoiceRecords,
        payments: paymentRecords,
        reports: reportRecords,
        documents: documentRecords,
        deals: dealRecords,
        stockRecords,
        partsDemand,
      }),
    [
      dealRecords,
      documentRecords,
      invoiceRecords,
      partsDemand,
      paymentRecords,
      reportRecords,
      stockRecords,
    ],
  )

  const exposureInvoices = useMemo<ExposureInvoice[]>(
    () =>
      invoiceRecords
        .filter((record) => record.status === 'issued')
        .map((record) => ({
          record,
          openAmount: invoiceOpenAmount(record),
        }))
        .sort((left, right) => right.openAmount - left.openAmount)
        .slice(0, 4),
    [invoiceRecords],
  )

  const latestReports = reportRecords.slice(0, 3)
  const topDemandModels = carDemand.models.slice(0, 5)
  const topDemandVehicles = carDemand.vehicles.slice(0, 4)
  const topDemandParts = partsDemand.slice(0, 5)

  const domainCards: DomainCard[] = [
    {
      key: 'sales',
      title: 'Продажи',
      value: formatMoney(summary.salesRevenue),
      caption: 'Выручка по закрытым сделкам',
      note: `${formatCount(summary.salesClosedDealsCount)} закрытых сделок, документов: ${formatCount(summary.sourceDocumentCounts.sales)}`,
    },
    {
      key: 'service',
      title: 'Сервис',
      value: formatCount(summary.serviceDemandQuantity),
      caption: 'Списано запчастей',
      note: partsDemandLoading
        ? 'Загружаем фактические списания по сервису.'
        : partsDemandError
          ? partsDemandError
          : `${formatCount(summary.serviceDemandOperations)} операций writeoff, документов: ${formatCount(summary.sourceDocumentCounts.service)}`,
    },
    {
      key: 'inventory',
      title: 'Склад',
      value: formatMoney(summary.apOpenTotal),
      caption: 'Открытая кредиторка',
      note: `${formatCount(summary.inventoryAttentionCount)} позиций с низким или критичным остатком, документов: ${formatCount(summary.sourceDocumentCounts.inventory)}`,
    },
  ]

  const flowDistribution = useMemo<ChartDatum[]>(
    () =>
      [
        {
          key: 'outgoing-issued',
          label: 'Исходящие счета',
          value: summary.outgoingIssuedTotal,
          toneClassName: 'finance-analytics__bar-fill--primary',
        },
        {
          key: 'incoming-issued',
          label: 'Входящие счета',
          value: summary.incomingIssuedTotal,
          toneClassName: 'finance-analytics__bar-fill--secondary',
        },
        {
          key: 'reconciled-payments',
          label: 'Сверенные платежи',
          value: summary.reconciledPaymentsTotal,
          toneClassName: 'finance-analytics__bar-fill--positive',
        },
      ].filter((item) => item.value > 0),
    [summary.incomingIssuedTotal, summary.outgoingIssuedTotal, summary.reconciledPaymentsTotal],
  )

  const invoiceStatusDistribution = useMemo<ChartDatum[]>(() => {
    const counter = new Map<string, number>()
    for (const invoice of invoiceRecords) {
      const status = (invoice.status ?? '').trim().toLowerCase() || 'unknown'
      counter.set(status, (counter.get(status) ?? 0) + 1)
    }

    return Array.from(counter.entries())
      .map(([status, count]) => ({
        key: status,
        label: resolveStatusMeta(invoicesTab, status).label,
        value: count,
        toneClassName:
          invoiceStatusToneClassByStatus[status] ?? 'finance-analytics__bar-fill--neutral',
      }))
      .sort((left, right) => right.value - left.value)
  }, [invoiceRecords, invoicesTab])

  const paymentMethodDistribution = useMemo<ChartDatum[]>(() => {
    const counter = new Map<string, number>()
    for (const payment of paymentRecords) {
      const normalizedMethod = (payment.values.method ?? '').trim().toLowerCase()
      const label = normalizedMethod === '' ? 'Не указан' : normalizedMethod.replaceAll('_', ' ')
      counter.set(label, (counter.get(label) ?? 0) + 1)
    }

    return Array.from(counter.entries())
      .map(([label, count], index) => ({
        key: `${label}-${index}`,
        label,
        value: count,
        toneClassName:
          index % 2 === 0
            ? 'finance-analytics__bar-fill--secondary'
            : 'finance-analytics__bar-fill--primary',
      }))
      .sort((left, right) => right.value - left.value)
      .slice(0, 5)
  }, [paymentRecords])

  const openBalanceTrend = useMemo<ChartDatum[]>(() => {
    const totalsByMonth = new Map<string, number>()
    for (const invoice of invoiceRecords) {
      if (invoice.status === 'cancelled') {
        continue
      }
      const monthToken = normalizeDueMonthToken(invoice.values.dueDate)
      if (!monthToken) {
        continue
      }
      totalsByMonth.set(monthToken, (totalsByMonth.get(monthToken) ?? 0) + invoiceOpenAmount(invoice))
    }

    return Array.from(totalsByMonth.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(-6)
      .map(([token, value]) => ({
        key: token,
        label: formatMonthToken(token),
        value,
      }))
  }, [invoiceRecords])

  return (
    <section className="finance-analytics">
      <header className="finance-analytics__hero">
        <div className="finance-analytics__hero-main">
          <p className="finance-analytics__eyebrow">Analytics</p>
          <h3 className="finance-analytics__title">
            Финансовая картина без операционного шума
          </h3>
          <p className="finance-analytics__subtitle">
            {item.summary} Экран собран как обзор: потоки денег, спрос, документы и
            сигналы по доменам продаж, сервиса и склада.
          </p>

          <div className="finance-analytics__hero-actions">
            {quickLinks.map((link) => (
              <Link key={link.to} className="finance-analytics__chip" to={link.to}>
                <strong>{link.label}</strong>
                <span>{link.note}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="finance-analytics__hero-meta">
          <div className="finance-analytics__hero-stat">
            <span>Счета</span>
            <strong>{formatCount(summary.invoiceCount)}</strong>
          </div>
          <div className="finance-analytics__hero-stat">
            <span>Платежи</span>
            <strong>{formatCount(summary.paymentCount)}</strong>
          </div>
          <div className="finance-analytics__hero-stat">
            <span>Отчеты</span>
            <strong>{formatCount(summary.reportCount)}</strong>
          </div>
          <div className="finance-analytics__hero-stat">
            <span>Документы</span>
            <strong>{formatCount(summary.documentCount)}</strong>
          </div>
        </div>
      </header>

      <div className="finance-analytics__kpis">
        <article className="finance-analytics__kpi finance-analytics__kpi--accent">
          <span>Открытая дебиторка</span>
          <strong>{formatMoney(summary.arOpenTotal)}</strong>
          <p>Общий исходящий контур: {formatMoney(summary.outgoingIssuedTotal)}</p>
        </article>
        <article className="finance-analytics__kpi">
          <span>Открытая кредиторка</span>
          <strong>{formatMoney(summary.apOpenTotal)}</strong>
          <p>Общий входящий контур: {formatMoney(summary.incomingIssuedTotal)}</p>
        </article>
        <article className="finance-analytics__kpi">
          <span>Сверенные платежи</span>
          <strong>{formatMoney(summary.reconciledPaymentsTotal)}</strong>
          <p>Активных платежей: {formatCount(summary.paymentCount)}</p>
        </article>
        <article className="finance-analytics__kpi">
          <span>Просроченные счета</span>
          <strong>{formatCount(summary.overdueInvoiceCount)}</strong>
          <p>
            AR: {formatCount(summary.overdueOutgoingCount)} • AP:{' '}
            {formatCount(summary.overdueIncomingCount)}
          </p>
        </article>
      </div>

      <div className="finance-analytics__grid finance-analytics__grid--primary">
        <article className="finance-analytics__panel finance-analytics__panel--wide">
          <div className="finance-analytics__panel-head">
            <div>
              <p className="finance-analytics__panel-tag">Потоки</p>
              <h4>Деньги и отчетный контур</h4>
            </div>
            <p>
              Снимок собран из счетов, платежей, отчетов и финансовых документов.
            </p>
          </div>

          <div className="finance-analytics__flow-grid">
            <article className="finance-analytics__flow-card">
              <span>Исходящий контур</span>
              <strong>{formatMoney(summary.outgoingIssuedTotal)}</strong>
              <p>Открыто AR: {formatMoney(summary.arOpenTotal)}</p>
              <small>Просрочено: {formatCount(summary.overdueOutgoingCount)}</small>
            </article>
            <article className="finance-analytics__flow-card">
              <span>Входящий контур</span>
              <strong>{formatMoney(summary.incomingIssuedTotal)}</strong>
              <p>Открыто AP: {formatMoney(summary.apOpenTotal)}</p>
              <small>Просрочено: {formatCount(summary.overdueIncomingCount)}</small>
            </article>
            <article className="finance-analytics__flow-card">
              <span>Отчетность</span>
              <strong>{formatCount(summary.generatedReportCount)}</strong>
              <p>Сформировано отчетов</p>
              <small>
                Draft: {formatCount(summary.draftReportCount)} • Архив:{' '}
                {formatCount(summary.archivedReportCount)}
              </small>
            </article>
          </div>

          <div className="finance-analytics__subsection">
            <p className="finance-analytics__subheading">График потоков</p>
            {flowDistribution.length === 0
              ? renderEmpty('Недостаточно данных для визуализации потоков.')
              : renderBarChart(flowDistribution, formatMoney)}
          </div>

          <div className="finance-analytics__subsection">
            <p className="finance-analytics__subheading">Открытый остаток по сроку оплаты</p>
            {openBalanceTrend.length === 0
              ? renderEmpty('Недостаточно счетов со сроком оплаты для построения динамики.')
              : renderTrendChart(openBalanceTrend)}
          </div>
        </article>

        <article className="finance-analytics__panel">
          <div className="finance-analytics__panel-head">
            <div>
              <p className="finance-analytics__panel-tag">Домены</p>
              <h4>Витрины по направлениям</h4>
            </div>
          </div>

          <div className="finance-analytics__domain-list">
            {domainCards.map((card) => (
              <article key={card.key} className="finance-analytics__domain-card">
                <span>{card.title}</span>
                <strong>{card.value}</strong>
                <p>{card.caption}</p>
                <small>{card.note}</small>
              </article>
            ))}
          </div>
        </article>
      </div>

      <div className="finance-analytics__grid">
        <article className="finance-analytics__panel">
          <div className="finance-analytics__panel-head">
            <div>
              <p className="finance-analytics__panel-tag">Спрос</p>
              <h4>Автомобили</h4>
            </div>
            <p>Закрытые сделки из CRM формируют обзор по моделям и проданным VIN.</p>
          </div>

          <div className="finance-analytics__subsection">
            <p className="finance-analytics__subheading">Топ моделей</p>
            {topDemandModels.length === 0
              ? renderEmpty('Пока нет закрытых сделок для аналитики спроса по моделям.')
              : renderDemandList(
                  topDemandModels,
                  (demand) =>
                    `Продаж: ${formatCount(demand.salesCount)} • Выручка: ${formatMoney(demand.revenue)}`,
                )}
          </div>

          <div className="finance-analytics__subsection">
            <p className="finance-analytics__subheading">Проданные автомобили</p>
            {topDemandVehicles.length === 0
              ? renderEmpty('Проданные автомобили еще не сформировали достаточный срез.')
              : renderDemandList(
                  topDemandVehicles,
                  (demand) =>
                    `${demand.vin} • Продаж: ${formatCount(demand.salesCount)} • Выручка: ${formatMoney(demand.revenue)}`,
                )}
          </div>
        </article>

        <article className="finance-analytics__panel">
          <div className="finance-analytics__panel-head">
            <div>
              <p className="finance-analytics__panel-tag">Сервис</p>
              <h4>Спрос на запчасти</h4>
            </div>
            <p>Основано на фактических writeoff-операциях сервиса и остатках склада.</p>
          </div>

          {partsDemandLoading ? (
            renderEmpty('Загружаем фактические списания по запчастям.')
          ) : partsDemandError ? (
            <p className="finance-analytics__error">{partsDemandError}</p>
          ) : topDemandParts.length === 0 ? (
            renderEmpty('Пока нет фактических списаний, из которых можно собрать спрос.')
          ) : (
            renderDemandList(
              topDemandParts,
              (demand) =>
                `${demand.key} • Списано: ${formatCount(demand.quantity)} • Операций: ${formatCount(demand.operations)}`,
            )
          )}
        </article>
      </div>

      <div className="finance-analytics__grid">
        <article className="finance-analytics__panel">
          <div className="finance-analytics__panel-head">
            <div>
              <p className="finance-analytics__panel-tag">Риски</p>
              <h4>Крупные открытые счета</h4>
            </div>
            <p>Точки внимания для AR/AP с максимальным открытым остатком.</p>
          </div>

          <div className="finance-analytics__subsection">
            <p className="finance-analytics__subheading">Структура статусов счетов</p>
            {invoiceStatusDistribution.length === 0
              ? renderEmpty('Статусы счетов пока отсутствуют.')
              : renderBarChart(invoiceStatusDistribution, formatCount)}
          </div>

          {exposureInvoices.length === 0 ? (
            renderEmpty('Открытых счетов с остатком сейчас нет.')
          ) : (
            <ul className="finance-analytics__signal-list">
              {exposureInvoices.map(({ record, openAmount }) => {
                const statusMeta = resolveStatusMeta(invoicesTab, record.status)
                return (
                  <li key={record.id} className="finance-analytics__signal-item">
                    <div>
                      <strong>{record.id}</strong>
                      <p>{record.subtitle}</p>
                    </div>
                    <div className="finance-analytics__signal-meta">
                      <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
                      <span>{formatMoney(openAmount)}</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </article>

        <article className="finance-analytics__panel">
          <div className="finance-analytics__panel-head">
            <div>
              <p className="finance-analytics__panel-tag">Отчеты</p>
              <h4>Последние финансовые срезы</h4>
            </div>
            <p>Быстрый обзор состояния отчетов и распределения документов по источникам.</p>
          </div>

          <div className="finance-analytics__subsection">
            <p className="finance-analytics__subheading">Последние отчеты</p>
            {latestReports.length === 0 ? (
              renderEmpty('Отчетов пока нет.')
            ) : (
              <ul className="finance-analytics__signal-list">
                {latestReports.map((report) => {
                  const statusMeta = resolveStatusMeta(reportsTab, report.status)
                  return (
                    <li key={report.id} className="finance-analytics__signal-item">
                      <div>
                        <strong>{report.title}</strong>
                        <p>
                          {report.subtitle ||
                            `${report.values.period ?? ''} • ${report.values.format ?? ''}`}
                        </p>
                      </div>
                      <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="finance-analytics__subsection">
            <p className="finance-analytics__subheading">Методы платежей</p>
            {paymentMethodDistribution.length === 0
              ? renderEmpty('Нет данных по методам платежей.')
              : renderBarChart(paymentMethodDistribution, formatCount)}
          </div>

          <div className="finance-analytics__subsection">
            <p className="finance-analytics__subheading">Источники документов</p>
            <div className="finance-analytics__source-grid">
              <div className="finance-analytics__source-card">
                <span>Финансы</span>
                <strong>{formatCount(summary.sourceDocumentCounts.finance)}</strong>
              </div>
              <div className="finance-analytics__source-card">
                <span>Продажи</span>
                <strong>{formatCount(summary.sourceDocumentCounts.sales)}</strong>
              </div>
              <div className="finance-analytics__source-card">
                <span>Сервис</span>
                <strong>{formatCount(summary.sourceDocumentCounts.service)}</strong>
              </div>
              <div className="finance-analytics__source-card">
                <span>Склад</span>
                <strong>{formatCount(summary.sourceDocumentCounts.inventory)}</strong>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  )
}

