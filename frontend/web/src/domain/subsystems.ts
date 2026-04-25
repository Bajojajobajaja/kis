import type {
  ActionKey,
  EntityActionDefinition,
  EntityCreateField,
  EntityStatusActionDefinition,
  EntityTabDefinition,
  SubsystemDefinition,
  SubsystemSlug,
} from './model'
import { buildStoreKey } from './model'

type RawEntityTabDefinition = Omit<EntityTabDefinition, 'statusActions'> & {
  actionStatusMap?: Partial<Record<ActionKey, string>>
  statusActions?: Partial<Record<string, EntityStatusActionDefinition[]>>
}

type RawSubsystemDefinition = Omit<SubsystemDefinition, 'tabs'> & {
  tabs: RawEntityTabDefinition[]
}

const financeInvoiceCreateFields: EntityCreateField[] = [
  { key: 'title', label: 'Название', placeholder: 'Счет на оплату WO-10035', required: true },
  { key: 'counterparty', label: 'Контрагент', placeholder: 'ООО АВТОПАРК', required: true },
  { key: 'direction', label: 'Тип счета', placeholder: 'Исходящий', required: true },
  { key: 'amount', label: 'Сумма', placeholder: '185 000', required: true },
  { key: 'dueDate', label: 'Срок оплаты', placeholder: '2026-03-11', required: true },
]

const financePaymentCreateFields: EntityCreateField[] = [
  { key: 'title', label: 'Название', placeholder: 'Оплата по INV-100103', required: true },
  { key: 'invoice', label: 'Счет', placeholder: 'INV-100103', required: true },
  { key: 'amount', label: 'Сумма', placeholder: '185 000', required: true },
  { key: 'method', label: 'Метод', placeholder: 'Банковский перевод', required: true },
]

const financeReportCreateFields: EntityCreateField[] = [
  { key: 'title', label: 'Название', placeholder: 'AR/AP Февраль', required: true },
  { key: 'type', label: 'Тип отчета', placeholder: 'AR/AP', required: true },
  { key: 'period', label: 'Период', placeholder: '02.2026', required: true },
  { key: 'format', label: 'Формат', placeholder: 'PDF', required: true },
  { key: 'owner', label: 'Ответственный', placeholder: 'Финансовый менеджер', required: true },
]

const financeDocumentCreateFields: EntityCreateField[] = [
  { key: 'title', label: 'Название', placeholder: 'Платежное поручение', required: true },
  { key: 'number', label: 'Номер', placeholder: 'PP-88017', required: true },
  { key: 'docType', label: 'Тип', placeholder: 'Платежное поручение', required: true },
  { key: 'counterparty', label: 'Контрагент', placeholder: 'ООО Партс', required: true },
  { key: 'owner', label: 'Ответственный', placeholder: 'Бухгалтер' },
]

const inventoryStockCreateFields: EntityCreateField[] = [
  { key: 'title', label: 'Название', placeholder: 'Масляный фильтр', required: true },
  { key: 'sku', label: 'SKU', placeholder: 'PART-FILTER', required: true },
  { key: 'available', label: 'Количество', placeholder: '14', required: true },
  { key: 'reserved', label: 'В резерве', placeholder: '0' },
  { key: 'min', label: 'Мин. остаток', placeholder: '10', required: true },
  { key: 'warehouse', label: 'Склад', placeholder: 'Основной', required: true },
]

const inventoryPurchaseCreateFields: EntityCreateField[] = [
  { key: 'title', label: 'Название', placeholder: 'Заказ фильтров', required: true },
  { key: 'stockItemId', label: 'Товар', placeholder: 'STK-2101', required: true },
  { key: 'supplier', label: 'Поставщик', placeholder: 'ООО Партс', required: true },
  { key: 'amount', label: 'Сумма', placeholder: '340 000', required: true },
  { key: 'eta', label: 'Срок поставки', placeholder: '2026-03-10', required: true },
]

const inventoryDocumentCreateFields: EntityCreateField[] = [
  { key: 'title', label: 'Название', placeholder: 'Накладная поставки', required: true },
  { key: 'number', label: 'Номер', placeholder: 'WH-30005', required: true },
  { key: 'supplier', label: 'Поставщик', placeholder: 'ООО Партс', required: true },
  { key: 'owner', label: 'Ответственный', placeholder: 'Кладовщик' },
]

const tabOverrides: Record<string, Partial<RawEntityTabDefinition>> = {
  'crm-sales/clients': {
    hideStatusUi: true,
    statusActions: {
      active: [
        { key: 'edit', label: 'Редактировать' },
        { key: 'delete', label: 'Удалить', critical: true },
      ],
      paused: [
        { key: 'edit', label: 'Редактировать' },
        { key: 'delete', label: 'Удалить', critical: true },
      ],
      archived: [
        { key: 'edit', label: 'Редактировать' },
        { key: 'delete', label: 'Удалить', critical: true },
      ],
    },
  },
  'inventory/stock': {
    title: 'Остатки',
    entityName: 'позиция',
    entityNamePlural: 'Остатки',
    columns: [
      { key: 'sku', label: 'SKU' },
      { key: 'available', label: 'Доступно' },
      { key: 'reserved', label: 'В резерве' },
      { key: 'min', label: 'Мин. остаток' },
      { key: 'warehouse', label: 'Склад' },
    ],
    statuses: [
      { key: 'normal', label: 'Норма', tone: 'success' },
      { key: 'low', label: 'Низкий остаток', tone: 'warning' },
      { key: 'critical', label: 'Критично', tone: 'danger' },
    ],
    actions: [
      { key: 'create', label: 'Добавить позицию' },
      { key: 'edit', label: 'Редактировать' },
    ],
    createFields: inventoryStockCreateFields,
  },
  'inventory/purchases': {
    title: 'Закупки',
    entityName: 'закупка',
    entityNamePlural: 'Закупки',
    columns: [
      { key: 'stockItemId', label: 'Товар' },
      { key: 'supplier', label: 'Поставщик' },
      { key: 'amount', label: 'Сумма' },
      { key: 'eta', label: 'Поставка' },
    ],
    statuses: [
      { key: 'requested', label: 'Запрошено', tone: 'info' },
      { key: 'approved', label: 'Согласовано', tone: 'warning' },
      { key: 'ordered', label: 'Заказано', tone: 'warning' },
      { key: 'in_transit', label: 'В пути', tone: 'warning' },
      { key: 'closed', label: 'Закрыто', tone: 'neutral', closed: true },
      { key: 'cancelled', label: 'Отменено', tone: 'danger', closed: true },
    ],
    actions: [
      { key: 'create', label: 'Создать закупку' },
      { key: 'edit', label: 'Редактировать' },
      { key: 'post', label: 'Следующий этап', critical: true },
      { key: 'cancel', label: 'Отменить', critical: true },
      { key: 'close', label: 'Принять и закрыть', critical: true },
    ],
    createFields: inventoryPurchaseCreateFields,
    statusActions: {
      requested: [
        { key: 'edit', label: 'Редактировать' },
        { key: 'post', label: 'Согласовать', nextStatus: 'approved' },
        { key: 'cancel', label: 'Отменить', nextStatus: 'cancelled', critical: true },
      ],
      approved: [
        { key: 'edit', label: 'Редактировать' },
        { key: 'post', label: 'Заказать', nextStatus: 'ordered' },
        { key: 'cancel', label: 'Отменить', nextStatus: 'cancelled', critical: true },
      ],
      ordered: [
        { key: 'edit', label: 'Редактировать' },
        { key: 'post', label: 'Отметить в пути', nextStatus: 'in_transit' },
        { key: 'cancel', label: 'Отменить', nextStatus: 'cancelled', critical: true },
      ],
      in_transit: [
        { key: 'edit', label: 'Редактировать' },
        { key: 'close', label: 'Принять и закрыть', nextStatus: 'closed', critical: true },
      ],
    },
  },
  'inventory/documents': {
    title: 'Накладные',
    entityName: 'накладная',
    entityNamePlural: 'Накладные',
    columns: [
      { key: 'number', label: 'Номер' },
      { key: 'supplier', label: 'Поставщик' },
      { key: 'owner', label: 'Ответственный' },
    ],
    statuses: [
      { key: 'draft', label: 'Черновик', tone: 'warning' },
      { key: 'expected', label: 'Ожидается поставка', tone: 'info' },
      { key: 'received', label: 'Принята', tone: 'success' },
      { key: 'archived', label: 'Архив', tone: 'neutral', closed: true },
      { key: 'cancelled', label: 'Отменена', tone: 'danger', closed: true },
    ],
    actions: [
      { key: 'create', label: 'Создать накладную' },
      { key: 'edit', label: 'Редактировать' },
    ],
    createFields: inventoryDocumentCreateFields,
  },
  'finance/invoices': {
    columns: [
      { key: 'counterparty', label: 'Контрагент' },
      { key: 'direction', label: 'Тип' },
      { key: 'amount', label: 'Сумма' },
      { key: 'paidAmount', label: 'Оплачено' },
      { key: 'dueDate', label: 'Срок' },
    ],
    statuses: [
      { key: 'issued', label: 'Выставлен', tone: 'info' },
      { key: 'paid', label: 'Оплачен', tone: 'success', closed: true },
      { key: 'cancelled', label: 'Отменен', tone: 'danger', closed: true },
    ],
    actions: [
      { key: 'create', label: 'Создать счет' },
      { key: 'edit', label: 'Редактировать' },
      { key: 'cancel', label: 'Отменить', critical: true },
    ],
    createFields: financeInvoiceCreateFields,
    statusActions: {
      issued: [
        { key: 'edit', label: 'Редактировать' },
        { key: 'cancel', label: 'Отменить', nextStatus: 'cancelled', critical: true },
      ],
    },
  },
  'finance/payments': {
    actions: [
      { key: 'create', label: 'Создать платеж' },
      { key: 'edit', label: 'Редактировать' },
      { key: 'post', label: 'Подтвердить', critical: true },
      { key: 'close', label: 'Сверить', critical: true },
      { key: 'cancel', label: 'Отменить', critical: true },
    ],
    createFields: financePaymentCreateFields,
    statusActions: {
      initiated: [
        { key: 'edit', label: 'Редактировать' },
        { key: 'post', label: 'Подтвердить', nextStatus: 'confirmed', critical: true },
        { key: 'cancel', label: 'Отменить', nextStatus: 'cancelled', critical: true },
      ],
      confirmed: [
        { key: 'edit', label: 'Редактировать' },
        { key: 'close', label: 'Сверить', nextStatus: 'reconciled', critical: true },
        { key: 'cancel', label: 'Отменить', nextStatus: 'cancelled', critical: true },
      ],
    },
  },
  'finance/reports': {
    columns: [
      { key: 'period', label: 'Период' },
      { key: 'format', label: 'Формат' },
      { key: 'openInvoiceTotal', label: 'Открыто' },
      { key: 'reconciledPaymentsTotal', label: 'Сверено' },
    ],
    statuses: [
      { key: 'draft', label: 'Черновик', tone: 'warning' },
      { key: 'generated', label: 'Сформирован', tone: 'info' },
      { key: 'archived', label: 'Архив', tone: 'neutral', closed: true },
    ],
    actions: [
      { key: 'create', label: 'Создать отчет' },
      { key: 'edit', label: 'Редактировать' },
      { key: 'post', label: 'Сформировать', critical: true },
      { key: 'archive', label: 'Архивировать', critical: true },
    ],
    createFields: financeReportCreateFields,
    statusActions: {
      draft: [
        { key: 'edit', label: 'Редактировать' },
        { key: 'post', label: 'Сформировать', nextStatus: 'generated', critical: true },
      ],
      generated: [
        { key: 'archive', label: 'Архивировать', nextStatus: 'archived', critical: true },
      ],
    },
  },
  'finance/documents': {
    columns: [
      { key: 'source', label: 'Источник' },
      { key: 'number', label: 'Номер' },
      { key: 'docType', label: 'Тип' },
      { key: 'counterparty', label: 'Контрагент' },
      { key: 'owner', label: 'Ответственный' },
    ],
    statuses: [
      { key: 'draft', label: 'Черновик', tone: 'warning' },
      { key: 'expected', label: 'Ожидается', tone: 'info' },
      { key: 'posted', label: 'Проведен', tone: 'success' },
      { key: 'received', label: 'Принят', tone: 'success' },
      { key: 'archived', label: 'Архив', tone: 'neutral', closed: true },
      { key: 'cancelled', label: 'Отменен', tone: 'danger', closed: true },
    ],
    actions: [
      { key: 'create', label: 'Создать документ' },
      { key: 'edit', label: 'Редактировать' },
      { key: 'post', label: 'Провести', critical: true },
      { key: 'archive', label: 'Архивировать', critical: true },
      { key: 'cancel', label: 'Отменить', critical: true },
    ],
    createFields: financeDocumentCreateFields,
    statusActions: {
      draft: [
        { key: 'edit', label: 'Редактировать' },
        { key: 'post', label: 'Провести', nextStatus: 'posted', critical: true },
        { key: 'cancel', label: 'Отменить', nextStatus: 'cancelled', critical: true },
      ],
      posted: [
        { key: 'archive', label: 'Архивировать', nextStatus: 'archived', critical: true },
      ],
    },
  },
}

function buildStatusActionsFromMap(
  tab: RawEntityTabDefinition,
): Partial<Record<string, EntityStatusActionDefinition[]>> {
  const actions = tab.actions.filter((action) => action.key !== 'create')
  return Object.fromEntries(
    tab.statuses.map((status) => [
      status.key,
      actions.map((action) => ({
        key: action.key,
        label: action.label,
        critical: action.critical,
        nextStatus: tab.actionStatusMap?.[action.key],
      })),
    ]),
  )
}

function finalizeTabDefinition(
  storeKey: string,
  tab: RawEntityTabDefinition,
): EntityTabDefinition {
  const override = tabOverrides[storeKey]
  const merged: RawEntityTabDefinition = {
    ...tab,
    ...(override ?? {}),
  }
  const allowDeleteAction = storeKey !== 'inventory/stock' && storeKey !== 'platform/roles'
  const actions = !allowDeleteAction || merged.actions.some((action) => action.key === 'delete')
    ? merged.actions
    : [...merged.actions, deleteAction]
  const statusActions = merged.statusActions ?? buildStatusActionsFromMap({ ...merged, actions })
  const { actionStatusMap: _actionStatusMap, ...finalTab } = merged

  return {
    ...finalTab,
    actions,
    statusActions,
  }
}

const rawSubsystems: RawSubsystemDefinition[] = [
  {
    slug: 'crm-sales',
    title: 'CRM и продажи',
    summary: 'Лиды, клиенты, сделки и документы продаж.',
    tabs: [
      {
        slug: 'clients',
        hideStatusUi: true,
        title: 'Клиенты',
        entityName: 'клиент',
        entityNamePlural: 'Клиенты',
        idPrefix: 'CL',
        view: 'table',
        columns: [
          { key: 'phone', label: 'Телефон' },
          { key: 'owner', label: 'Ответственный' },
          { key: 'segment', label: 'Сегмент' },
        ],
        statuses: [
          { key: 'active', label: 'Активен', tone: 'success' },
          { key: 'paused', label: 'На паузе', tone: 'warning' },
          { key: 'archived', label: 'В архиве', tone: 'neutral', closed: true },
        ],
        actions: [
          { key: 'create', label: 'Создать клиента' },
          { key: 'edit', label: 'Редактировать' },
          { key: 'archive', label: 'Архивировать', critical: true },
          { key: 'reopen', label: 'Возобновить' },
        ],
        createFields: [
          { key: 'title', label: 'Название', placeholder: 'ООО АВТОПАРК', required: true },
          { key: 'phone', label: 'Телефон', placeholder: '+7 (900) 000-00-00', required: true },
          { key: 'email', label: 'Email', placeholder: 'contact@company.ru' },
          { key: 'segment', label: 'Сегмент', placeholder: 'Корпоративный' },
          { key: 'owner', label: 'Ответственный', placeholder: 'Менеджер' },
        ],
      },
      {
        slug: 'leads',
        title: 'Лиды',
        entityName: 'лид',
        entityNamePlural: 'Лиды',
        idPrefix: 'LD',
        view: 'table',
        columns: [
          { key: 'channel', label: 'Канал' },
          { key: 'source', label: 'Источник' },
          { key: 'manager', label: 'Менеджер' },
        ],
        statuses: [
          { key: 'new', label: 'Новый', tone: 'info' },
          { key: 'qualified', label: 'Квалифицирован', tone: 'success' },
          { key: 'lost', label: 'Потерян', tone: 'danger', closed: true },
          { key: 'closed', label: 'Закрыт', tone: 'neutral', closed: true },
        ],
        actions: [
          { key: 'create', label: 'Создать лид' },
          { key: 'edit', label: 'Редактировать' },
          { key: 'assign', label: 'Назначить менеджера' },
          { key: 'close', label: 'Закрыть лид', critical: true },
          { key: 'reopen', label: 'Переоткрыть' },
        ],
        createFields: [
          { key: 'title', label: 'Название', placeholder: 'Лид: заявка с сайта', required: true },
          { key: 'phone', label: 'Телефон', placeholder: '+7 (900) 000-00-00' },
          { key: 'channel', label: 'Канал', placeholder: 'Сайт', required: true },
          { key: 'source', label: 'Источник', placeholder: 'Реклама' },
          { key: 'manager', label: 'Менеджер', placeholder: 'Иванов И.И.' },
        ],
        actionStatusMap: {
          assign: 'qualified',
          close: 'closed',
          reopen: 'new',
        },
      },
      {
        slug: 'deals',
        title: 'Сделки',
        entityName: 'сделка',
        entityNamePlural: 'Сделки',
        idPrefix: 'DL',
        view: 'kanban',
        columns: [
          { key: 'client', label: 'Клиент' },
          { key: 'vin', label: 'VIN' },
          { key: 'carPrice', label: 'Стоимость авто' },
          { key: 'amount', label: 'Сумма' },
        ],
        statuses: [
          { key: 'new', label: 'Сделка в работе', tone: 'info' },
          { key: 'closed', label: 'Сделка закрыта', tone: 'neutral', closed: true },
        ],
        actions: [
          { key: 'create', label: 'Создать сделку' },
          { key: 'edit', label: 'Редактировать' },
          { key: 'post', label: 'Провести сделку', critical: true },
          { key: 'close', label: 'Закрыть сделку', critical: true },
          { key: 'reopen', label: 'Переоткрыть' },
        ],
        createFields: [
          { key: 'title', label: 'Наименование', placeholder: 'Продажа Toyota Camry', required: true },
          { key: 'client', label: 'Клиент', placeholder: 'ООО АВТОПАРК', required: true },
          { key: 'vin', label: 'VIN', placeholder: 'XW7BF4FK30S123456', required: true },
          { key: 'amount', label: 'Сумма', placeholder: '2 350 000', required: true },
          { key: 'manager', label: 'Менеджер', placeholder: 'Иванов И.И.' },
        ],
        actionStatusMap: {
          post: 'new',
          close: 'closed',
          reopen: 'new',
        },
      },
      {
        slug: 'cars',
        title: 'Автомобили',
        entityName: 'автомобиль',
        entityNamePlural: 'Автомобили',
        idPrefix: 'CAR',
        view: 'table',
        columns: [
          { key: 'vin', label: 'VIN' },
          { key: 'brand', label: 'Марка' },
          { key: 'model', label: 'Модель' },
          { key: 'year', label: 'Год' },
          { key: 'price', label: 'Стоимость' },
          { key: 'plateNumber', label: 'Гос.номер' },
          { key: 'mileage', label: 'Пробег' },
          { key: 'ownerClient', label: 'Владелец' },
        ],
        statuses: [
          { key: 'active', label: 'Активен', tone: 'success' },
          { key: 'in_service', label: 'В сервисе', tone: 'warning' },
          { key: 'sold', label: 'Продан', tone: 'neutral', closed: true },
          { key: 'archived', label: 'В архиве', tone: 'danger', closed: true },
        ],
        actions: [
          { key: 'create', label: 'Создать авто' },
          { key: 'edit', label: 'Редактировать' },
          { key: 'archive', label: 'В архив', critical: true },
          { key: 'reopen', label: 'Восстановить' },
        ],
        createFields: [
          { key: 'vin', label: 'VIN', placeholder: 'XW7BF4FK30S123456', required: true },
          { key: 'brand', label: 'Марка', placeholder: 'Toyota', required: true },
          { key: 'model', label: 'Модель', placeholder: 'Camry', required: true },
          { key: 'year', label: 'Год', placeholder: '2020', required: true },
          { key: 'price', label: 'Стоимость', placeholder: '2 350 000' },
          { key: 'plateNumber', label: 'Гос.номер', placeholder: 'A123BC77' },
          { key: 'mileage', label: 'Пробег', placeholder: '78000' },
          { key: 'color', label: 'Цвет', placeholder: 'Черный' },
          { key: 'ownerClient', label: 'Владелец', placeholder: 'ООО Автопарк' },
          { key: 'note', label: 'Комментарий', placeholder: 'Дополнительные заметки' },
        ],
        actionStatusMap: {
          archive: 'archived',
          reopen: 'active',
        },
      },
      {
        slug: 'documents',
        title: 'Документы',
        entityName: 'документ',
        entityNamePlural: 'Документы',
        idPrefix: 'DOC',
        view: 'documents',
        columns: [
          { key: 'number', label: 'Номер' },
          { key: 'docType', label: 'Тип' },
          { key: 'owner', label: 'Ответственный' },
        ],
        statuses: [
          { key: 'draft', label: 'Черновик', tone: 'warning' },
          { key: 'posted', label: 'Проведен', tone: 'success', closed: true },
          { key: 'cancelled', label: 'Отменен', tone: 'danger', closed: true },
        ],
        actions: [
          { key: 'create', label: 'Сформировать документ' },
          { key: 'post', label: 'Провести', critical: true },
          { key: 'cancel', label: 'Отменить', critical: true },
          { key: 'reopen', label: 'Вернуть в черновик' },
        ],
        createFields: [
          { key: 'title', label: 'Название', placeholder: 'Счет на оплату', required: true },
          { key: 'number', label: 'Номер', placeholder: 'INV-100201', required: true },
          { key: 'docType', label: 'Тип', placeholder: 'Счет', required: true },
          { key: 'owner', label: 'Ответственный', placeholder: 'Бухгалтер' },
          { key: 'client', label: 'Контрагент', placeholder: 'ООО АВТОПАРК', required: true },
        ],
        actionStatusMap: {
          post: 'posted',
          cancel: 'cancelled',
          reopen: 'draft',
        },
      },
      {
        slug: 'events',
        title: 'События',
        entityName: 'событие',
        entityNamePlural: 'События',
        idPrefix: 'EV',
        view: 'timeline',
        columns: [
          { key: 'date', label: 'Дата' },
          { key: 'owner', label: 'Ответственный' },
          { key: 'channel', label: 'Канал' },
        ],
        statuses: [
          { key: 'planned', label: 'Запланировано', tone: 'info' },
          { key: 'done', label: 'Выполнено', tone: 'success', closed: true },
          { key: 'cancelled', label: 'Отменено', tone: 'danger', closed: true },
        ],
        actions: [
          { key: 'create', label: 'Создать событие' },
          { key: 'edit', label: 'Редактировать' },
          { key: 'close', label: 'Завершить', critical: true },
          { key: 'cancel', label: 'Отменить', critical: true },
          { key: 'reopen', label: 'Переоткрыть' },
        ],
        createFields: [
          { key: 'title', label: 'Название', placeholder: 'Звонок клиенту', required: true },
          { key: 'date', label: 'Дата', placeholder: '2026-03-01', required: true },
          { key: 'channel', label: 'Канал', placeholder: 'Телефон' },
          { key: 'owner', label: 'Ответственный', placeholder: 'Иванов И.И.' },
        ],
        actionStatusMap: {
          close: 'done',
          cancel: 'cancelled',
          reopen: 'planned',
        },
      },
    ],
  },
  {
    slug: 'service',
    title: 'Сервис и ремонт',
    summary: 'Запись, заказ-наряды, сервисные документы и контроль статусов.',
    tabs: [
      {
        slug: 'orders',
        title: 'Заказ-наряды',
        entityName: 'заказ-наряд',
        entityNamePlural: 'Заказ-наряды',
        idPrefix: 'WO',
        view: 'timeline',
        columns: [
          { key: 'vin', label: 'VIN' },
          { key: 'master', label: 'Мастер' },
          { key: 'eta', label: 'Срок' },
        ],
        statuses: [
          { key: 'opened', label: 'Открыт', tone: 'info' },
          { key: 'diagnostics', label: 'Диагностика', tone: 'warning' },
          { key: 'in_progress', label: 'В работе', tone: 'warning' },
          { key: 'waiting_parts', label: 'Ожидание запчастей', tone: 'danger' },
          { key: 'ready', label: 'Готов', tone: 'success' },
          { key: 'closed', label: 'Закрыт', tone: 'neutral', closed: true },
        ],
        actions: [
          { key: 'create', label: 'Создать заказ-наряд' },
          { key: 'edit', label: 'Редактировать' },
          { key: 'assign', label: 'В работу' },
          { key: 'writeoff', label: 'Списать материалы', critical: true },
          { key: 'close', label: 'Закрыть заказ-наряд', critical: true },
          { key: 'reopen', label: 'Переоткрыть' },
        ],
        createFields: [
          { key: 'title', label: 'Название', placeholder: 'ТО-90 + диагностика', required: true },
          { key: 'vin', label: 'VIN', placeholder: 'XW7BF4FK30S123456', required: true },
          { key: 'master', label: 'Мастер', placeholder: 'Петров П.П.', required: true },
          { key: 'eta', label: 'Срок', placeholder: '2026-03-02', required: true },
        ],
        actionStatusMap: {
          assign: 'in_progress',
          writeoff: 'ready',
          close: 'closed',
          reopen: 'opened',
        },
      },
      {
        slug: 'appointments',
        title: 'Записи',
        entityName: 'запись',
        entityNamePlural: 'Записи',
        idPrefix: 'AP',
        view: 'table',
        columns: [
          { key: 'date', label: 'Дата' },
          { key: 'client', label: 'Клиент' },
          { key: 'channel', label: 'Канал' },
        ],
        statuses: [
          { key: 'planned', label: 'Запланирована', tone: 'info' },
          { key: 'confirmed', label: 'Подтверждена', tone: 'success' },
          { key: 'cancelled', label: 'Отменена', tone: 'danger', closed: true },
          { key: 'closed', label: 'Закрыта', tone: 'neutral', closed: true },
        ],
        actions: [
          { key: 'create', label: 'Создать запись' },
          { key: 'edit', label: 'Редактировать' },
          { key: 'close', label: 'Закрыть запись', critical: true },
          { key: 'cancel', label: 'Отменить', critical: true },
          { key: 'reopen', label: 'Переоткрыть' },
        ],
        createFields: [
          { key: 'title', label: 'Название', placeholder: 'Запись на ТО', required: true },
          { key: 'date', label: 'Дата', placeholder: '2026-03-04', required: true },
          { key: 'client', label: 'Клиент', placeholder: 'Иван Петров', required: true },
          { key: 'channel', label: 'Канал', placeholder: 'Телефон' },
        ],
        actionStatusMap: {
          assign: 'confirmed',
          close: 'closed',
          cancel: 'cancelled',
          reopen: 'planned',
        },
      },
      {
        slug: 'documents',
        title: 'Документы',
        entityName: 'документ',
        entityNamePlural: 'Документы',
        idPrefix: 'SD',
        view: 'documents',
        columns: [
          { key: 'number', label: 'Номер' },
          { key: 'docType', label: 'Тип' },
          { key: 'wo', label: 'Заказ-наряд' },
        ],
        statuses: [
          { key: 'draft', label: 'Черновик', tone: 'warning' },
          { key: 'posted', label: 'Проведен', tone: 'success', closed: true },
          { key: 'cancelled', label: 'Отменен', tone: 'danger', closed: true },
        ],
        actions: [
          { key: 'create', label: 'Сформировать документ' },
          { key: 'post', label: 'Провести', critical: true },
          { key: 'cancel', label: 'Отменить', critical: true },
          { key: 'reopen', label: 'Вернуть в черновик' },
        ],
        createFields: [
          { key: 'title', label: 'Название', placeholder: 'Сервисный акт', required: true },
          { key: 'number', label: 'Номер', placeholder: 'SA-20017', required: true },
          { key: 'docType', label: 'Тип', placeholder: 'Акт', required: true },
          { key: 'wo', label: 'Заказ-наряд', placeholder: 'WO-10035', required: true },
        ],
        actionStatusMap: {
          post: 'posted',
          cancel: 'cancelled',
          reopen: 'draft',
        },
      },
      {
        slug: 'events',
        title: 'События',
        entityName: 'событие',
        entityNamePlural: 'События',
        idPrefix: 'SEV',
        view: 'timeline',
        columns: [
          { key: 'date', label: 'Дата' },
          { key: 'wo', label: 'Заказ-наряд' },
          { key: 'owner', label: 'Ответственный' },
        ],
        statuses: [
          { key: 'planned', label: 'Запланировано', tone: 'info' },
          { key: 'done', label: 'Выполнено', tone: 'success', closed: true },
          { key: 'cancelled', label: 'Отменено', tone: 'danger', closed: true },
        ],
        actions: [
          { key: 'create', label: 'Создать событие' },
          { key: 'close', label: 'Завершить', critical: true },
          { key: 'cancel', label: 'Отменить', critical: true },
          { key: 'reopen', label: 'Переоткрыть' },
        ],
        createFields: [
          { key: 'title', label: 'Название', placeholder: 'Контроль качества', required: true },
          { key: 'date', label: 'Дата', placeholder: '2026-03-05', required: true },
          { key: 'wo', label: 'Заказ-наряд', placeholder: 'WO-10035' },
          { key: 'owner', label: 'Ответственный', placeholder: 'Старший мастер' },
        ],
        actionStatusMap: {
          close: 'done',
          cancel: 'cancelled',
          reopen: 'planned',
        },
      },
    ],
  },
  {
    slug: 'inventory',
    title: 'Склад и закупки',
    summary: 'Остатки, закупки и накладные.',
    tabs: [
      {
        slug: 'stock',
        title: 'Остатки',
        entityName: 'позиция',
        entityNamePlural: 'Остатки',
        idPrefix: 'STK',
        view: 'table',
        columns: [
          { key: 'sku', label: 'SKU' },
          { key: 'available', label: 'Доступно' },
          { key: 'reserved', label: 'В резерве' },
          { key: 'min', label: 'Мин. остаток' },
          { key: 'warehouse', label: 'Склад' },
        ],
        statuses: [
          { key: 'normal', label: 'Норма', tone: 'success' },
          { key: 'low', label: 'Низкий остаток', tone: 'warning' },
          { key: 'critical', label: 'Критично', tone: 'danger' },
          { key: 'closed', label: 'Закрыто', tone: 'neutral', closed: true },
        ],
        actions: [
          { key: 'create', label: 'Добавить позицию' },
          { key: 'edit', label: 'Редактировать' },
          { key: 'writeoff', label: 'Списать', critical: true },
          { key: 'close', label: 'Закрыть', critical: true },
          { key: 'reopen', label: 'Возобновить' },
        ],
        createFields: [
          { key: 'title', label: 'Название', placeholder: 'Масляный фильтр', required: true },
          { key: 'sku', label: 'SKU', placeholder: 'PART-FILTER', required: true },
          { key: 'available', label: 'Количество', placeholder: '14', required: true },
          { key: 'reserved', label: 'В резерве', placeholder: '0' },
          { key: 'min', label: 'Мин. остаток', placeholder: '10', required: true },
          { key: 'warehouse', label: 'Склад', placeholder: 'Основной', required: true },
        ],
        actionStatusMap: {
          writeoff: 'critical',
          close: 'closed',
          reopen: 'normal',
        },
      },
      {
        slug: 'purchases',
        title: 'Закупки',
        entityName: 'закупка',
        entityNamePlural: 'Закупки',
        idPrefix: 'PO',
        view: 'kanban',
        columns: [
          { key: 'stockItemId', label: 'Товар' },
          { key: 'supplier', label: 'Поставщик' },
          { key: 'amount', label: 'Сумма' },
          { key: 'eta', label: 'Поставка' },
        ],
        statuses: [
          { key: 'requested', label: 'Запрошено', tone: 'info' },
          { key: 'approved', label: 'Согласовано', tone: 'warning' },
          { key: 'ordered', label: 'Заказано', tone: 'warning' },
          { key: 'received', label: 'Принято', tone: 'success' },
          { key: 'closed', label: 'Закрыто', tone: 'neutral', closed: true },
          { key: 'cancelled', label: 'Отменено', tone: 'danger', closed: true },
        ],
        actions: [
          { key: 'create', label: 'Создать закупку' },
          { key: 'edit', label: 'Редактировать' },
          { key: 'post', label: 'Провести', critical: true },
          { key: 'cancel', label: 'Отменить', critical: true },
          { key: 'close', label: 'Закрыть', critical: true },
          { key: 'reopen', label: 'Переоткрыть' },
        ],
        createFields: [
          { key: 'title', label: 'Название', placeholder: 'Заказ фильтров', required: true },
          { key: 'stockItemId', label: 'Товар', placeholder: 'STK-2101', required: true },
          { key: 'supplier', label: 'Поставщик', placeholder: 'ООО Партс', required: true },
          { key: 'amount', label: 'Сумма', placeholder: '340 000', required: true },
          { key: 'eta', label: 'Срок поставки', placeholder: '2026-03-10', required: true },
        ],
        actionStatusMap: {
          post: 'approved',
          close: 'closed',
          cancel: 'cancelled',
          reopen: 'requested',
        },
      },
      {
        slug: 'documents',
        title: 'Накладные',
        entityName: 'накладная',
        entityNamePlural: 'Накладные',
        idPrefix: 'ID',
        view: 'table',
        columns: [
          { key: 'number', label: 'Номер' },
          { key: 'supplier', label: 'Поставщик' },
          { key: 'owner', label: 'Ответственный' },
        ],
        statuses: [
          { key: 'active', label: 'Активна', tone: 'info' },
        ],
        actions: [
          { key: 'create', label: 'Создать накладную' },
          { key: 'edit', label: 'Редактировать' },
        ],
        createFields: [
          { key: 'title', label: 'Название', placeholder: 'Накладная поставки', required: true },
          { key: 'number', label: 'Номер', placeholder: 'WH-30005', required: true },
          { key: 'supplier', label: 'Поставщик', placeholder: 'ООО Партс', required: true },
          { key: 'owner', label: 'Ответственный', placeholder: 'Кладовщик' },
        ],
      },
    ],
  },
  {
    slug: 'finance',
    title: 'Финансы и отчетность',
    summary: 'Счета, платежи, документы и финансовая аналитика.',
    tabs: [
      {
        slug: 'invoices',
        title: 'Счета',
        entityName: 'счет',
        entityNamePlural: 'Счета',
        idPrefix: 'INV',
        view: 'table',
        columns: [
          { key: 'counterparty', label: 'Контрагент' },
          { key: 'amount', label: 'Сумма' },
          { key: 'dueDate', label: 'Срок' },
        ],
        statuses: [
          { key: 'draft', label: 'Черновик', tone: 'warning' },
          { key: 'issued', label: 'Выставлен', tone: 'info' },
          { key: 'partially_paid', label: 'Частично оплачен', tone: 'warning' },
          { key: 'paid', label: 'Оплачен', tone: 'success' },
          { key: 'closed', label: 'Закрыт', tone: 'neutral', closed: true },
          { key: 'cancelled', label: 'Отменен', tone: 'danger', closed: true },
        ],
        actions: [
          { key: 'create', label: 'Создать счет' },
          { key: 'edit', label: 'Редактировать' },
          { key: 'post', label: 'Провести', critical: true },
          { key: 'cancel', label: 'Отменить', critical: true },
          { key: 'close', label: 'Закрыть', critical: true },
          { key: 'reopen', label: 'Переоткрыть' },
        ],
        createFields: [
          { key: 'title', label: 'Название', placeholder: 'Счет на оплату WO-10035', required: true },
          { key: 'counterparty', label: 'Контрагент', placeholder: 'ООО АВТОПАРК', required: true },
          { key: 'amount', label: 'Сумма', placeholder: '185 000', required: true },
          { key: 'dueDate', label: 'Срок оплаты', placeholder: '2026-03-11', required: true },
        ],
        actionStatusMap: {
          post: 'issued',
          close: 'closed',
          cancel: 'cancelled',
          reopen: 'draft',
        },
      },
      {
        slug: 'payments',
        title: 'Платежи',
        entityName: 'платеж',
        entityNamePlural: 'Платежи',
        idPrefix: 'PAY',
        view: 'timeline',
        columns: [
          { key: 'invoice', label: 'Счет' },
          { key: 'amount', label: 'Сумма' },
          { key: 'method', label: 'Метод' },
        ],
        statuses: [
          { key: 'initiated', label: 'Инициирован', tone: 'info' },
          { key: 'confirmed', label: 'Подтвержден', tone: 'success' },
          { key: 'reconciled', label: 'Сверен', tone: 'success', closed: true },
          { key: 'cancelled', label: 'Отменен', tone: 'danger', closed: true },
        ],
        actions: [
          { key: 'create', label: 'Создать платеж' },
          { key: 'post', label: 'Провести', critical: true },
          { key: 'cancel', label: 'Отменить', critical: true },
          { key: 'reopen', label: 'Переоткрыть' },
        ],
        createFields: [
          { key: 'title', label: 'Название', placeholder: 'Оплата по INV-100103', required: true },
          { key: 'invoice', label: 'Счет', placeholder: 'INV-100103', required: true },
          { key: 'amount', label: 'Сумма', placeholder: '185 000', required: true },
          { key: 'method', label: 'Метод', placeholder: 'Банковский перевод', required: true },
        ],
        actionStatusMap: {
          post: 'confirmed',
          close: 'reconciled',
          cancel: 'cancelled',
          reopen: 'initiated',
        },
      },
      {
        slug: 'reports',
        title: 'Отчеты',
        entityName: 'отчет',
        entityNamePlural: 'Отчеты',
        idPrefix: 'RPT',
        view: 'table',
        columns: [
          { key: 'period', label: 'Период' },
          { key: 'format', label: 'Формат' },
          { key: 'owner', label: 'Ответственный' },
        ],
        statuses: [
          { key: 'draft', label: 'Черновик', tone: 'warning' },
          { key: 'generated', label: 'Сформирован', tone: 'info' },
          { key: 'sent', label: 'Отправлен', tone: 'success', closed: true },
          { key: 'archived', label: 'В архиве', tone: 'neutral', closed: true },
        ],
        actions: [
          { key: 'create', label: 'Создать отчет' },
          { key: 'edit', label: 'Редактировать' },
          { key: 'post', label: 'Сформировать', critical: true },
          { key: 'archive', label: 'Архивировать', critical: true },
          { key: 'reopen', label: 'Переоткрыть' },
        ],
        createFields: [
          { key: 'title', label: 'Название', placeholder: 'P&L Февраль', required: true },
          { key: 'type', label: 'Тип отчета', placeholder: 'AR/AP', required: true },
          { key: 'period', label: 'Период', placeholder: '02.2026', required: true },
          { key: 'format', label: 'Формат', placeholder: 'PDF', required: true },
          { key: 'owner', label: 'Ответственный', placeholder: 'Финансовый менеджер', required: true },
        ],
        actionStatusMap: {
          post: 'generated',
          archive: 'archived',
          reopen: 'draft',
        },
      },
      {
        slug: 'documents',
        title: 'Документы',
        entityName: 'документ',
        entityNamePlural: 'Документы',
        idPrefix: 'FD',
        view: 'documents',
        columns: [
          { key: 'number', label: 'Номер' },
          { key: 'docType', label: 'Тип' },
          { key: 'owner', label: 'Ответственный' },
        ],
        statuses: [
          { key: 'draft', label: 'Черновик', tone: 'warning' },
          { key: 'posted', label: 'Проведен', tone: 'success', closed: true },
          { key: 'cancelled', label: 'Отменен', tone: 'danger', closed: true },
        ],
        actions: [
          { key: 'create', label: 'Сформировать документ' },
          { key: 'post', label: 'Провести', critical: true },
          { key: 'cancel', label: 'Отменить', critical: true },
          { key: 'reopen', label: 'Вернуть в черновик' },
        ],
        createFields: [
          { key: 'title', label: 'Название', placeholder: 'Платежное поручение', required: true },
          { key: 'number', label: 'Номер', placeholder: 'PP-88017', required: true },
          { key: 'docType', label: 'Тип', placeholder: 'Платежное поручение', required: true },
          { key: 'owner', label: 'Ответственный', placeholder: 'Бухгалтер' },
        ],
        actionStatusMap: {
          post: 'posted',
          cancel: 'cancelled',
          reopen: 'draft',
        },
      },
    ],
  },
  {
    slug: 'platform',
    title: 'Платформенные сервисы',
    summary: 'Пользователи, роли, аудит и интеграции.',
    tabs: [
      {
        slug: 'users',
        title: 'Пользователи',
        entityName: 'пользователь',
        entityNamePlural: 'Пользователи',
        idPrefix: 'USR',
        view: 'table',
        columns: [
          { key: 'email', label: 'Email' },
          { key: 'businessRoleId', label: 'Бизнес-роль' },
          { key: 'department', label: 'Подразделение' },
          { key: 'phone', label: 'Телефон' },
        ],
        statuses: [
          { key: 'active', label: 'Активен', tone: 'success' },
          { key: 'disabled', label: 'Отключен', tone: 'danger', closed: true },
        ],
        actions: [
          { key: 'create', label: 'Создать пользователя' },
          { key: 'edit', label: 'Редактировать' },
          { key: 'archive', label: 'Отключить', critical: true },
          { key: 'reopen', label: 'Восстановить' },
        ],
        createFields: [
          { key: 'title', label: 'ФИО', placeholder: 'Иванов Иван Иванович', required: true },
          { key: 'email', label: 'Email', placeholder: 'user@kis.local', required: true },
          { key: 'businessRoleId', label: 'Бизнес-роль', placeholder: 'RLB-SALES', required: true },
          { key: 'phone', label: 'Телефон', placeholder: '+7 (900) 000-00-00' },
        ],
        actionStatusMap: {
          archive: 'disabled',
          reopen: 'active',
        },
      },
      {
        slug: 'roles',
        title: 'Роли и права',
        entityName: 'роль',
        entityNamePlural: 'Роли',
        idPrefix: 'RLB',
        view: 'table',
        columns: [
          { key: 'subsystems', label: 'Подсистемы' },
          { key: 'permissionProfile', label: 'Профиль доступа' },
          { key: 'owner', label: 'Владелец' },
          { key: 'users', label: 'Пользователи' },
        ],
        statuses: [
          { key: 'active', label: 'Активна', tone: 'success' },
          { key: 'archived', label: 'В архиве', tone: 'neutral', closed: true },
        ],
        actions: [],
        createFields: [],
        statusActions: {},
      },
      {
        slug: 'audits',
        title: 'Аудит',
        entityName: 'аудит',
        entityNamePlural: 'Аудит',
        idPrefix: 'AUD',
        view: 'timeline',
        columns: [
          { key: 'date', label: 'Дата' },
          { key: 'actor', label: 'Пользователь' },
          { key: 'resource', label: 'Ресурс' },
        ],
        statuses: [
          { key: 'recorded', label: 'Записано', tone: 'info' },
          { key: 'reviewed', label: 'Проверено', tone: 'success' },
          { key: 'closed', label: 'Закрыто', tone: 'neutral', closed: true },
        ],
        actions: [
          { key: 'close', label: 'Закрыть проверку', critical: true },
          { key: 'reopen', label: 'Переоткрыть' },
        ],
        createFields: [
          { key: 'title', label: 'Название', placeholder: 'Проверка доступа к счетам', required: true },
          { key: 'date', label: 'Дата', placeholder: '2026-03-12', required: true },
          { key: 'actor', label: 'Аудитор', placeholder: 'security.bot', required: true },
          { key: 'resource', label: 'Ресурс', placeholder: 'finance/invoices', required: true },
        ],
        actionStatusMap: {
          close: 'closed',
          reopen: 'recorded',
        },
      },
      {
        slug: 'integrations',
        title: 'Интеграции',
        entityName: 'интеграция',
        entityNamePlural: 'Интеграции',
        idPrefix: 'INT',
        view: 'kanban',
        columns: [
          { key: 'service', label: 'Сервис' },
          { key: 'owner', label: 'Ответственный' },
          { key: 'version', label: 'Версия' },
        ],
        statuses: [
          { key: 'planning', label: 'Планирование', tone: 'info' },
          { key: 'testing', label: 'Тестирование', tone: 'warning' },
          { key: 'live', label: 'Пром', tone: 'success' },
          { key: 'deprecated', label: 'Устаревшая', tone: 'danger' },
          { key: 'closed', label: 'Закрыта', tone: 'neutral', closed: true },
        ],
        actions: [
          { key: 'create', label: 'Создать интеграцию' },
          { key: 'edit', label: 'Редактировать' },
          { key: 'post', label: 'Выпустить', critical: true },
          { key: 'archive', label: 'Вывести из эксплуатации', critical: true },
          { key: 'close', label: 'Закрыть', critical: true },
          { key: 'reopen', label: 'Переоткрыть' },
        ],
        createFields: [
          { key: 'title', label: 'Название', placeholder: 'Telephony Connector', required: true },
          { key: 'service', label: 'Сервис', placeholder: 'platform-integrations', required: true },
          { key: 'owner', label: 'Ответственный', placeholder: 'Platform Team', required: true },
          { key: 'version', label: 'Версия', placeholder: 'v1.2.0', required: true },
        ],
        actionStatusMap: {
          post: 'live',
          archive: 'deprecated',
          close: 'closed',
          reopen: 'planning',
        },
      },
    ],
  },
]

const deleteAction: EntityActionDefinition = {
  key: 'delete',
  label: 'Удалить',
  critical: true,
}

export const subsystems: SubsystemDefinition[] = rawSubsystems.map((subsystem) => ({
  ...subsystem,
  tabs: subsystem.tabs.map((tab) =>
    finalizeTabDefinition(buildStoreKey(subsystem.slug, tab.slug), tab),
  ),
}))

export function getSubsystemBySlug(slug: string): SubsystemDefinition | undefined {
  return subsystems.find((item) => item.slug === slug)
}

export function getSubsystem(slug: SubsystemSlug): SubsystemDefinition {
  const found = getSubsystemBySlug(slug)
  if (!found) {
    throw new Error(`Unknown subsystem: ${slug}`)
  }
  return found
}

