import type { EntityHistoryRecord, EntityRecord } from './model'

function history(base: string, final: string): EntityHistoryRecord[] {
  return [
    { id: `${base}-1`, at: '2026-02-18 09:20', text: 'Объект создан' },
    { id: `${base}-2`, at: '2026-02-18 14:40', text: 'Добавлены основные данные' },
    { id: `${base}-3`, at: '2026-02-19 11:10', text: final },
  ]
}

function related(base: string): EntityRecord['related'] {
  return [
    { id: `${base}-r1`, label: 'Связанный документ', value: `DOC-${base.toUpperCase()}` },
    { id: `${base}-r2`, label: 'Ответственный', value: 'Системный пользователь' },
  ]
}

function row(
  id: string,
  title: string,
  subtitle: string,
  status: string,
  values: Record<string, string>,
): EntityRecord {
  return {
    id,
    title,
    subtitle,
    status,
    values,
    history: history(id.toLowerCase(), `Текущий статус: ${status}`),
    related: related(id.toLowerCase()),
  }
}

export const seedData: Record<string, EntityRecord[]> = {
  'crm-sales/clients': [
    row('CL-1001', 'ООО АВТОПАРК', 'Корпоративный клиент', 'active', {
      phone: '+7 (495) 701-22-10',
      owner: 'Иванов И.И.',
      segment: 'Корпоративный',
      email: 'fleet@autopark.ru',
    }),
    row('CL-1002', 'Иван Петров', 'Розничный клиент', 'paused', {
      phone: '+7 (926) 441-22-10',
      owner: 'Петрова А.А.',
      segment: 'Розница',
      email: 'petrov@mail.ru',
    }),
    row('CL-1003', 'АО ТехТранс', 'Лизинговый клиент', 'archived', {
      phone: '+7 (495) 553-09-88',
      owner: 'Иванов И.И.',
      segment: 'Лизинг',
      email: 'office@tehtrans.ru',
    }),
  ],
  'crm-sales/leads': [
    row('LD-2001', 'Заявка с сайта: Toyota Camry', 'Сайт / Форма обратной связи', 'new', {
      channel: 'Сайт',
      source: 'SEO',
      manager: 'Иванов И.И.',
      phone: '+7 (900) 120-11-11',
    }),
    row('LD-2002', 'Входящий звонок: сервис + trade-in', 'Телефония', 'qualified', {
      channel: 'Телефон',
      source: 'Контакт-центр',
      manager: 'Петрова А.А.',
      phone: '+7 (901) 555-17-33',
    }),
    row('LD-2003', 'Запрос из мессенджера', 'Telegram бот', 'lost', {
      channel: 'Мессенджер',
      source: 'Telegram',
      manager: 'Иванов И.И.',
      phone: '+7 (977) 300-11-42',
    }),
  ],
  'crm-sales/deals': [
    row('DL-3001', 'Сделка: Toyota Camry 2.5', 'Корпоративный контракт', 'new', {
      client: 'ООО АВТОПАРК',
      vin: 'XW7BF4FK30S123456',
      amount: '2 350 000',
      manager: 'Иванов И.И.',
    }),
    row('DL-3002', 'Сделка: Hyundai Tucson', 'Розница', 'proposal', {
      client: 'Иван Петров',
      vin: 'KMHJB81BPNU191245',
      amount: '2 780 000',
      manager: 'Петрова А.А.',
    }),
    row('DL-3003', 'Сделка: KIA Sorento', 'Сделка закрыта', 'closed', {
      client: 'АО ТехТранс',
      vin: 'XWEPM81BDM0001183',
      amount: '3 120 000',
      manager: 'Иванов И.И.',
    }),
  ],
  'crm-sales/documents': [
    row('DOC-4001', 'Счет INV-100201', 'Сделка DL-3001', 'draft', {
      number: 'INV-100201',
      docType: 'Счет',
      owner: 'Финансист',
      client: 'ООО АВТОПАРК',
    }),
    row('DOC-4002', 'Договор CTR-80012', 'Сделка DL-3002', 'posted', {
      number: 'CTR-80012',
      docType: 'Договор',
      owner: 'Юрист',
      client: 'Иван Петров',
    }),
    row('DOC-4003', 'Счет INV-100154', 'Сделка DL-3003', 'cancelled', {
      number: 'INV-100154',
      docType: 'Счет',
      owner: 'Финансист',
      client: 'АО ТехТранс',
    }),
  ],
  'crm-sales/events': [
    row('EV-5001', 'Звонок клиенту', 'Контроль статуса сделки DL-3001', 'planned', {
      date: '2026-03-01',
      owner: 'Иванов И.И.',
      channel: 'Телефон',
    }),
    row('EV-5002', 'Встреча в шоуруме', 'Демонстрация автомобиля', 'done', {
      date: '2026-02-20',
      owner: 'Петрова А.А.',
      channel: 'Офис',
    }),
    row('EV-5003', 'Повторный контакт', 'Уточнение КП', 'cancelled', {
      date: '2026-02-22',
      owner: 'Иванов И.И.',
      channel: 'Email',
    }),
  ],
  'crm-sales/cars': [
    row('CAR-1001', 'Toyota Camry 2020', 'Fleet sedan', 'active', {
      vin: 'XW7BF4FK30S123456',
      brand: 'Toyota',
      model: 'Camry',
      year: '2020',
      plateNumber: 'A123BC77',
      mileage: '78000',
      color: 'Black',
      ownerClient: 'OOO Avtopark',
      note: 'Main fleet vehicle',
    }),
    row('CAR-1002', 'Hyundai Tucson 2021', 'Service contract car', 'in_service', {
      vin: 'KMHJB81BPNU191245',
      brand: 'Hyundai',
      model: 'Tucson',
      year: '2021',
      plateNumber: 'B456CD77',
      mileage: '52000',
      color: 'White',
      ownerClient: 'Ivan Petrov',
      note: 'Scheduled maintenance',
    }),
    row('CAR-1003', 'KIA Sorento 2019', 'Archived contract unit', 'archived', {
      vin: 'XWEPM81BDM0001183',
      brand: 'KIA',
      model: 'Sorento',
      year: '2019',
      plateNumber: 'C789EF77',
      mileage: '114000',
      color: 'Gray',
      ownerClient: 'AO TekhTrans',
      note: 'Archived after disposal',
    }),
  ],
  'service/orders': [
    row('WO-10031', 'Заказ-наряд WO-10031', 'ТО + диагностика', 'opened', {
      vin: 'XW7BF4FK30S123456',
      master: 'Петров П.П.',
      eta: '2026-03-02',
      client: 'ООО АВТОПАРК',
    }),
    row('WO-10032', 'Заказ-наряд WO-10032', 'Ремонт ходовой части', 'waiting_parts', {
      vin: 'KMHJB81BPNU191245',
      master: 'Сидоров С.С.',
      eta: '2026-03-04',
      client: 'Иван Петров',
    }),
    row('WO-10033', 'Заказ-наряд WO-10033', 'Проверка после ремонта', 'closed', {
      vin: 'XWEPM81BDM0001183',
      master: 'Петров П.П.',
      eta: '2026-02-20',
      client: 'АО ТехТранс',
    }),
  ],
  'service/appointments': [
    row('AP-1101', 'Запись AP-1101', 'Регламентное ТО', 'planned', {
      date: '2026-03-04',
      client: 'Иван Петров',
      channel: 'Телефон',
      vin: 'KMHJB81BPNU191245',
    }),
    row('AP-1102', 'Запись AP-1102', 'Проверка кондиционера', 'confirmed', {
      date: '2026-03-01',
      client: 'ООО АВТОПАРК',
      channel: 'Сайт',
      vin: 'XW7BF4FK30S123456',
    }),
    row('AP-1103', 'Запись AP-1103', 'Экстренный ремонт', 'closed', {
      date: '2026-02-20',
      client: 'АО ТехТранс',
      channel: 'Контакт-центр',
      vin: 'XWEPM81BDM0001183',
    }),
  ],
  'service/documents': [
    row('SD-1201', 'Акт SA-20017', 'Заказ-наряд WO-10031', 'draft', {
      number: 'SA-20017',
      docType: 'Акт',
      wo: 'WO-10031',
      owner: 'Сервис-администратор',
    }),
    row('SD-1202', 'Сервисный счет SI-78122', 'Заказ-наряд WO-10032', 'posted', {
      number: 'SI-78122',
      docType: 'Счет',
      wo: 'WO-10032',
      owner: 'Сервис-администратор',
    }),
    row('SD-1203', 'Акт SA-20009', 'Заказ-наряд WO-10033', 'cancelled', {
      number: 'SA-20009',
      docType: 'Акт',
      wo: 'WO-10033',
      owner: 'Сервис-администратор',
    }),
  ],
  'service/events': [
    row('SEV-1301', 'Контроль качества WO-10031', 'Проверка перед выдачей', 'planned', {
      date: '2026-03-03',
      wo: 'WO-10031',
      owner: 'Старший мастер',
    }),
    row('SEV-1302', 'Оповещение клиента', 'Готовность автомобиля', 'done', {
      date: '2026-02-20',
      wo: 'WO-10033',
      owner: 'Оператор сервиса',
    }),
    row('SEV-1303', 'Повторная диагностика', 'Перенос по сроку поставки', 'cancelled', {
      date: '2026-02-21',
      wo: 'WO-10032',
      owner: 'Петров П.П.',
    }),
  ],
  'inventory/stock': [
    row('STK-2101', 'Масляный фильтр', 'Позиция склада', 'normal', {
      sku: 'PART-FILTER',
      available: '42',
      warehouse: 'Основной',
      min: '15',
    }),
    row('STK-2102', 'Моторное масло 5W30', 'Позиция склада', 'low', {
      sku: 'PART-OIL-5W30',
      available: '7',
      warehouse: 'Основной',
      min: '10',
    }),
    row('STK-2103', 'Тормозной диск передний', 'Позиция склада', 'critical', {
      sku: 'PART-DISK-F',
      available: '2',
      warehouse: 'Центральный',
      min: '8',
    }),
  ],
  'inventory/purchases': [
    row('PO-2201', 'Закупка фильтров', 'Поставщик: ООО Партс', 'requested', {
      supplier: 'ООО Партс',
      amount: '340 000',
      eta: '2026-03-10',
      buyer: 'Смирнов А.А.',
    }),
    row('PO-2202', 'Закупка масел', 'Поставщик: ТехСнаб', 'ordered', {
      supplier: 'ТехСнаб',
      amount: '280 000',
      eta: '2026-03-05',
      buyer: 'Смирнов А.А.',
    }),
    row('PO-2203', 'Закупка дисков', 'Поставщик: АвтоДеталь', 'closed', {
      supplier: 'АвтоДеталь',
      amount: '490 000',
      eta: '2026-02-20',
      buyer: 'Смирнов А.А.',
    }),
  ],
  'inventory/movements': [
    row('MV-2301', 'Приход по накладной', 'Накладная WH-30001', 'draft', {
      sku: 'PART-FILTER',
      quantity: '25',
      operation: 'Приход',
      warehouse: 'Основной',
    }),
    row('MV-2302', 'Списание в WO-10032', 'Склад: Центральный', 'posted', {
      sku: 'PART-DISK-F',
      quantity: '2',
      operation: 'Списание',
      warehouse: 'Центральный',
    }),
    row('MV-2303', 'Перемещение между складами', 'Документ перемещения', 'cancelled', {
      sku: 'PART-OIL-5W30',
      quantity: '8',
      operation: 'Перемещение',
      warehouse: 'Основной',
    }),
  ],
  'inventory/documents': [
    row('ID-2401', 'Накладная WH-30005', 'Приходный документ', 'draft', {
      number: 'WH-30005',
      docType: 'Накладная',
      owner: 'Кладовщик',
      supplier: 'ООО Партс',
    }),
    row('ID-2402', 'Акт списания WO-10032', 'Сервисный расход', 'posted', {
      number: 'WR-90122',
      docType: 'Акт списания',
      owner: 'Кладовщик',
      supplier: 'Внутренний',
    }),
    row('ID-2403', 'Накладная WH-30001', 'Ошибка в количестве', 'cancelled', {
      number: 'WH-30001',
      docType: 'Накладная',
      owner: 'Кладовщик',
      supplier: 'ТехСнаб',
    }),
  ],
  'finance/invoices': [
    row('INV-100103', 'Счет INV-100103', 'Заказ-наряд WO-10031', 'issued', {
      counterparty: 'ООО АВТОПАРК',
      amount: '185 000',
      dueDate: '2026-03-11',
      owner: 'Финансовый отдел',
    }),
    row('INV-100104', 'Счет INV-100104', 'Сделка DL-3002', 'partially_paid', {
      counterparty: 'Иван Петров',
      amount: '2 780 000',
      dueDate: '2026-03-07',
      owner: 'Финансовый отдел',
    }),
    row('INV-100105', 'Счет INV-100105', 'Сделка DL-3003', 'closed', {
      counterparty: 'АО ТехТранс',
      amount: '3 120 000',
      dueDate: '2026-02-20',
      owner: 'Финансовый отдел',
    }),
  ],
  'finance/payments': [
    row('PAY-3101', 'Платеж PAY-3101', 'Оплата INV-100103', 'initiated', {
      invoice: 'INV-100103',
      amount: '185 000',
      method: 'Банковский перевод',
      owner: 'Казначей',
    }),
    row('PAY-3102', 'Платеж PAY-3102', 'Оплата INV-100104', 'confirmed', {
      invoice: 'INV-100104',
      amount: '1 200 000',
      method: 'Банковский перевод',
      owner: 'Казначей',
    }),
    row('PAY-3103', 'Платеж PAY-3103', 'Оплата INV-100105', 'reconciled', {
      invoice: 'INV-100105',
      amount: '3 120 000',
      method: 'Банк-клиент',
      owner: 'Казначей',
    }),
  ],
  'finance/reports': [
    row('RPT-3201', 'P&L Февраль', 'Финансовый отчет', 'draft', {
      period: '02.2026',
      format: 'XLSX',
      owner: 'Финансовый менеджер',
      channel: 'Внутренний портал',
    }),
    row('RPT-3202', 'Cashflow Февраль', 'Отчет движения денег', 'generated', {
      period: '02.2026',
      format: 'PDF',
      owner: 'Финансовый менеджер',
      channel: 'Внутренний портал',
    }),
    row('RPT-3203', 'AR/AP Февраль', 'Отчет по задолженности', 'archived', {
      period: '01.2026',
      format: 'CSV',
      owner: 'Финансовый менеджер',
      channel: 'Email',
    }),
  ],
  'finance/documents': [
    row('FD-3301', 'Платежное поручение PP-88017', 'Оплата поставщику', 'draft', {
      number: 'PP-88017',
      docType: 'Платежное поручение',
      owner: 'Бухгалтер',
      counterparty: 'ООО Партс',
    }),
    row('FD-3302', 'Акт сверки AC-77201', 'Период 02.2026', 'posted', {
      number: 'AC-77201',
      docType: 'Акт сверки',
      owner: 'Бухгалтер',
      counterparty: 'АО ТехТранс',
    }),
    row('FD-3303', 'Платежное поручение PP-88006', 'Ошибка в реквизитах', 'cancelled', {
      number: 'PP-88006',
      docType: 'Платежное поручение',
      owner: 'Бухгалтер',
      counterparty: 'ТехСнаб',
    }),
  ],
  'platform/users': [
    row('USR-4001', 'Иванов И.И.', 'Руководитель продаж', 'active', {
      email: 'ivanov@kis.local',
      role: 'manager',
      department: 'Продажи',
      phone: '+7 (900) 101-00-01',
    }),
    row('USR-4002', 'Петрова А.А.', 'Сервис-менеджер', 'suspended', {
      email: 'petrova@kis.local',
      role: 'manager',
      department: 'Сервис',
      phone: '+7 (900) 101-00-02',
    }),
    row('USR-4003', 'Смирнов С.С.', 'Кладовщик', 'disabled', {
      email: 'smirnov@kis.local',
      role: 'viewer',
      department: 'Склад',
      phone: '+7 (900) 101-00-03',
    }),
  ],
  'platform/roles': [
    row('RLB-4101', 'sales_manager', 'Роль руководителя продаж', 'active', {
      scope: 'CRM',
      permissions: 'create,edit,archive,close',
      owner: 'Security Team',
      users: '14',
    }),
    row('RLB-4102', 'finance_accountant', 'Роль бухгалтера', 'review', {
      scope: 'Finance',
      permissions: 'create,post,cancel',
      owner: 'Security Team',
      users: '8',
    }),
    row('RLB-4103', 'legacy_operator', 'Старая роль интеграции', 'closed', {
      scope: 'Platform',
      permissions: 'read',
      owner: 'Security Team',
      users: '0',
    }),
  ],
  'platform/audits': [
    row('AUD-4201', 'Проверка доступа к счетам', 'Контроль RBAC', 'recorded', {
      date: '2026-02-20',
      actor: 'security.bot',
      resource: 'finance/invoices',
      result: 'warning',
    }),
    row('AUD-4202', 'Проверка критических действий', 'Операции списания', 'reviewed', {
      date: '2026-02-19',
      actor: 'security.bot',
      resource: 'inventory/stock',
      result: 'ok',
    }),
    row('AUD-4203', 'Проверка изменений ролей', 'Изменения прав', 'closed', {
      date: '2026-02-18',
      actor: 'security.bot',
      resource: 'platform/roles',
      result: 'ok',
    }),
  ],
  'platform/integrations': [
    row('INT-4301', 'Telephony Connector', 'Интеграция телефонии', 'planning', {
      service: 'platform-integrations',
      owner: 'Platform Team',
      version: 'v1.2.0',
      channel: 'CRM',
    }),
    row('INT-4302', 'Payment Gateway', 'Интеграция банковского шлюза', 'testing', {
      service: 'finance-payments',
      owner: 'Platform Team',
      version: 'v2.0.1',
      channel: 'Finance',
    }),
    row('INT-4303', 'BI Stream', 'Поток в аналитическую витрину', 'live', {
      service: 'analytics-marts',
      owner: 'Data Team',
      version: 'v3.4.0',
      channel: 'BI',
    }),
  ],
}

