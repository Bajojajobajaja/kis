import type { EntityHistoryRecord, EntityRecord } from './model'
import { buildPlatformRoleValues } from './platform'

function history(base: string, final: string): EntityHistoryRecord[] {
  return [
    { id: `${base}-1`, at: '2026-02-18 09:20', text: 'Объект создан' },
    { id: `${base}-2`, at: '2026-02-18 14:40', text: 'Добавлены основные данные' },
    { id: `${base}-3`, at: '2026-02-19 11:10', text: final },
  ]
}

function historyMarch(base: string, final: string): EntityHistoryRecord[] {
  return [
    { id: `${base}-1`, at: '2026-03-05 10:15', text: 'Объект создан' },
    { id: `${base}-2`, at: '2026-03-07 14:30', text: 'Добавлены основные данные' },
    { id: `${base}-3`, at: '2026-03-10 09:45', text: final },
  ]
}

function historyApril(base: string, final: string): EntityHistoryRecord[] {
  return [
    { id: `${base}-1`, at: '2026-04-02 09:30', text: 'Объект создан' },
    { id: `${base}-2`, at: '2026-04-05 15:20', text: 'Добавлены основные данные' },
    { id: `${base}-3`, at: '2026-04-08 11:00', text: final },
  ]
}

function related(base: string): EntityRecord['related'] {
  return [
    { id: `${base}-r1`, label: 'Связанный документ', value: `DOC-${base.toUpperCase()}` },
    { id: `${base}-r2`, label: 'Ответственный', value: 'Системный пользователь' },
  ]
}

function rel(
  id: string,
  label: string,
  value: string,
  storeKey: string,
  recordId: string,
): EntityRecord['related'][number] {
  return { id, label, value, storeKey, recordId }
}

function row(
  id: string,
  title: string,
  subtitle: string,
  status: string,
  values: Record<string, string>,
  options: {
    history?: EntityHistoryRecord[]
    related?: EntityRecord['related']
  } = {},
): EntityRecord {
  return {
    id,
    title,
    subtitle,
    status,
    values,
    history: options.history ?? history(id.toLowerCase(), `Текущий статус: ${status}`),
    related: options.related ?? related(id.toLowerCase()),
  }
}

function stockRef(id: string, title: string, sku: string): string {
  return `${id} / ${title} / ${sku}`
}

function purchaseRef(id: string, title: string): string {
  return `${id}: ${title}`
}

function documentRef(number: string): string {
  return `Накладная ${number}`
}

function invoiceRef(number: string): string {
  return `Входящий счет ${number}`
}

function salesContractRef(number: string): string {
  return `Договор ${number}`
}

function salesInvoiceRef(number: string): string {
  return `Счет ${number}`
}

function carRef(id: string, title: string): string {
  return `${id}: ${title}`
}

const stockCatalog = {
  'STK-2101': { title: 'Масляный фильтр', sku: 'PART-FILTER' },
  'STK-2102': { title: 'Моторное масло 5W30', sku: 'PART-OIL-5W30' },
  'STK-2103': { title: 'Тормозной диск передний', sku: 'PART-DISK-F' },
  'STK-2104': { title: 'Свеча зажигания иридиевая', sku: 'PART-SPARK-IR' },
  'STK-2105': { title: 'Салонный фильтр', sku: 'PART-CABIN-FILTER' },
  'STK-2106': { title: 'Тормозная жидкость DOT-4', sku: 'PART-BRAKE-DOT4' },
  'STK-2107': { title: 'Ремень генератора', sku: 'PART-BELT-ALT' },
  'STK-2108': { title: 'Колодки тормозные задние', sku: 'PART-PADS-R' },
  'STK-2109': { title: 'Амортизатор задний', sku: 'PART-SHOCK-R' },
  'STK-2110': { title: 'Фара левая', sku: 'PART-HEADLIGHT-L' },
  'STK-2111': { title: 'Щетка стеклоочистителя', sku: 'PART-WIPER' },
  'STK-2112': { title: 'Антифриз G12', sku: 'PART-COOLANT-G12' },
  'STK-2113': { title: 'Подшипник ступицы', sku: 'PART-BEARING-HUB' },
  'STK-2114': { title: 'Воздушный фильтр', sku: 'PART-AIR-FILTER' },
  'STK-2115': { title: 'Аккумулятор 60Ah', sku: 'PART-BATTERY-60' },
  'STK-2116': { title: 'Лампа H7', sku: 'PART-LAMP-H7' },
} as const

function purchaseRelated(
  purchaseId: string,
  stockId: keyof typeof stockCatalog,
  documentId: string,
  documentNumber: string,
  invoiceId: string,
  invoiceNumber: string,
): EntityRecord['related'] {
  const stock = stockCatalog[stockId]
  return [
    rel(`${purchaseId}-stock`, 'Товар', stockRef(stockId, stock.title, stock.sku), 'inventory/stock', stockId),
    rel(`${purchaseId}-doc`, 'Накладная', documentRef(documentNumber), 'inventory/documents', documentId),
    rel(`${purchaseId}-inv`, 'Счет поставщика', invoiceRef(invoiceNumber), 'finance/invoices', invoiceId),
  ]
}

function documentRelated(
  purchaseId: string,
  purchaseTitle: string,
  stockId: keyof typeof stockCatalog,
  invoiceId: string,
  invoiceNumber: string,
): EntityRecord['related'] {
  const stock = stockCatalog[stockId]
  return [
    rel(`${purchaseId}-purchase`, 'Закупка', purchaseRef(purchaseId, purchaseTitle), 'inventory/purchases', purchaseId),
    rel(`${purchaseId}-stock`, 'Товар', stockRef(stockId, stock.title, stock.sku), 'inventory/stock', stockId),
    rel(`${purchaseId}-inv`, 'Счет поставщика', invoiceRef(invoiceNumber), 'finance/invoices', invoiceId),
  ]
}

function invoiceRelated(
  purchaseId: string,
  purchaseTitle: string,
  stockId: keyof typeof stockCatalog,
  documentId: string,
  documentNumber: string,
): EntityRecord['related'] {
  const stock = stockCatalog[stockId]
  return [
    rel(`${purchaseId}-purchase`, 'Закупка', purchaseRef(purchaseId, purchaseTitle), 'inventory/purchases', purchaseId),
    rel(`${purchaseId}-stock`, 'Товар', stockRef(stockId, stock.title, stock.sku), 'inventory/stock', stockId),
    rel(`${purchaseId}-doc`, 'Накладная', documentRef(documentNumber), 'inventory/documents', documentId),
  ]
}

export const seedData: Record<string, EntityRecord[]> = {
  'crm-sales/clients': [
    row('CL-1001', 'ООО АВТОПАРК', 'Корпоративный клиент', 'active', {
      phone: '+7 (495) 701-22-10',
      owner: 'USR-4001',
      segment: 'Корпоративный',
      email: 'fleet@autopark.ru',
    }),
    row('CL-1002', 'Иван Петров', 'Розничный клиент', 'paused', {
      phone: '+7 (926) 441-22-10',
      owner: 'USR-4002',
      segment: 'Розница',
      email: 'petrov@mail.ru',
    }),
    row('CL-1003', 'АО ТехТранс', 'Лизинговый клиент', 'archived', {
      phone: '+7 (495) 553-09-88',
      owner: 'USR-4001',
      segment: 'Лизинг',
      email: 'office@tehtrans.ru',
    }),
    row('CL-1004', 'ООО ДрайвТорг', 'Корпоративный клиент', 'active', {
      phone: '+7 (495) 812-33-44',
      owner: 'USR-4001',
      segment: 'Корпоративный',
      email: 'info@drivetorg.ru',
    }, { history: historyMarch('cl-1004', 'Текущий статус: active') }),
    row('CL-1005', 'Алексей Сидоров', 'Розничный клиент', 'active', {
      phone: '+7 (903) 555-12-34',
      owner: 'USR-4002',
      segment: 'Розница',
      email: 'sidorov.a@mail.ru',
    }, { history: historyMarch('cl-1005', 'Текущий статус: active') }),
    row('CL-1006', 'ИП Козлов К.К.', 'Малый бизнес', 'active', {
      phone: '+7 (916) 777-88-99',
      owner: 'USR-4001',
      segment: 'Малый бизнес',
      email: 'kozlov.kk@yandex.ru',
    }, { history: historyApril('cl-1006', 'Текущий статус: active') }),
    row('CL-1007', 'АО МоторГрупп', 'Корпоративный клиент', 'active', {
      phone: '+7 (495) 600-70-80',
      owner: 'USR-4002',
      segment: 'Корпоративный',
      email: 'office@motorgrupp.ru',
    }, { history: historyApril('cl-1007', 'Текущий статус: active') }),
  ],
  'crm-sales/leads': [
    row('LD-2001', 'Заявка с сайта: Toyota Camry', 'Сайт / Форма обратной связи', 'new', {
      channel: 'Сайт',
      source: 'SEO',
      manager: 'USR-4001',
      phone: '+7 (900) 120-11-11',
    }),
    row('LD-2002', 'Входящий звонок: сервис + trade-in', 'Телефония', 'qualified', {
      channel: 'Телефон',
      source: 'Контакт-центр',
      manager: 'USR-4002',
      phone: '+7 (901) 555-17-33',
    }),
    row('LD-2003', 'Запрос из мессенджера', 'Telegram бот', 'lost', {
      channel: 'Мессенджер',
      source: 'Telegram',
      manager: 'USR-4001',
      phone: '+7 (977) 300-11-42',
    }),
  ],
  'crm-sales/deals': [
    row('DL-3001', 'Сделка: Toyota Camry 2.5', 'Корпоративный контракт', 'new', {
      client: 'ООО АВТОПАРК',
      vin: 'XW7BF4FK30S123456',
      amount: '2 350 000',
      manager: 'USR-4001',
      carRecordId: 'CAR-1001',
      carRecordTitle: 'Toyota Camry 2020',
      carRecordSubtitle: 'Седан для парка',
      carVin: 'XW7BF4FK30S123456',
    }, {
      related: [
        rel('DL-3001-car', 'Автомобиль', carRef('CAR-1001', 'Toyota Camry 2020'), 'crm-sales/cars', 'CAR-1001'),
        rel('DL-3001-doc', 'Договор', salesContractRef('CTR-80011'), 'crm-sales/documents', 'DOC-4001'),
        rel('DL-3001-inv', 'Счет', salesInvoiceRef('INV-100103'), 'finance/invoices', 'INV-100103'),
      ],
    }),
    row('DL-3002', 'Сделка: Hyundai Tucson', 'Розница', 'new', {
      client: 'Иван Петров',
      vin: 'KMHJB81BPNU191245',
      amount: '2 780 000',
      manager: 'USR-4002',
      carRecordId: 'CAR-1002',
      carRecordTitle: 'Hyundai Tucson 2021',
      carRecordSubtitle: 'Авто по сервисному контракту',
      carVin: 'KMHJB81BPNU191245',
    }, {
      related: [
        rel('DL-3002-car', 'Автомобиль', carRef('CAR-1002', 'Hyundai Tucson 2021'), 'crm-sales/cars', 'CAR-1002'),
        rel('DL-3002-doc', 'Договор', salesContractRef('CTR-80012'), 'crm-sales/documents', 'DOC-4002'),
        rel('DL-3002-inv', 'Счет', salesInvoiceRef('INV-100104'), 'finance/invoices', 'INV-100104'),
      ],
    }),
    row('DL-3003', 'Сделка: KIA Sorento', 'Сделка закрыта', 'closed', {
      client: 'АО ТехТранс',
      vin: 'XWEPM81BDM0001183',
      amount: '3 120 000',
      manager: 'USR-4001',
      carRecordId: 'CAR-1003',
      carRecordTitle: 'KIA Sorento 2019',
      carRecordSubtitle: 'Архивный автомобиль по контракту',
      carVin: 'XWEPM81BDM0001183',
    }, {
      related: [
        rel('DL-3003-car', 'Автомобиль', carRef('CAR-1003', 'KIA Sorento 2019'), 'crm-sales/cars', 'CAR-1003'),
        rel('DL-3003-doc', 'Договор', salesContractRef('CTR-80013'), 'crm-sales/documents', 'DOC-4003'),
        rel('DL-3003-inv', 'Счет', salesInvoiceRef('INV-100105'), 'finance/invoices', 'INV-100105'),
      ],
    }),
    row('DL-3004', 'Сделка: Mazda CX-5 2022', 'Корпоративный лизинг', 'closed', {
      client: 'ООО ДрайвТорг',
      vin: 'JMZKE6HY3N1234567',
      amount: '2 900 000',
      manager: 'USR-4001',
      carRecordId: 'CAR-1007',
      carRecordTitle: 'Mazda CX-5 2022',
      carRecordSubtitle: 'Кроссовер для лизинга',
      carVin: 'JMZKE6HY3N1234567',
    }, {
      history: historyMarch('dl-3004', 'Сделка закрыта'),
      related: [
        rel('DL-3004-car', 'Автомобиль', carRef('CAR-1007', 'Mazda CX-5 2022'), 'crm-sales/cars', 'CAR-1007'),
        rel('DL-3004-doc', 'Договор', salesContractRef('CTR-80014'), 'crm-sales/documents', 'DOC-4004'),
        rel('DL-3004-inv', 'Счет', salesInvoiceRef('INV-100114'), 'finance/invoices', 'INV-100114'),
      ],
    }),
    row('DL-3005', 'Сделка: Audi A4 2021', 'Розничная продажа', 'closed', {
      client: 'Алексей Сидоров',
      vin: 'WAUZZZ8V0NA123456',
      amount: '3 600 000',
      manager: 'USR-4002',
      carRecordId: 'CAR-1009',
      carRecordTitle: 'Audi A4 2021',
      carRecordSubtitle: 'Бизнес-седан',
      carVin: 'WAUZZZ8V0NA123456',
    }, {
      history: historyMarch('dl-3005', 'Сделка закрыта'),
      related: [
        rel('DL-3005-car', 'Автомобиль', carRef('CAR-1009', 'Audi A4 2021'), 'crm-sales/cars', 'CAR-1009'),
        rel('DL-3005-doc', 'Договор', salesContractRef('CTR-80015'), 'crm-sales/documents', 'DOC-4005'),
        rel('DL-3005-inv', 'Счет', salesInvoiceRef('INV-100115'), 'finance/invoices', 'INV-100115'),
      ],
    }),
    row('DL-3006', 'Сделка: Mercedes C-Class 2022', 'Малый бизнес', 'new', {
      client: 'ИП Козлов К.К.',
      vin: 'WDD2050881A234567',
      amount: '4 200 000',
      manager: 'USR-4001',
      carRecordId: 'CAR-1010',
      carRecordTitle: 'Mercedes C-Class 2022',
      carRecordSubtitle: 'Представительский седан',
      carVin: 'WDD2050881A234567',
    }, {
      history: historyMarch('dl-3006', 'Текущий статус: new'),
      related: [
        rel('DL-3006-car', 'Автомобиль', carRef('CAR-1010', 'Mercedes C-Class 2022'), 'crm-sales/cars', 'CAR-1010'),
        rel('DL-3006-doc', 'Договор', salesContractRef('CTR-80016'), 'crm-sales/documents', 'DOC-4006'),
        rel('DL-3006-inv', 'Счет', salesInvoiceRef('INV-100116'), 'finance/invoices', 'INV-100116'),
      ],
    }),
    row('DL-3007', 'Сделка: Lexus RX 2023', 'Корпоративный контракт', 'closed', {
      client: 'АО МоторГрупп',
      vin: 'JTJBAMCA1N2345678',
      amount: '5 100 000',
      manager: 'USR-4002',
      carRecordId: 'CAR-1012',
      carRecordTitle: 'Lexus RX 2023',
      carRecordSubtitle: 'Премиальный кроссовер',
      carVin: 'JTJBAMCA1N2345678',
    }, {
      history: historyApril('dl-3007', 'Сделка закрыта'),
      related: [
        rel('DL-3007-car', 'Автомобиль', carRef('CAR-1012', 'Lexus RX 2023'), 'crm-sales/cars', 'CAR-1012'),
        rel('DL-3007-doc', 'Договор', salesContractRef('CTR-80017'), 'crm-sales/documents', 'DOC-4007'),
        rel('DL-3007-inv', 'Счет', salesInvoiceRef('INV-100117'), 'finance/invoices', 'INV-100117'),
      ],
    }),
    row('DL-3008', 'Сделка: Volvo XC60 2022', 'Корпоративный лизинг', 'new', {
      client: 'ООО ДрайвТорг',
      vin: 'YV4A22RK7N1234567',
      amount: '4 800 000',
      manager: 'USR-4001',
      carRecordId: 'CAR-1015',
      carRecordTitle: 'Volvo XC60 2022',
      carRecordSubtitle: 'Премиальный кроссовер',
      carVin: 'YV4A22RK7N1234567',
    }, {
      history: historyApril('dl-3008', 'Текущий статус: new'),
      related: [
        rel('DL-3008-car', 'Автомобиль', carRef('CAR-1015', 'Volvo XC60 2022'), 'crm-sales/cars', 'CAR-1015'),
        rel('DL-3008-doc', 'Договор', salesContractRef('CTR-80018'), 'crm-sales/documents', 'DOC-4008'),
        rel('DL-3008-inv', 'Счет', salesInvoiceRef('INV-100118'), 'finance/invoices', 'INV-100118'),
      ],
    }),
    row('DL-3009', 'Сделка: Geely Atlas Pro 2023', 'Розничная продажа', 'closed', {
      client: 'Алексей Сидоров',
      vin: 'L6T78Y4E3NE123456',
      amount: '1 450 000',
      manager: 'USR-4002',
      carRecordId: 'CAR-1016',
      carRecordTitle: 'Geely Atlas Pro 2023',
      carRecordSubtitle: 'Городской кроссовер',
      carVin: 'L6T78Y4E3NE123456',
    }, {
      history: historyApril('dl-3009', 'Сделка закрыта'),
      related: [
        rel('DL-3009-car', 'Автомобиль', carRef('CAR-1016', 'Geely Atlas Pro 2023'), 'crm-sales/cars', 'CAR-1016'),
        rel('DL-3009-doc', 'Договор', salesContractRef('CTR-80019'), 'crm-sales/documents', 'DOC-4009'),
        rel('DL-3009-inv', 'Счет', salesInvoiceRef('INV-100119'), 'finance/invoices', 'INV-100119'),
      ],
    }),
  ],
  'crm-sales/documents': [
    row('DOC-4001', 'Договор CTR-80011', 'Сделка DL-3001', 'posted', {
      number: 'CTR-80011',
      docType: 'Договор',
      owner: 'Юрист',
      client: 'ООО АВТОПАРК',
    }, {
      related: [
        rel('DOC-4001-deal', 'Сделка', 'DL-3001: Сделка: Toyota Camry 2.5', 'crm-sales/deals', 'DL-3001'),
        rel('DOC-4001-inv', 'Счет', salesInvoiceRef('INV-100103'), 'finance/invoices', 'INV-100103'),
      ],
    }),
    row('DOC-4002', 'Договор CTR-80012', 'Сделка DL-3002', 'posted', {
      number: 'CTR-80012',
      docType: 'Договор',
      owner: 'Юрист',
      client: 'Иван Петров',
    }, {
      related: [
        rel('DOC-4002-deal', 'Сделка', 'DL-3002: Сделка: Hyundai Tucson', 'crm-sales/deals', 'DL-3002'),
        rel('DOC-4002-inv', 'Счет', salesInvoiceRef('INV-100104'), 'finance/invoices', 'INV-100104'),
      ],
    }),
    row('DOC-4003', 'Договор CTR-80013', 'Сделка DL-3003', 'archived', {
      number: 'CTR-80013',
      docType: 'Договор',
      owner: 'Юрист',
      client: 'АО ТехТранс',
    }, {
      related: [
        rel('DOC-4003-deal', 'Сделка', 'DL-3003: Сделка: KIA Sorento', 'crm-sales/deals', 'DL-3003'),
        rel('DOC-4003-inv', 'Счет', salesInvoiceRef('INV-100105'), 'finance/invoices', 'INV-100105'),
      ],
    }),
    row('DOC-4004', 'Договор CTR-80014', 'Сделка DL-3004', 'posted', {
      number: 'CTR-80014',
      docType: 'Договор',
      owner: 'Юрист',
      client: 'ООО ДрайвТорг',
    }, {
      history: historyMarch('doc-4004', 'Договор проведён'),
      related: [
        rel('DOC-4004-deal', 'Сделка', 'DL-3004: Сделка: Mazda CX-5 2022', 'crm-sales/deals', 'DL-3004'),
        rel('DOC-4004-inv', 'Счет', salesInvoiceRef('INV-100114'), 'finance/invoices', 'INV-100114'),
      ],
    }),
    row('DOC-4005', 'Договор CTR-80015', 'Сделка DL-3005', 'posted', {
      number: 'CTR-80015',
      docType: 'Договор',
      owner: 'Юрист',
      client: 'Алексей Сидоров',
    }, {
      history: historyMarch('doc-4005', 'Договор проведён'),
      related: [
        rel('DOC-4005-deal', 'Сделка', 'DL-3005: Сделка: Audi A4 2021', 'crm-sales/deals', 'DL-3005'),
        rel('DOC-4005-inv', 'Счет', salesInvoiceRef('INV-100115'), 'finance/invoices', 'INV-100115'),
      ],
    }),
    row('DOC-4006', 'Договор CTR-80016', 'Сделка DL-3006', 'draft', {
      number: 'CTR-80016',
      docType: 'Договор',
      owner: 'Юрист',
      client: 'ИП Козлов К.К.',
    }, {
      history: historyMarch('doc-4006', 'Черновик договора'),
      related: [
        rel('DOC-4006-deal', 'Сделка', 'DL-3006: Сделка: Mercedes C-Class 2022', 'crm-sales/deals', 'DL-3006'),
        rel('DOC-4006-inv', 'Счет', salesInvoiceRef('INV-100116'), 'finance/invoices', 'INV-100116'),
      ],
    }),
    row('DOC-4007', 'Договор CTR-80017', 'Сделка DL-3007', 'posted', {
      number: 'CTR-80017',
      docType: 'Договор',
      owner: 'Юрист',
      client: 'АО МоторГрупп',
    }, {
      history: historyApril('doc-4007', 'Договор проведён'),
      related: [
        rel('DOC-4007-deal', 'Сделка', 'DL-3007: Сделка: Lexus RX 2023', 'crm-sales/deals', 'DL-3007'),
        rel('DOC-4007-inv', 'Счет', salesInvoiceRef('INV-100117'), 'finance/invoices', 'INV-100117'),
      ],
    }),
    row('DOC-4008', 'Договор CTR-80018', 'Сделка DL-3008', 'draft', {
      number: 'CTR-80018',
      docType: 'Договор',
      owner: 'Юрист',
      client: 'ООО ДрайвТорг',
    }, {
      history: historyApril('doc-4008', 'Черновик договора'),
      related: [
        rel('DOC-4008-deal', 'Сделка', 'DL-3008: Сделка: Volvo XC60 2022', 'crm-sales/deals', 'DL-3008'),
        rel('DOC-4008-inv', 'Счет', salesInvoiceRef('INV-100118'), 'finance/invoices', 'INV-100118'),
      ],
    }),
    row('DOC-4009', 'Договор CTR-80019', 'Сделка DL-3009', 'posted', {
      number: 'CTR-80019',
      docType: 'Договор',
      owner: 'Юрист',
      client: 'Алексей Сидоров',
    }, {
      history: historyApril('doc-4009', 'Договор проведён'),
      related: [
        rel('DOC-4009-deal', 'Сделка', 'DL-3009: Сделка: Geely Atlas Pro 2023', 'crm-sales/deals', 'DL-3009'),
        rel('DOC-4009-inv', 'Счет', salesInvoiceRef('INV-100119'), 'finance/invoices', 'INV-100119'),
      ],
    }),
  ],
  'crm-sales/events': [
    row('EV-5001', 'Звонок клиенту', 'Контроль статуса сделки DL-3001', 'planned', {
      date: '2026-03-01',
      owner: 'USR-4001',
      channel: 'Телефон',
    }),
    row('EV-5002', 'Встреча в шоуруме', 'Демонстрация автомобиля', 'done', {
      date: '2026-02-20',
      owner: 'USR-4002',
      channel: 'Офис',
    }),
    row('EV-5003', 'Повторный контакт', 'Уточнение коммерческого предложения', 'cancelled', {
      date: '2026-02-22',
      owner: 'USR-4001',
      channel: 'Email',
    }),
  ],
  'crm-sales/cars': [
    row('CAR-1001', 'Toyota Camry 2020', 'Седан для парка', 'active', {
      vin: 'XW7BF4FK30S123456',
      brand: 'Toyota',
      model: 'Camry',
      year: '2020',
      price: '2 350 000',
      plateNumber: 'A123BC77',
      mileage: '78000',
      color: 'Черный',
      ownerClient: 'ООО АВТОПАРК',
      note: 'Основной автомобиль парка',
    }),
    row('CAR-1002', 'Hyundai Tucson 2021', 'Авто по сервисному контракту', 'in_service', {
      vin: 'KMHJB81BPNU191245',
      brand: 'Hyundai',
      model: 'Tucson',
      year: '2021',
      price: '2 780 000',
      plateNumber: 'B456CD77',
      mileage: '52000',
      color: 'Белый',
      ownerClient: 'Иван Петров',
      note: 'Плановое обслуживание',
    }),
    row('CAR-1003', 'KIA Sorento 2019', 'Архивный автомобиль по контракту', 'archived', {
      vin: 'XWEPM81BDM0001183',
      brand: 'KIA',
      model: 'Sorento',
      year: '2019',
      price: '3 120 000',
      plateNumber: 'C789EF77',
      mileage: '114000',
      color: 'Серый',
      ownerClient: 'АО ТехТранс',
      note: 'В архиве после списания',
    }),
    row('CAR-1004', 'Volkswagen Tiguan 2022', 'Демо-кроссовер', 'active', {
      vin: 'WVGZZZ5NZNP112233',
      brand: 'Volkswagen',
      model: 'Tiguan',
      year: '2022',
      price: '2 650 000',
      plateNumber: 'D321FG77',
      mileage: '15000',
      color: 'Синий',
      ownerClient: 'ООО АВТОПАРК',
      note: 'Демонстрационный автомобиль дилера',
    }),
    row('CAR-1005', 'BMW X5 2020', 'Премиальный внедорожник', 'active', {
      vin: 'WBAKS610X0X334455',
      brand: 'BMW',
      model: 'X5',
      year: '2020',
      price: '4 500 000',
      plateNumber: 'E456GH77',
      mileage: '42000',
      color: 'Черный',
      ownerClient: 'Иван Петров',
      note: 'Корпоративный лизинг',
    }),
    row('CAR-1006', 'Skoda Octavia 2018', 'Седан для парка', 'in_service', {
      vin: 'TMBJK7NE6J0123456',
      brand: 'Skoda',
      model: 'Octavia',
      year: '2018',
      price: '1 150 000',
      plateNumber: 'F789JK77',
      mileage: '98000',
      color: 'Белый',
      ownerClient: 'АО ТехТранс',
      note: 'Большой пробег, обслуживание продолжается',
    }),
    row('CAR-1007', 'Mazda CX-5 2022', 'Кроссовер для лизинга', 'sold', {
      vin: 'JMZKE6HY3N1234567', brand: 'Mazda', model: 'CX-5', year: '2022',
      price: '2 900 000', plateNumber: 'G123HJ77', mileage: '28000', color: 'Красный',
      ownerClient: 'ООО ДрайвТорг', note: 'Продан в марте',
    }, { history: historyMarch('car-1007', 'Текущий статус: sold') }),
    row('CAR-1008', 'Nissan Qashqai 2023', 'Городской кроссовер', 'in_service', {
      vin: 'SJNFAAJ11U2345678', brand: 'Nissan', model: 'Qashqai', year: '2023',
      price: '2 400 000', plateNumber: 'H456JK77', mileage: '12000', color: 'Серебристый',
      ownerClient: 'Алексей Сидоров', note: 'На сервисном обслуживании',
    }, { history: historyMarch('car-1008', 'Текущий статус: in_service') }),
    row('CAR-1009', 'Audi A4 2021', 'Бизнес-седан', 'sold', {
      vin: 'WAUZZZ8V0NA123456', brand: 'Audi', model: 'A4', year: '2021',
      price: '3 600 000', plateNumber: 'J789KL77', mileage: '35000', color: 'Чёрный',
      ownerClient: 'Алексей Сидоров', note: 'Продан в марте',
    }, { history: historyMarch('car-1009', 'Текущий статус: sold') }),
    row('CAR-1010', 'Mercedes C-Class 2022', 'Представительский седан', 'active', {
      vin: 'WDD2050881A234567', brand: 'Mercedes-Benz', model: 'C-Class', year: '2022',
      price: '4 200 000', plateNumber: 'K012MN77', mileage: '18000', color: 'Белый',
      ownerClient: 'ИП Козлов К.К.', note: 'В процессе сделки',
    }, { history: historyMarch('car-1010', 'Текущий статус: active') }),
    row('CAR-1011', 'Renault Duster 2021', 'Бюджетный внедорожник', 'in_service', {
      vin: 'VF1HSJD0H54123456', brand: 'Renault', model: 'Duster', year: '2021',
      price: '1 350 000', plateNumber: 'L345OP77', mileage: '67000', color: 'Зелёный',
      ownerClient: 'ООО ДрайвТорг', note: 'На ТО в апреле',
    }, { history: historyApril('car-1011', 'Текущий статус: in_service') }),
    row('CAR-1012', 'Lexus RX 2023', 'Премиальный кроссовер', 'sold', {
      vin: 'JTJBAMCA1N2345678', brand: 'Lexus', model: 'RX', year: '2023',
      price: '5 100 000', plateNumber: 'M678QR77', mileage: '8000', color: 'Тёмно-синий',
      ownerClient: 'АО МоторГрупп', note: 'Продан в апреле',
    }, { history: historyApril('car-1012', 'Текущий статус: sold') }),
    row('CAR-1013', 'Ford Kuga 2022', 'Компактный кроссовер', 'in_service', {
      vin: 'WF0XXXGCDXNY12345', brand: 'Ford', model: 'Kuga', year: '2022',
      price: '2 200 000', plateNumber: 'N901ST77', mileage: '41000', color: 'Оранжевый',
      ownerClient: 'ИП Козлов К.К.', note: 'Ремонт подвески',
    }, { history: historyMarch('car-1013', 'Текущий статус: in_service') }),
    row('CAR-1014', 'Mitsubishi Outlander 2021', 'Семейный внедорожник', 'in_service', {
      vin: 'JMBXTGG3WNZ123456', brand: 'Mitsubishi', model: 'Outlander', year: '2021',
      price: '2 800 000', plateNumber: 'P234UV77', mileage: '55000', color: 'Серый',
      ownerClient: 'АО МоторГрупп', note: 'Диагностика в апреле',
    }, { history: historyApril('car-1014', 'Текущий статус: in_service') }),
    row('CAR-1015', 'Volvo XC60 2022', 'Премиальный кроссовер', 'active', {
      vin: 'YV4A22RK7N1234567', brand: 'Volvo', model: 'XC60', year: '2022',
      price: '4 800 000', plateNumber: 'R567WX77', mileage: '22000', color: 'Бежевый',
      ownerClient: 'ООО ДрайвТорг', note: 'В процессе сделки',
    }, { history: historyApril('car-1015', 'Текущий статус: active') }),
    row('CAR-1016', 'Geely Atlas Pro 2023', 'Городской кроссовер', 'sold', {
      vin: 'L6T78Y4E3NE123456', brand: 'Geely', model: 'Atlas Pro', year: '2023',
      price: '1 450 000', plateNumber: 'S890YZ77', mileage: '5000', color: 'Белый',
      ownerClient: 'Алексей Сидоров', note: 'Продан в апреле',
    }, { history: historyApril('car-1016', 'Текущий статус: sold') }),
  ],
  'service/orders': [
    row('WO-10031', 'Заказ-наряд WO-10031', 'ТО + диагностика', 'opened', {
      vin: 'XW7BF4FK30S123456',
      master: 'USR-4004',
      eta: '2026-03-02',
      client: 'ООО АВТОПАРК',
    }),
    row('WO-10032', 'Заказ-наряд WO-10032', 'Ремонт ходовой части', 'waiting_parts', {
      vin: 'KMHJB81BPNU191245',
      master: 'USR-4005',
      eta: '2026-03-04',
      client: 'Иван Петров',
    }),
    row('WO-10033', 'Заказ-наряд WO-10033', 'Проверка после ремонта', 'closed', {
      vin: 'XWEPM81BDM0001183',
      master: 'USR-4004',
      eta: '2026-02-20',
      client: 'АО ТехТранс',
    }),
    row('WO-10034', 'Заказ-наряд WO-10034', 'ТО + замена масла', 'opened', {
      vin: 'SJNFAAJ11U2345678',
      master: 'USR-4004',
      eta: '2026-03-18',
      client: 'Алексей Сидоров',
    }, { history: historyMarch('wo-10034', 'Текущий статус: opened') }),
    row('WO-10035', 'Заказ-наряд WO-10035', 'Ремонт подвески', 'closed', {
      vin: 'WF0XXXGCDXNY12345',
      master: 'USR-4005',
      eta: '2026-03-22',
      client: 'ИП Козлов К.К.',
    }, { history: historyMarch('wo-10035', 'Заказ-наряд закрыт') }),
    row('WO-10036', 'Заказ-наряд WO-10036', 'Диагностика двигателя', 'in_progress', {
      vin: 'JMBXTGG3WNZ123456',
      master: 'USR-4004',
      eta: '2026-04-12',
      client: 'АО МоторГрупп',
    }, { history: historyApril('wo-10036', 'Текущий статус: in_progress') }),
    row('WO-10037', 'Заказ-наряд WO-10037', 'ТО-60 + фильтры', 'opened', {
      vin: 'VF1HSJD0H54123456',
      master: 'USR-4005',
      eta: '2026-04-18',
      client: 'ООО ДрайвТорг',
    }, { history: historyApril('wo-10037', 'Текущий статус: opened') }),
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
    row('AP-1104', 'Запись AP-1104', 'Замена масла Nissan Qashqai', 'confirmed', {
      date: '2026-03-18',
      client: 'Алексей Сидоров',
      channel: 'Сайт',
      vin: 'SJNFAAJ11U2345678',
    }, { history: historyMarch('ap-1104', 'Запись подтверждена') }),
    row('AP-1105', 'Запись AP-1105', 'Ремонт подвески Ford Kuga', 'closed', {
      date: '2026-03-22',
      client: 'ИП Козлов К.К.',
      channel: 'Телефон',
      vin: 'WF0XXXGCDXNY12345',
    }, { history: historyMarch('ap-1105', 'Запись закрыта') }),
    row('AP-1106', 'Запись AP-1106', 'Диагностика Outlander', 'planned', {
      date: '2026-04-12',
      client: 'АО МоторГрупп',
      channel: 'Контакт-центр',
      vin: 'JMBXTGG3WNZ123456',
    }, { history: historyApril('ap-1106', 'Запись запланирована') }),
    row('AP-1107', 'Запись AP-1107', 'ТО-60 Renault Duster', 'confirmed', {
      date: '2026-04-18',
      client: 'ООО ДрайвТорг',
      channel: 'Сайт',
      vin: 'VF1HSJD0H54123456',
    }, { history: historyApril('ap-1107', 'Запись подтверждена') }),
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
    row('SD-1204', 'Акт SA-20020', 'Заказ-наряд WO-10034', 'draft', {
      number: 'SA-20020',
      docType: 'Акт',
      wo: 'WO-10034',
      owner: 'Сервис-администратор',
    }, { history: historyMarch('sd-1204', 'Черновик акта') }),
    row('SD-1205', 'Сервисный счет SI-78130', 'Заказ-наряд WO-10035', 'posted', {
      number: 'SI-78130',
      docType: 'Счет',
      wo: 'WO-10035',
      owner: 'Сервис-администратор',
    }, { history: historyMarch('sd-1205', 'Счет проведён') }),
    row('SD-1206', 'Акт SA-20021', 'Заказ-наряд WO-10036', 'draft', {
      number: 'SA-20021',
      docType: 'Акт',
      wo: 'WO-10036',
      owner: 'Сервис-администратор',
    }, { history: historyApril('sd-1206', 'Черновик акта') }),
    row('SD-1207', 'Акт SA-20022', 'Заказ-наряд WO-10037', 'draft', {
      number: 'SA-20022',
      docType: 'Акт',
      wo: 'WO-10037',
      owner: 'Сервис-администратор',
    }, { history: historyApril('sd-1207', 'Черновик акта') }),
  ],
  'service/events': [
    row('SEV-1301', 'Контроль качества WO-10031', 'Проверка перед выдачей', 'planned', {
      date: '2026-03-03',
      wo: 'WO-10031',
      owner: 'USR-4006',
    }),
    row('SEV-1302', 'Оповещение клиента', 'Готовность автомобиля', 'done', {
      date: '2026-02-20',
      wo: 'WO-10033',
      owner: 'USR-4006',
    }),
    row('SEV-1303', 'Повторная диагностика', 'Перенос по сроку поставки', 'cancelled', {
      date: '2026-02-21',
      wo: 'WO-10032',
      owner: 'USR-4004',
    }),
  ],
  'inventory/stock': [
    row('STK-2101', 'Масляный фильтр', 'Основной склад', 'normal', {
      sku: 'PART-FILTER',
      available: '58',
      reserved: '6',
      warehouse: 'Основной',
      min: '20',
    }, { related: [] }),
    row('STK-2102', 'Моторное масло 5W30', 'Основной склад', 'normal', {
      sku: 'PART-OIL-5W30',
      available: '23',
      reserved: '5',
      warehouse: 'Основной',
      min: '16',
    }, { related: [] }),
    row('STK-2103', 'Тормозной диск передний', 'Центральный склад', 'critical', {
      sku: 'PART-DISK-F',
      available: '4',
      reserved: '1',
      warehouse: 'Центральный',
      min: '10',
    }, { related: [] }),
    row('STK-2104', 'Свеча зажигания иридиевая', 'Основной склад', 'normal', {
      sku: 'PART-SPARK-IR',
      available: '34',
      reserved: '8',
      warehouse: 'Основной',
      min: '16',
    }, { related: [] }),
    row('STK-2105', 'Салонный фильтр', 'Резервный склад', 'critical', {
      sku: 'PART-CABIN-FILTER',
      available: '8',
      reserved: '2',
      warehouse: 'Резервный',
      min: '9',
    }, { related: [] }),
    row('STK-2106', 'Тормозная жидкость DOT-4', 'Центральный склад', 'normal', {
      sku: 'PART-BRAKE-DOT4',
      available: '14',
      reserved: '2',
      warehouse: 'Центральный',
      min: '8',
    }, { related: [] }),
    row('STK-2107', 'Ремень генератора', 'Основной склад', 'normal', {
      sku: 'PART-BELT-ALT',
      available: '19',
      reserved: '3',
      warehouse: 'Основной',
      min: '8',
    }, { related: [] }),
    row('STK-2108', 'Колодки тормозные задние', 'Центральный склад', 'low', {
      sku: 'PART-PADS-R',
      available: '10',
      reserved: '2',
      warehouse: 'Центральный',
      min: '10',
    }, { related: [] }),
    row('STK-2109', 'Амортизатор задний', 'Основной склад', 'low', {
      sku: 'PART-SHOCK-R',
      available: '7',
      reserved: '1',
      warehouse: 'Основной',
      min: '6',
    }, { related: [] }),
    row('STK-2110', 'Фара левая', 'Основной склад', 'critical', {
      sku: 'PART-HEADLIGHT-L',
      available: '3',
      reserved: '0',
      warehouse: 'Основной',
      min: '4',
    }, { related: [] }),
    row('STK-2111', 'Щетка стеклоочистителя', 'Основной склад', 'normal', {
      sku: 'PART-WIPER',
      available: '25',
      reserved: '4',
      warehouse: 'Основной',
      min: '10',
    }, { related: [] }),
    row('STK-2112', 'Антифриз G12', 'Резервный склад', 'low', {
      sku: 'PART-COOLANT-G12',
      available: '9',
      reserved: '2',
      warehouse: 'Резервный',
      min: '8',
    }, { related: [] }),
    row('STK-2113', 'Подшипник ступицы', 'Центральный склад', 'critical', {
      sku: 'PART-BEARING-HUB',
      available: '2',
      reserved: '0',
      warehouse: 'Центральный',
      min: '5',
    }, { related: [] }),
    row('STK-2114', 'Воздушный фильтр', 'Основной склад', 'normal', {
      sku: 'PART-AIR-FILTER',
      available: '17',
      reserved: '3',
      warehouse: 'Основной',
      min: '12',
    }, { related: [] }),
    row('STK-2115', 'Аккумулятор 60Ah', 'Основной склад', 'low', {
      sku: 'PART-BATTERY-60',
      available: '5',
      reserved: '1',
      warehouse: 'Основной',
      min: '4',
    }, { related: [] }),
    row('STK-2116', 'Лампа H7', 'Основной склад', 'normal', {
      sku: 'PART-LAMP-H7',
      available: '30',
      reserved: '5',
      warehouse: 'Основной',
      min: '12',
    }, { related: [] }),
  ],
  'inventory/purchases': [
    row('PO-2208', 'Закупка амортизаторов', 'Поставщик: Подвеска-Сервис • STK-2109', 'ordered', {
      stockItemId: 'STK-2109',
      supplier: 'Подвеска-Сервис',
      quantity: '16',
      unitPrice: '11 200',
      amount: '179 200',
      eta: '2026-03-13',
      buyer: 'Смирнов А.А.',
    }, {
      related: purchaseRelated('PO-2208', 'STK-2109', 'ID-2408', 'WH-30018', 'INV-100113', 'INV-100113'),
    }),
    row('PO-2207', 'Закупка моторного масла', 'Поставщик: ТехСнаб • STK-2102', 'closed', {
      stockItemId: 'STK-2102',
      supplier: 'ТехСнаб',
      quantity: '50',
      unitPrice: '3 400',
      amount: '170 000',
      eta: '2026-03-05',
      buyer: 'Смирнов А.А.',
    }, {
      related: purchaseRelated('PO-2207', 'STK-2102', 'ID-2407', 'WH-30017', 'INV-100112', 'INV-100112'),
    }),
    row('PO-2206', 'Закупка аккумуляторов', 'Поставщик: ЭнергоСтарт • STK-2115', 'cancelled', {
      stockItemId: 'STK-2115',
      supplier: 'ЭнергоСтарт',
      quantity: '10',
      unitPrice: '7 600',
      amount: '76 000',
      eta: '2026-03-08',
      buyer: 'Смирнов А.А.',
    }, {
      related: purchaseRelated('PO-2206', 'STK-2115', 'ID-2406', 'WH-30016', 'INV-100111', 'INV-100111'),
    }),
    row('PO-2205', 'Закупка тормозной жидкости', 'Поставщик: ХимРесурс • STK-2106', 'closed', {
      stockItemId: 'STK-2106',
      supplier: 'ХимРесурс',
      quantity: '30',
      unitPrice: '950',
      amount: '28 500',
      eta: '2026-03-06',
      buyer: 'Смирнов А.А.',
    }, {
      related: purchaseRelated('PO-2205', 'STK-2106', 'ID-2405', 'WH-30015', 'INV-100110', 'INV-100110'),
    }),
    row('PO-2204', 'Закупка подшипников ступицы', 'Поставщик: ПодшипникСнаб • STK-2113', 'in_transit', {
      stockItemId: 'STK-2113',
      supplier: 'ПодшипникСнаб',
      quantity: '18',
      unitPrice: '7 400',
      amount: '133 200',
      eta: '2026-03-14',
      buyer: 'Смирнов А.А.',
    }, {
      related: purchaseRelated('PO-2204', 'STK-2113', 'ID-2404', 'WH-30014', 'INV-100109', 'INV-100109'),
    }),
    row('PO-2203', 'Закупка фар', 'Поставщик: СветАвто • STK-2110', 'ordered', {
      stockItemId: 'STK-2110',
      supplier: 'СветАвто',
      quantity: '12',
      unitPrice: '27 600',
      amount: '331 200',
      eta: '2026-03-15',
      buyer: 'Смирнов А.А.',
    }, {
      related: purchaseRelated('PO-2203', 'STK-2110', 'ID-2403', 'WH-30013', 'INV-100108', 'INV-100108'),
    }),
    row('PO-2202', 'Закупка салонных фильтров', 'Поставщик: ФильтрТорг • STK-2105', 'approved', {
      stockItemId: 'STK-2105',
      supplier: 'ФильтрТорг',
      quantity: '40',
      unitPrice: '3 200',
      amount: '128 000',
      eta: '2026-03-16',
      buyer: 'Смирнов А.А.',
    }, {
      related: purchaseRelated('PO-2202', 'STK-2105', 'ID-2402', 'WH-30012', 'INV-100107', 'INV-100107'),
    }),
    row('PO-2201', 'Закупка тормозных дисков', 'Поставщик: ООО ТехПартс • STK-2103', 'requested', {
      stockItemId: 'STK-2103',
      supplier: 'ООО ТехПартс',
      quantity: '24',
      unitPrice: '18 500',
      amount: '444 000',
      eta: '2026-03-18',
      buyer: 'Смирнов А.А.',
    }, {
      related: purchaseRelated('PO-2201', 'STK-2103', 'ID-2401', 'WH-30011', 'INV-100106', 'INV-100106'),
    }),
  ],
  'inventory/documents': [
    row('ID-2408', 'Накладная WH-30018', 'Поставка от Подвеска-Сервис', 'expected', {
      number: 'WH-30018',
      supplier: 'Подвеска-Сервис',
      owner: 'Кладовщик',
      purchaseId: 'PO-2208',
      stockItemId: 'STK-2109',
    }, {
      related: documentRelated('PO-2208', 'Закупка амортизаторов', 'STK-2109', 'INV-100113', 'INV-100113'),
    }),
    row('ID-2407', 'Накладная WH-30017', 'Поставка от ТехСнаб', 'archived', {
      number: 'WH-30017',
      supplier: 'ТехСнаб',
      owner: 'Кладовщик',
      purchaseId: 'PO-2207',
      stockItemId: 'STK-2102',
    }, {
      related: documentRelated('PO-2207', 'Закупка моторного масла', 'STK-2102', 'INV-100112', 'INV-100112'),
    }),
    row('ID-2406', 'Накладная WH-30016', 'Поставка от ЭнергоСтарт', 'cancelled', {
      number: 'WH-30016',
      supplier: 'ЭнергоСтарт',
      owner: 'Кладовщик',
      purchaseId: 'PO-2206',
      stockItemId: 'STK-2115',
    }, {
      related: documentRelated('PO-2206', 'Закупка аккумуляторов', 'STK-2115', 'INV-100111', 'INV-100111'),
    }),
    row('ID-2405', 'Накладная WH-30015', 'Поставка от ХимРесурс', 'archived', {
      number: 'WH-30015',
      supplier: 'ХимРесурс',
      owner: 'Кладовщик',
      purchaseId: 'PO-2205',
      stockItemId: 'STK-2106',
    }, {
      related: documentRelated('PO-2205', 'Закупка тормозной жидкости', 'STK-2106', 'INV-100110', 'INV-100110'),
    }),
    row('ID-2404', 'Накладная WH-30014', 'Поставка от ПодшипникСнаб', 'expected', {
      number: 'WH-30014',
      supplier: 'ПодшипникСнаб',
      owner: 'Кладовщик',
      purchaseId: 'PO-2204',
      stockItemId: 'STK-2113',
    }, {
      related: documentRelated('PO-2204', 'Закупка подшипников ступицы', 'STK-2113', 'INV-100109', 'INV-100109'),
    }),
    row('ID-2403', 'Накладная WH-30013', 'Поставка от СветАвто', 'expected', {
      number: 'WH-30013',
      supplier: 'СветАвто',
      owner: 'Кладовщик',
      purchaseId: 'PO-2203',
      stockItemId: 'STK-2110',
    }, {
      related: documentRelated('PO-2203', 'Закупка фар', 'STK-2110', 'INV-100108', 'INV-100108'),
    }),
    row('ID-2402', 'Накладная WH-30012', 'Поставка от ФильтрТорг', 'expected', {
      number: 'WH-30012',
      supplier: 'ФильтрТорг',
      owner: 'Кладовщик',
      purchaseId: 'PO-2202',
      stockItemId: 'STK-2105',
    }, {
      related: documentRelated('PO-2202', 'Закупка салонных фильтров', 'STK-2105', 'INV-100107', 'INV-100107'),
    }),
    row('ID-2401', 'Накладная WH-30011', 'Поставка от ООО ТехПартс', 'expected', {
      number: 'WH-30011',
      supplier: 'ООО ТехПартс',
      owner: 'Кладовщик',
      purchaseId: 'PO-2201',
      stockItemId: 'STK-2103',
    }, {
      related: documentRelated('PO-2201', 'Закупка тормозных дисков', 'STK-2103', 'INV-100106', 'INV-100106'),
    }),
  ],
  'finance/invoices': [
    row('INV-100103', 'Исходящий счет INV-100103', 'Сделка DL-3001 • ООО АВТОПАРК • Исходящий', 'issued', {
      number: 'INV-100103',
      counterparty: 'ООО АВТОПАРК',
      direction: 'outgoing',
      amount: '2 350 000',
      paidAmount: '0',
      dueDate: '2026-03-11',
      owner: 'Финансовый отдел',
      dealId: 'DL-3001',
    }, {
      related: [
        rel('INV-100103-deal', 'Сделка', 'DL-3001: Сделка: Toyota Camry 2.5', 'crm-sales/deals', 'DL-3001'),
        rel('INV-100103-doc', 'Договор', salesContractRef('CTR-80011'), 'crm-sales/documents', 'DOC-4001'),
      ],
    }),
    row('INV-100104', 'Исходящий счет INV-100104', 'Сделка DL-3002 • Иван Петров • Исходящий', 'issued', {
      number: 'INV-100104',
      counterparty: 'Иван Петров',
      direction: 'outgoing',
      amount: '2 780 000',
      paidAmount: '0',
      dueDate: '2026-03-07',
      owner: 'Финансовый отдел',
      dealId: 'DL-3002',
    }, {
      related: [
        rel('INV-100104-deal', 'Сделка', 'DL-3002: Сделка: Hyundai Tucson', 'crm-sales/deals', 'DL-3002'),
        rel('INV-100104-doc', 'Договор', salesContractRef('CTR-80012'), 'crm-sales/documents', 'DOC-4002'),
      ],
    }),
    row('INV-100105', 'Исходящий счет INV-100105', 'Сделка DL-3003 • АО ТехТранс • Исходящий', 'paid', {
      number: 'INV-100105',
      counterparty: 'АО ТехТранс',
      direction: 'outgoing',
      amount: '3 120 000',
      paidAmount: '3 120 000',
      dueDate: '2026-02-20',
      owner: 'Финансовый отдел',
      dealId: 'DL-3003',
    }, {
      related: [
        rel('INV-100105-deal', 'Сделка', 'DL-3003: Сделка: KIA Sorento', 'crm-sales/deals', 'DL-3003'),
        rel('INV-100105-doc', 'Договор', salesContractRef('CTR-80013'), 'crm-sales/documents', 'DOC-4003'),
      ],
    }),
    row('INV-100113', 'Входящий счет INV-100113', 'Закупка PO-2208 • Подвеска-Сервис', 'issued', {
      number: 'INV-100113',
      counterparty: 'Подвеска-Сервис',
      direction: 'incoming',
      amount: '179 200',
      paidAmount: '60 000',
      dueDate: '2026-03-13',
      owner: 'Финансовый отдел',
      purchaseId: 'PO-2208',
      stockItemId: 'STK-2109',
    }, {
      related: invoiceRelated('PO-2208', 'Закупка амортизаторов', 'STK-2109', 'ID-2408', 'WH-30018'),
    }),
    row('INV-100112', 'Входящий счет INV-100112', 'Закупка PO-2207 • ТехСнаб', 'paid', {
      number: 'INV-100112',
      counterparty: 'ТехСнаб',
      direction: 'incoming',
      amount: '170 000',
      paidAmount: '170 000',
      dueDate: '2026-03-05',
      owner: 'Финансовый отдел',
      purchaseId: 'PO-2207',
      stockItemId: 'STK-2102',
    }, {
      related: invoiceRelated('PO-2207', 'Закупка моторного масла', 'STK-2102', 'ID-2407', 'WH-30017'),
    }),
    row('INV-100111', 'Входящий счет INV-100111', 'Закупка PO-2206 • ЭнергоСтарт', 'cancelled', {
      number: 'INV-100111',
      counterparty: 'ЭнергоСтарт',
      direction: 'incoming',
      amount: '76 000',
      paidAmount: '0',
      dueDate: '2026-03-08',
      owner: 'Финансовый отдел',
      purchaseId: 'PO-2206',
      stockItemId: 'STK-2115',
    }, {
      related: invoiceRelated('PO-2206', 'Закупка аккумуляторов', 'STK-2115', 'ID-2406', 'WH-30016'),
    }),
    row('INV-100110', 'Входящий счет INV-100110', 'Закупка PO-2205 • ХимРесурс', 'paid', {
      number: 'INV-100110',
      counterparty: 'ХимРесурс',
      direction: 'incoming',
      amount: '28 500',
      paidAmount: '28 500',
      dueDate: '2026-03-06',
      owner: 'Финансовый отдел',
      purchaseId: 'PO-2205',
      stockItemId: 'STK-2106',
    }, {
      related: invoiceRelated('PO-2205', 'Закупка тормозной жидкости', 'STK-2106', 'ID-2405', 'WH-30015'),
    }),
    row('INV-100109', 'Входящий счет INV-100109', 'Закупка PO-2204 • ПодшипникСнаб', 'issued', {
      number: 'INV-100109',
      counterparty: 'ПодшипникСнаб',
      direction: 'incoming',
      amount: '133 200',
      paidAmount: '0',
      dueDate: '2026-03-14',
      owner: 'Финансовый отдел',
      purchaseId: 'PO-2204',
      stockItemId: 'STK-2113',
    }, {
      related: invoiceRelated('PO-2204', 'Закупка подшипников ступицы', 'STK-2113', 'ID-2404', 'WH-30014'),
    }),
    row('INV-100108', 'Входящий счет INV-100108', 'Закупка PO-2203 • СветАвто', 'issued', {
      number: 'INV-100108',
      counterparty: 'СветАвто',
      direction: 'incoming',
      amount: '331 200',
      paidAmount: '0',
      dueDate: '2026-03-15',
      owner: 'Финансовый отдел',
      purchaseId: 'PO-2203',
      stockItemId: 'STK-2110',
    }, {
      related: invoiceRelated('PO-2203', 'Закупка фар', 'STK-2110', 'ID-2403', 'WH-30013'),
    }),
    row('INV-100107', 'Входящий счет INV-100107', 'Закупка PO-2202 • ФильтрТорг', 'issued', {
      number: 'INV-100107',
      counterparty: 'ФильтрТорг',
      direction: 'incoming',
      amount: '128 000',
      paidAmount: '0',
      dueDate: '2026-03-16',
      owner: 'Финансовый отдел',
      purchaseId: 'PO-2202',
      stockItemId: 'STK-2105',
    }, {
      related: invoiceRelated('PO-2202', 'Закупка салонных фильтров', 'STK-2105', 'ID-2402', 'WH-30012'),
    }),
    row('INV-100106', 'Входящий счет INV-100106', 'Закупка PO-2201 • ООО ТехПартс', 'issued', {
      number: 'INV-100106',
      counterparty: 'ООО ТехПартс',
      direction: 'incoming',
      amount: '444 000',
      paidAmount: '0',
      dueDate: '2026-03-18',
      owner: 'Финансовый отдел',
      purchaseId: 'PO-2201',
      stockItemId: 'STK-2103',
    }),
    row('INV-100114', 'Исходящий счет INV-100114', 'Сделка DL-3004 • ООО ДрайвТорг • Исходящий', 'paid', {
      number: 'INV-100114',
      counterparty: 'ООО ДрайвТорг',
      direction: 'outgoing',
      amount: '2 900 000',
      paidAmount: '2 900 000',
      dueDate: '2026-03-12',
      owner: 'Финансовый отдел',
      dealId: 'DL-3004',
    }, {
      history: historyMarch('inv-100114', 'Счет оплачен'),
      related: [
        rel('INV-100114-deal', 'Сделка', 'DL-3004: Сделка: Mazda CX-5 2022', 'crm-sales/deals', 'DL-3004'),
        rel('INV-100114-doc', 'Договор', salesContractRef('CTR-80014'), 'crm-sales/documents', 'DOC-4004'),
      ],
    }),
    row('INV-100115', 'Исходящий счет INV-100115', 'Сделка DL-3005 • Алексей Сидоров • Исходящий', 'paid', {
      number: 'INV-100115',
      counterparty: 'Алексей Сидоров',
      direction: 'outgoing',
      amount: '3 600 000',
      paidAmount: '3 600 000',
      dueDate: '2026-03-15',
      owner: 'Финансовый отдел',
      dealId: 'DL-3005',
    }, {
      history: historyMarch('inv-100115', 'Счет оплачен'),
      related: [
        rel('INV-100115-deal', 'Сделка', 'DL-3005: Сделка: Audi A4 2021', 'crm-sales/deals', 'DL-3005'),
        rel('INV-100115-doc', 'Договор', salesContractRef('CTR-80015'), 'crm-sales/documents', 'DOC-4005'),
      ],
    }),
    row('INV-100116', 'Исходящий счет INV-100116', 'Сделка DL-3006 • ИП Козлов К.К. • Исходящий', 'issued', {
      number: 'INV-100116',
      counterparty: 'ИП Козлов К.К.',
      direction: 'outgoing',
      amount: '4 200 000',
      paidAmount: '0',
      dueDate: '2026-03-25',
      owner: 'Финансовый отдел',
      dealId: 'DL-3006',
    }, {
      history: historyMarch('inv-100116', 'Счет выставлен'),
      related: [
        rel('INV-100116-deal', 'Сделка', 'DL-3006: Сделка: Mercedes C-Class 2022', 'crm-sales/deals', 'DL-3006'),
        rel('INV-100116-doc', 'Договор', salesContractRef('CTR-80016'), 'crm-sales/documents', 'DOC-4006'),
      ],
    }),
    row('INV-100117', 'Исходящий счет INV-100117', 'Сделка DL-3007 • АО МоторГрупп • Исходящий', 'paid', {
      number: 'INV-100117',
      counterparty: 'АО МоторГрупп',
      direction: 'outgoing',
      amount: '5 100 000',
      paidAmount: '5 100 000',
      dueDate: '2026-04-05',
      owner: 'Финансовый отдел',
      dealId: 'DL-3007',
    }, {
      history: historyApril('inv-100117', 'Счет оплачен'),
      related: [
        rel('INV-100117-deal', 'Сделка', 'DL-3007: Сделка: Lexus RX 2023', 'crm-sales/deals', 'DL-3007'),
        rel('INV-100117-doc', 'Договор', salesContractRef('CTR-80017'), 'crm-sales/documents', 'DOC-4007'),
      ],
    }),
    row('INV-100118', 'Исходящий счет INV-100118', 'Сделка DL-3008 • ООО ДрайвТорг • Исходящий', 'issued', {
      number: 'INV-100118',
      counterparty: 'ООО ДрайвТорг',
      direction: 'outgoing',
      amount: '4 800 000',
      paidAmount: '0',
      dueDate: '2026-04-12',
      owner: 'Финансовый отдел',
      dealId: 'DL-3008',
    }, {
      history: historyApril('inv-100118', 'Счет выставлен'),
      related: [
        rel('INV-100118-deal', 'Сделка', 'DL-3008: Сделка: Volvo XC60 2022', 'crm-sales/deals', 'DL-3008'),
        rel('INV-100118-doc', 'Договор', salesContractRef('CTR-80018'), 'crm-sales/documents', 'DOC-4008'),
      ],
    }),
    row('INV-100119', 'Исходящий счет INV-100119', 'Сделка DL-3009 • Алексей Сидоров • Исходящий', 'paid', {
      number: 'INV-100119',
      counterparty: 'Алексей Сидоров',
      direction: 'outgoing',
      amount: '1 450 000',
      paidAmount: '1 450 000',
      dueDate: '2026-04-10',
      owner: 'Финансовый отдел',
      dealId: 'DL-3009',
    }, {
      history: historyApril('inv-100119', 'Счет оплачен'),
      related: [
        rel('INV-100119-deal', 'Сделка', 'DL-3009: Сделка: Geely Atlas Pro 2023', 'crm-sales/deals', 'DL-3009'),
        rel('INV-100119-doc', 'Договор', salesContractRef('CTR-80019'), 'crm-sales/documents', 'DOC-4009'),
      ],
    }),
    row('INV-100120', 'Исходящий счет INV-100120', 'Заказ-наряд WO-10034 • Алексей Сидоров • Исходящий', 'paid', {
      number: 'INV-100120',
      counterparty: 'Алексей Сидоров',
      direction: 'outgoing',
      amount: '25 000',
      paidAmount: '25 000',
      dueDate: '2026-03-20',
      owner: 'Финансовый отдел',
    }, {
      history: historyMarch('inv-100120', 'Счет оплачен'),
      related: [
        rel('INV-100120-wo', 'Заказ-наряд', 'WO-10034', 'service/orders', 'WO-10034'),
      ],
    }),
    row('INV-100121', 'Исходящий счет INV-100121', 'Заказ-наряд WO-10035 • ИП Козлов К.К. • Исходящий', 'paid', {
      number: 'INV-100121',
      counterparty: 'ИП Козлов К.К.',
      direction: 'outgoing',
      amount: '45 000',
      paidAmount: '45 000',
      dueDate: '2026-03-25',
      owner: 'Финансовый отдел',
    }, {
      history: historyMarch('inv-100121', 'Счет оплачен'),
      related: [
        rel('INV-100121-wo', 'Заказ-наряд', 'WO-10035', 'service/orders', 'WO-10035'),
      ],
    }),
    row('INV-100122', 'Исходящий счет INV-100122', 'Заказ-наряд WO-10036 • АО МоторГрупп • Исходящий', 'issued', {
      number: 'INV-100122',
      counterparty: 'АО МоторГрупп',
      direction: 'outgoing',
      amount: '18 000',
      paidAmount: '0',
      dueDate: '2026-04-15',
      owner: 'Финансовый отдел',
    }, {
      history: historyApril('inv-100122', 'Счет выставлен'),
      related: [
        rel('INV-100122-wo', 'Заказ-наряд', 'WO-10036', 'service/orders', 'WO-10036'),
      ],
    }),
    row('INV-100123', 'Исходящий счет INV-100123', 'Заказ-наряд WO-10037 • ООО ДрайвТорг • Исходящий', 'issued', {
      number: 'INV-100123',
      counterparty: 'ООО ДрайвТорг',
      direction: 'outgoing',
      amount: '32 000',
      paidAmount: '0',
      dueDate: '2026-04-20',
      owner: 'Финансовый отдел',
    }, {
      history: historyApril('inv-100123', 'Счет выставлен'),
      related: [
        rel('INV-100123-wo', 'Заказ-наряд', 'WO-10037', 'service/orders', 'WO-10037'),
      ],
    }),
  ],
  'finance/payments': [
    row('PAY-3101', 'Платеж PAY-3101', 'Сделка DL-3001 • Счет INV-100103 • Банковский перевод', 'initiated', {
      invoice: 'INV-100103',
      amount: '350 000',
      method: 'Банковский перевод',
      owner: 'Казначей',
      dealId: 'DL-3001',
    }, {
      related: [
        rel('PAY-3101-inv', 'Счет', salesInvoiceRef('INV-100103'), 'finance/invoices', 'INV-100103'),
        rel('PAY-3101-deal', 'Сделка', 'DL-3001: Сделка: Toyota Camry 2.5', 'crm-sales/deals', 'DL-3001'),
      ],
    }),
    row('PAY-3102', 'Платеж PAY-3102', 'Сделка DL-3002 • Счет INV-100104 • Банковский перевод', 'confirmed', {
      invoice: 'INV-100104',
      amount: '1 200 000',
      method: 'Банковский перевод',
      owner: 'Казначей',
      dealId: 'DL-3002',
    }, {
      related: [
        rel('PAY-3102-inv', 'Счет', salesInvoiceRef('INV-100104'), 'finance/invoices', 'INV-100104'),
        rel('PAY-3102-deal', 'Сделка', 'DL-3002: Сделка: Hyundai Tucson', 'crm-sales/deals', 'DL-3002'),
      ],
    }),
    row('PAY-3103', 'Платеж PAY-3103', 'Сделка DL-3003 • Счет INV-100105 • Банк-клиент', 'reconciled', {
      invoice: 'INV-100105',
      amount: '3 120 000',
      method: 'Банк-клиент',
      owner: 'Казначей',
      dealId: 'DL-3003',
    }, {
      related: [
        rel('PAY-3103-inv', 'Счет', salesInvoiceRef('INV-100105'), 'finance/invoices', 'INV-100105'),
        rel('PAY-3103-deal', 'Сделка', 'DL-3003: Сделка: KIA Sorento', 'crm-sales/deals', 'DL-3003'),
      ],
    }),
    row('PAY-3104', 'Платеж PAY-3104', 'Счет INV-100113 • Банковский перевод', 'reconciled', {
      invoice: 'INV-100113',
      amount: '60 000',
      method: 'Банковский перевод',
      owner: 'Казначей',
      purchaseId: 'PO-2208',
      stockItemId: 'STK-2109',
    }, {
      related: [
        rel('PAY-3104-inv', 'Счет', invoiceRef('INV-100113'), 'finance/invoices', 'INV-100113'),
        rel('PAY-3104-purchase', 'Закупка', 'PO-2208: Закупка амортизаторов', 'inventory/purchases', 'PO-2208'),
      ],
    }),
    row('PAY-3105', 'Платеж PAY-3105', 'Счет INV-100109 • Банковский перевод', 'initiated', {
      invoice: 'INV-100109',
      amount: '40 000',
      method: 'Банковский перевод',
      owner: 'Казначей',
      purchaseId: 'PO-2204',
      stockItemId: 'STK-2113',
    }, {
      related: [
        rel('PAY-3105-inv', 'Счет', invoiceRef('INV-100109'), 'finance/invoices', 'INV-100109'),
      ],
    }),
    row('PAY-3106', 'Платеж PAY-3106', 'Сделка DL-3004 • Счет INV-100114 • Банк-клиент', 'reconciled', {
      invoice: 'INV-100114',
      amount: '2 900 000',
      method: 'Банк-клиент',
      owner: 'Казначей',
      dealId: 'DL-3004',
    }, {
      history: historyMarch('pay-3106', 'Платеж сверен'),
      related: [
        rel('PAY-3106-inv', 'Счет', salesInvoiceRef('INV-100114'), 'finance/invoices', 'INV-100114'),
        rel('PAY-3106-deal', 'Сделка', 'DL-3004: Сделка: Mazda CX-5 2022', 'crm-sales/deals', 'DL-3004'),
      ],
    }),
    row('PAY-3107', 'Платеж PAY-3107', 'Сделка DL-3005 • Счет INV-100115 • Наличные', 'reconciled', {
      invoice: 'INV-100115',
      amount: '3 600 000',
      method: 'Наличные',
      owner: 'Казначей',
      dealId: 'DL-3005',
    }, {
      history: historyMarch('pay-3107', 'Платеж сверен'),
      related: [
        rel('PAY-3107-inv', 'Счет', salesInvoiceRef('INV-100115'), 'finance/invoices', 'INV-100115'),
        rel('PAY-3107-deal', 'Сделка', 'DL-3005: Сделка: Audi A4 2021', 'crm-sales/deals', 'DL-3005'),
      ],
    }),
    row('PAY-3108', 'Платеж PAY-3108', 'Сделка DL-3007 • Счет INV-100117 • Банковский перевод', 'reconciled', {
      invoice: 'INV-100117',
      amount: '5 100 000',
      method: 'Банковский перевод',
      owner: 'Казначей',
      dealId: 'DL-3007',
    }, {
      history: historyApril('pay-3108', 'Платеж сверен'),
      related: [
        rel('PAY-3108-inv', 'Счет', salesInvoiceRef('INV-100117'), 'finance/invoices', 'INV-100117'),
        rel('PAY-3108-deal', 'Сделка', 'DL-3007: Сделка: Lexus RX 2023', 'crm-sales/deals', 'DL-3007'),
      ],
    }),
    row('PAY-3109', 'Платеж PAY-3109', 'Сделка DL-3009 • Счет INV-100119 • Наличные', 'reconciled', {
      invoice: 'INV-100119',
      amount: '1 450 000',
      method: 'Наличные',
      owner: 'Казначей',
      dealId: 'DL-3009',
    }, {
      history: historyApril('pay-3109', 'Платеж сверен'),
      related: [
        rel('PAY-3109-inv', 'Счет', salesInvoiceRef('INV-100119'), 'finance/invoices', 'INV-100119'),
        rel('PAY-3109-deal', 'Сделка', 'DL-3009: Сделка: Geely Atlas Pro 2023', 'crm-sales/deals', 'DL-3009'),
      ],
    }),
    row('PAY-3110', 'Платеж PAY-3110', 'Счет INV-100120 • По терминалу', 'reconciled', {
      invoice: 'INV-100120',
      amount: '25 000',
      method: 'По терминалу',
      owner: 'Казначей',
    }, {
      history: historyMarch('pay-3110', 'Платеж сверен'),
      related: [
        rel('PAY-3110-inv', 'Счет', invoiceRef('INV-100120'), 'finance/invoices', 'INV-100120'),
      ],
    }),
    row('PAY-3111', 'Платеж PAY-3111', 'Счет INV-100121 • Банковский перевод', 'reconciled', {
      invoice: 'INV-100121',
      amount: '45 000',
      method: 'Банковский перевод',
      owner: 'Казначей',
    }, {
      history: historyMarch('pay-3111', 'Платеж сверен'),
      related: [
        rel('PAY-3111-inv', 'Счет', invoiceRef('INV-100121'), 'finance/invoices', 'INV-100121'),
      ],
    }),
  ],
  'finance/reports': [
    row('RPT-3201', 'AR/AP Март', 'Период 03.2026 • Открыто 10 485 600', 'generated', {
      type: 'ar-ap',
      period: '03.2026',
      format: 'PDF',
      owner: 'Финансовый менеджер',
      incomingIssuedTotal: '1 414 100',
      incomingPaidTotal: '258 500',
      outgoingIssuedTotal: '15 900 000',
      outgoingPaidTotal: '6 570 000',
      openInvoiceTotal: '10 485 600',
      reconciledPaymentsTotal: '6 630 000',
      invoiceCount: '14',
      paymentCount: '7',
    }, {
      history: historyMarch('rpt-3201', 'Отчет сформирован'),
      related: [],
    }),
    row('RPT-3202', 'AR/AP Февраль', 'Период 02.2026 • Открыто 4 120 600', 'generated', {
      type: 'ar-ap',
      period: '02.2026',
      format: 'PDF',
      owner: 'Финансовый менеджер',
      incomingIssuedTotal: '1 414 100',
      incomingPaidTotal: '258 500',
      outgoingIssuedTotal: '6 085 000',
      outgoingPaidTotal: '3 120 000',
      openInvoiceTotal: '4 120 600',
      reconciledPaymentsTotal: '3 180 000',
      invoiceCount: '9',
      paymentCount: '5',
    }, {
      related: [],
    }),
    row('RPT-3203', 'Cashflow Январь', 'Период 01.2026 • Открыто 3 480 000', 'archived', {
      type: 'cashflow',
      period: '01.2026',
      format: 'CSV',
      owner: 'Финансовый менеджер',
      incomingIssuedTotal: '980 000',
      incomingPaidTotal: '210 000',
      outgoingIssuedTotal: '4 250 000',
      outgoingPaidTotal: '1 760 000',
      openInvoiceTotal: '3 480 000',
      reconciledPaymentsTotal: '1 970 000',
      invoiceCount: '7',
      paymentCount: '4',
    }, {
      related: [],
    }),
    row('RPT-3204', 'AR/AP Апрель', 'Период 04.2026 • Открыто 0', 'draft', {
      type: 'ar-ap',
      period: '04.2026',
      format: 'XLSX',
      owner: 'Финансовый менеджер',
      incomingIssuedTotal: '0',
      incomingPaidTotal: '0',
      outgoingIssuedTotal: '0',
      outgoingPaidTotal: '0',
      openInvoiceTotal: '0',
      reconciledPaymentsTotal: '0',
      invoiceCount: '0',
      paymentCount: '0',
    }, {
      history: historyApril('rpt-3204', 'Черновик отчета'),
      related: [],
    }),
  ],
  'finance/documents': [
    row('FD-3301', 'Платежное поручение PP-88017', 'ООО Партс', 'draft', {
      number: 'PP-88017',
      docType: 'Платежное поручение',
      owner: 'Бухгалтер',
      counterparty: 'ООО Партс',
      source: 'Финансы',
    }, {
      related: [],
    }),
    row('FD-3302', 'Акт сверки AC-77201', 'АО ТехТранс', 'posted', {
      number: 'AC-77201',
      docType: 'Акт сверки',
      owner: 'Бухгалтер',
      counterparty: 'АО ТехТранс',
      source: 'Финансы',
    }, {
      related: [],
    }),
    row('FD-3303', 'Реестр оплат RG-33003', 'Казначейство • неделя 11', 'archived', {
      number: 'RG-33003',
      docType: 'Платежное поручение',
      owner: 'Бухгалтер',
      counterparty: 'Внутренний реестр',
      source: 'Финансы',
    }, {
      related: [],
    }),
  ],
  'platform/users': [
    row('USR-4001', 'Иванов И.И.', 'Менеджер-консультант • Продажи', 'active', {
      email: 'ivanov@kis.local',
      businessRoleId: 'RLB-SALES',
      department: 'Продажи',
      phone: '+7 (900) 101-00-01',
    }),
    row('USR-4002', 'Петрова А.А.', 'Менеджер-консультант • Продажи', 'active', {
      email: 'petrova@kis.local',
      businessRoleId: 'RLB-SALES',
      department: 'Продажи',
      phone: '+7 (900) 101-00-02',
    }),
    row('USR-4003', 'Смирнов С.С.', 'Механик • Сервис и склад', 'disabled', {
      email: 'smirnov@kis.local',
      businessRoleId: 'RLB-MECHANIC',
      department: 'Сервис и склад',
      phone: '+7 (900) 101-00-03',
    }),
    row('USR-4004', 'Петров П.П.', 'Механик • Сервис и склад', 'active', {
      email: 'petrov.pp@kis.local',
      businessRoleId: 'RLB-MECHANIC',
      department: 'Сервис и склад',
      phone: '+7 (900) 101-00-04',
    }),
    row('USR-4005', 'Сидоров С.С.', 'Механик • Сервис и склад', 'active', {
      email: 'sidorov.ss@kis.local',
      businessRoleId: 'RLB-MECHANIC',
      department: 'Сервис и склад',
      phone: '+7 (900) 101-00-05',
    }),
    row('USR-4006', 'Старший мастер', 'Механик • Сервис и склад', 'active', {
      email: 'master@kis.local',
      businessRoleId: 'RLB-MECHANIC',
      department: 'Сервис и склад',
      phone: '+7 (900) 101-00-06',
    }),
    row('USR-4007', 'Администратор платформы', 'Администратор • Платформа', 'active', {
      email: 'admin@kis.local',
      businessRoleId: 'RLB-ADMIN',
      department: 'Платформа',
      phone: '+7 (900) 101-00-07',
    }),
    row('USR-4008', 'Кузнецова Е.Е.', 'Аналитик • Финансы', 'active', {
      email: 'analyst@kis.local',
      businessRoleId: 'RLB-ANALYST',
      department: 'Финансы',
      phone: '+7 (900) 101-00-08',
    }),
  ],
  'platform/roles': [
    row('RLB-ADMIN', 'Администратор', 'CRM, Сервис, Склад, Финансы, Платформа • Security Team', 'active', {
      ...buildPlatformRoleValues('RLB-ADMIN', 1),
    }),
    row('RLB-SALES', 'Менеджер по продажам', 'CRM • Security Team', 'active', {
      ...buildPlatformRoleValues('RLB-SALES', 2),
    }),
    row('RLB-MECHANIC', 'Механик', 'Сервис, Склад • Security Team', 'active', {
      ...buildPlatformRoleValues('RLB-MECHANIC', 4),
    }),
    row('RLB-ANALYST', 'Аналитик', 'Финансы • Security Team', 'active', {
      ...buildPlatformRoleValues('RLB-ANALYST', 1),
    }),
  ],
  'platform/audits': [
    row('AUD-4201', 'Проверка доступа к счетам', 'Контроль RBAC', 'recorded', {
      date: '2026-02-20',
      actor: 'security.bot',
      resource: 'finance/invoices',
      result: 'warning',
    }),
    row('AUD-4202', 'Проверка критических действий', 'Операции закупок и приемки', 'reviewed', {
      date: '2026-02-19',
      actor: 'security.bot',
      resource: 'inventory/purchases',
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
