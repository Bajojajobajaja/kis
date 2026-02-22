export type PhaseStatus = 'next' | 'planned' | 'later'

export type RoadmapPhase = {
  id: string
  title: string
  status: PhaseStatus
  outcome: string
  items: string[]
  services: string[]
  integrations: string[]
}

export type SubsystemRoadmap = {
  sourceDocs: string[]
  keyEntities: string[]
  keyEvents: string[]
  phases: RoadmapPhase[]
}

export const subsystemRoadmaps: Record<string, SubsystemRoadmap> = {
  'crm-sales': {
    sourceDocs: ['techicaldocumentation.md (6.1)', 'technicalsubsistem.md (Подсистема 1)'],
    keyEntities: [
      'Клиент/контакт',
      'Лид/обращение',
      'Сделка',
      'Автомобиль (VIN)',
      'Документы продажи',
    ],
    keyEvents: [
      'LeadCreated',
      'LeadQualified',
      'VehicleReserved',
      'ContractIssued',
      'SalePaid',
      'VehicleDelivered',
    ],
    phases: [
      {
        id: 'crm-wave-1',
        title: 'Wave 1: Intake + CRM-ядро',
        status: 'next',
        outcome: 'Единый поток заявок и качественная клиентская база с историей взаимодействий.',
        items: [
          'Прием заявок из каналов (сайт/телефон/мессенджеры) с нормализацией и дедупликацией.',
          'SLA обработки лидов и маршрутизация на продажи/сервис.',
          'Карточка клиента, контакты, предпочтения, история касаний.',
        ],
        services: ['crm-leads', 'crm-contacts'],
        integrations: ['api-gateway', 'identity-access', 'audit-log'],
      },
      {
        id: 'crm-wave-2',
        title: 'Wave 2: Воронка сделок и резерв VIN',
        status: 'planned',
        outcome: 'Прозрачный процесс сделки от квалификации до победы/проигрыша.',
        items: [
          'Этапы сделки и контроль переходов статусов.',
          'Резервирование авто по VIN и контроль срока резерва.',
          'Расчет итоговой цены: база + опции/скидки + правила pricing.',
        ],
        services: ['sales-deals', 'pricing'],
        integrations: ['inventory-stock', 'notification'],
      },
      {
        id: 'crm-wave-3',
        title: 'Wave 3: Документы и оплаты',
        status: 'planned',
        outcome: 'Сделка закрывается документами и оплатой без ручного дублирования.',
        items: [
          'Генерация договора, счета, акта приема-передачи и чека.',
          'Фиксация статусов оплаты и сверка поступлений.',
          'Публикация бизнес-событий для склада и финансов.',
        ],
        services: ['sales-documents', 'finance-invoicing'],
        integrations: ['finance-ledger', 'inventory-stock'],
      },
      {
        id: 'crm-wave-4',
        title: 'Wave 4: Omnichannel и post-MVP расширения',
        status: 'later',
        outcome: 'Подключены внешние каналы и продвинутая коммерческая логика.',
        items: [
          'Интеграции website/telephony/messaging по контрактным API.',
          'Расширенные акции/комиссии/правила ценообразования.',
          'Сегментация клиентской базы для маркетинговых сценариев.',
        ],
        services: ['crm-leads', 'pricing', 'reporting-bi'],
        integrations: ['notification', 'analytics-marts'],
      },
    ],
  },
  service: {
    sourceDocs: ['techicaldocumentation.md (6.2)', 'technicalsubsistem.md (Подсистема 2)'],
    keyEntities: [
      'Запись в сервис',
      'Заказ-наряд (WO)',
      'Диагностика',
      'Работы и нормо-часы',
      'Счет/акт сервиса',
    ],
    keyEvents: [
      'BookingCreated',
      'WorkOrderOpened',
      'DiagnosticsCompleted',
      'PartsReserved',
      'WorkOrderCompleted',
      'ServicePaid',
      'VehicleReleased',
    ],
    phases: [
      {
        id: 'service-wave-1',
        title: 'Wave 1: Запись и заказ-наряд',
        status: 'next',
        outcome: 'Запись и приемка авто переводятся в управляемый процесс с SLA.',
        items: [
          'Календарь слотов и загрузка постов/мастеров.',
          'Создание WO со статусной моделью и ответственными.',
          'Контроль сроков и узких мест по заказ-нарядам.',
        ],
        services: ['service-appointments', 'service-workorders'],
        integrations: ['crm-contacts', 'identity-access'],
      },
      {
        id: 'service-wave-2',
        title: 'Wave 2: Диагностика и каталог работ',
        status: 'planned',
        outcome: 'Решения по ремонту обоснованы диагностикой и нормами.',
        items: [
          'Протокол диагностики и рекомендации по ремонту.',
          'Справочник услуг/работ и расчет по нормо-часам.',
          'Проверка гарантийного статуса по VIN.',
        ],
        services: ['service-diagnostics', 'service-labor-catalog'],
        integrations: ['masterdata-catalog', 'audit-log'],
      },
      {
        id: 'service-wave-3',
        title: 'Wave 3: Запчасти и биллинг',
        status: 'planned',
        outcome: 'Закрытие WO происходит с корректным списанием и финансовыми документами.',
        items: [
          'Резерв/списание/возврат запчастей по WO.',
          'Контроль дефицита и создание заявок в закупки.',
          'Формирование счета и акта выполненных работ.',
        ],
        services: ['service-parts-usage', 'service-billing'],
        integrations: ['inventory-stock', 'inventory-procurement', 'finance-ledger'],
      },
      {
        id: 'service-wave-4',
        title: 'Wave 4: Клиентские уведомления и качество',
        status: 'later',
        outcome: 'Клиент получает прозрачный статус работ, а руководитель видит KPI сервиса.',
        items: [
          'Уведомления по этапам WO: запись/согласование/готовность.',
          'Сквозные KPI по срокам и загрузке сервиса.',
          'Оценка качества и контроль повторных обращений.',
        ],
        services: ['notification', 'reporting-bi'],
        integrations: ['service-workorders', 'analytics-marts'],
      },
    ],
  },
  inventory: {
    sourceDocs: ['techicaldocumentation.md (6.3)', 'technicalsubsistem.md (Подсистема 3)'],
    keyEntities: [
      'Номенклатура',
      'Остаток',
      'Движение',
      'Заказ поставщику',
      'Приемка/инвентаризация',
    ],
    keyEvents: [
      'GoodsReceived',
      'StockAdjusted',
      'PartsReserved',
      'PartsIssued',
      'VehicleStatusChanged',
      'PurchaseOrderCreated',
    ],
    phases: [
      {
        id: 'inv-wave-1',
        title: 'Wave 1: Каталог и ядро остатков',
        status: 'next',
        outcome: 'Единые справочники и достоверные остатки по авто/запчастям.',
        items: [
          'Справочники авто-моделей и деталей с едиными кодами.',
          'Учет остатков и движений: приход/расход/перемещение.',
          'Операции резерва и освобождения для продаж и сервиса.',
        ],
        services: ['masterdata-catalog', 'inventory-stock'],
        integrations: ['sales-deals', 'service-workorders'],
      },
      {
        id: 'inv-wave-2',
        title: 'Wave 2: Закупки и складские операции',
        status: 'planned',
        outcome: 'Закупки и склад работают как единая цепочка от потребности до выдачи.',
        items: [
          'Заявки и заказы поставщикам со статусами поставок.',
          'Min/max и точка заказа для автоматизации пополнения.',
          'Процессы приемки, размещения, комплектации, отгрузки.',
        ],
        services: ['inventory-procurement', 'inventory-receiving'],
        integrations: ['inventory-stock', 'finance-ledger'],
      },
      {
        id: 'inv-wave-3',
        title: 'Wave 3: Инвентаризация и контроль точности',
        status: 'planned',
        outcome: 'Снижается расхождение учет/факт и повышается доверие к данным.',
        items: [
          'Инвентаризационные задания и ведомости.',
          'Фиксация расхождений и корректировки остатков.',
          'Журнал инвентаризаций и аудит изменений.',
        ],
        services: ['inventory-audit', 'audit-log'],
        integrations: ['finance-costing', 'reporting-bi'],
      },
      {
        id: 'inv-wave-4',
        title: 'Wave 4: Прогнозирование и оптимизация запасов',
        status: 'later',
        outcome: 'Запасы управляются на основе прогноза потребления и продаж.',
        items: [
          'Прогноз спроса и сезонности по номенклатуре.',
          'Рекомендации по объему заказа и срокам пополнения.',
          'Оптимизация оборачиваемости и снижение излишков.',
        ],
        services: ['inventory-procurement', 'analytics-marts'],
        integrations: ['sales-deals', 'service-parts-usage'],
      },
    ],
  },
  finance: {
    sourceDocs: ['techicaldocumentation.md (6.4)', 'technicalsubsistem.md (Подсистема 4)'],
    keyEntities: [
      'Проводка',
      'Счет/оплата',
      'Статья затрат',
      'Контрагент',
      'Отчетный период',
    ],
    keyEvents: [
      'PaymentReceived',
      'LedgerEntryPosted',
      'ReportGenerated',
      'ServicePaid',
      'SalePaid',
    ],
    phases: [
      {
        id: 'fin-wave-1',
        title: 'Wave 1: Реестр операций и проводки',
        status: 'next',
        outcome: 'Финансовые события из доменов превращаются в контролируемые проводки.',
        items: [
          'План счетов/статей доходов и расходов.',
          'Постинг проводок из событий продаж/сервиса/закупок.',
          'Журнал финансовых операций и неизменяемый аудит.',
        ],
        services: ['finance-ledger'],
        integrations: ['sales-deals', 'service-billing', 'inventory-procurement'],
      },
      {
        id: 'fin-wave-2',
        title: 'Wave 2: Счета и взаиморасчеты (AR/AP)',
        status: 'planned',
        outcome: 'Управление дебиторкой/кредиторкой и статусами оплаты в одном контуре.',
        items: [
          'Счета к оплате/получению по продажам и сервису.',
          'Фиксация статусов оплаты и сверки.',
          'Интеграция внешних уведомлений банка (при наличии).',
        ],
        services: ['finance-invoicing'],
        integrations: ['finance-ledger', 'sales-documents', 'service-billing'],
      },
      {
        id: 'fin-wave-3',
        title: 'Wave 3: Себестоимость и управленческие отчеты',
        status: 'planned',
        outcome: 'Появляется управляемая маржинальность по сделкам и заказ-нарядам.',
        items: [
          'Расчет себестоимости: авто/запчасти/работы.',
          'P&L, ДДС, валовая прибыль и оборачиваемость запасов.',
          'Экспорт отчетов и расписание формирования.',
        ],
        services: ['finance-costing', 'finance-reporting'],
        integrations: ['inventory-stock', 'reporting-bi'],
      },
      {
        id: 'fin-wave-4',
        title: 'Wave 4: BI-витрины и комплаенс',
        status: 'later',
        outcome: 'Near real-time аналитика и подготовка регламентных форм с минимумом ручного труда.',
        items: [
          'Near real-time витрины и KPI-панели.',
          'Детализация аналитик по направлениям бизнеса.',
          'Опциональный контур tax/compliance и выгрузок.',
        ],
        services: ['analytics-marts'],
        integrations: ['finance-reporting', 'reporting-bi'],
      },
    ],
  },
  platform: {
    sourceDocs: ['techicaldocumentation.md (4.4, 4.6, 4.7)', 'technicalsubsistem.md (сквозные требования)'],
    keyEntities: ['Пользователь/роль', 'Секрет/доступ', 'Аудит-событие', 'Уведомление', 'Контракт API/Event'],
    keyEvents: ['AccessGranted', 'AuditEventRecorded', 'NotificationSent', 'ContractPublished', 'AlertTriggered'],
    phases: [
      {
        id: 'plat-wave-1',
        title: 'Wave 1: Контур доступа и API-периметр',
        status: 'next',
        outcome: 'Единая точка входа и безопасный доступ ко всем доменам.',
        items: [
          'API Gateway: маршрутизация, rate limit, auth.',
          'Identity & Access: RBAC по ролям и операциям.',
          'Базовый аудит критичных действий с хранением before/after.',
        ],
        services: ['api-gateway', 'identity-access', 'audit-log'],
        integrations: ['crm-contacts', 'sales-deals', 'service-workorders', 'inventory-stock', 'finance-ledger'],
      },
      {
        id: 'plat-wave-2',
        title: 'Wave 2: Событийные контракты и уведомления',
        status: 'planned',
        outcome: 'Домены связаны через устойчивый event-driven контур.',
        items: [
          'Контрактные события и версии схем.',
          'Notification pipeline (email/SMS) по доменным триггерам.',
          'Шаблоны саг и компенсаций для междоменных процессов.',
        ],
        services: ['notification', 'reporting-bi'],
        integrations: ['nats', 'all-domain-services'],
      },
      {
        id: 'plat-wave-3',
        title: 'Wave 3: Observability и эксплуатация',
        status: 'planned',
        outcome: 'Система прозрачна для поддержки и on-call.',
        items: [
          'Метрики, трейсинг и централизованный логинг.',
          'SLA/SLO и alerting с контролем error budget.',
          'Runbook, backup/restore, секреты, операционные процедуры.',
        ],
        services: ['reporting-bi', 'audit-log'],
        integrations: ['prometheus', 'loki', 'tempo', 'grafana'],
      },
      {
        id: 'plat-wave-4',
        title: 'Wave 4: Production maturity',
        status: 'later',
        outcome: 'Платформа готова к стабильному dev/stage/prod delivery.',
        items: [
          'Kubernetes overlays + Helm для environment-specific deployments.',
          'CI/CD деплой по окружениям с governance через approvals.',
          'Надежность и стоимость: autoscaling, quotas, FinOps review.',
        ],
        services: ['api-gateway', 'identity-access', 'audit-log', 'notification', 'reporting-bi'],
        integrations: ['infra/k8s', '.github/workflows/cd.yml'],
      },
    ],
  },
}

