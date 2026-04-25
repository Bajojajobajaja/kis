import { describe, expect, it } from 'vitest'

import {
  entityStoreMigrationSteps,
  migrateEntityStore,
  type EntityStoreSnapshot,
} from './entityStoreMigrations'
import type { EntityRecord } from './model'

function buildRecord(
  id: string,
  title: string,
  values: Record<string, string>,
  status = 'active',
): EntityRecord {
  return {
    id,
    title,
    subtitle: '',
    status,
    values,
    history: [],
    related: [],
  }
}

describe('entityStoreMigrations', () => {
  it('migrates legacy string references to ids when the match is unique', () => {
    const referenceMigration = entityStoreMigrationSteps.find(
      (step) => step.key === 'reference-id-migration',
    )
    if (!referenceMigration) {
      throw new Error('reference-id-migration step is missing')
    }

    const legacyStore: EntityStoreSnapshot = {
      'crm-sales/clients': [buildRecord('CL-0001', 'ООО Автопарк', {})],
      'crm-sales/cars': [buildRecord('CAR-0001', 'Toyota Camry', { vin: 'VIN-001' })],
      'crm-sales/deals': [
        buildRecord('DL-0001', 'Сделка Camry', {
          client: 'ООО Автопарк',
          vin: 'VIN-001',
          amount: '2 000 000',
        }),
      ],
    }

    const migratedStore = referenceMigration.migrate(legacyStore)
    const migratedDeal = migratedStore['crm-sales/deals'][0]

    expect(migratedDeal.values.client).toBe('CL-0001')
    expect(migratedDeal.values.clientText).toBe('')
    expect(migratedDeal.values.vin).toBe('CAR-0001')
    expect(migratedDeal.values.vinText).toBe('')
  })

  it('moves ambiguous legacy references into companion text fields', () => {
    const referenceMigration = entityStoreMigrationSteps.find(
      (step) => step.key === 'reference-id-migration',
    )
    if (!referenceMigration) {
      throw new Error('reference-id-migration step is missing')
    }

    const legacyStore: EntityStoreSnapshot = {
      'crm-sales/clients': [
        buildRecord('CL-0001', 'ООО Автопарк', {}),
        buildRecord('CL-0002', 'ООО Автопарк', {}),
      ],
      'crm-sales/deals': [
        buildRecord('DL-0001', 'Сделка', {
          client: 'ООО Автопарк',
        }),
      ],
    }

    const migratedStore = referenceMigration.migrate(legacyStore)
    const migratedDeal = migratedStore['crm-sales/deals'][0]

    expect(migratedDeal.values.client).toBe('')
    expect(migratedDeal.values.clientText).toBe('ООО Автопарк')
  })

  it('normalizes platform users and roles before migrating sales manager references', () => {
    const legacyStore: EntityStoreSnapshot = {
      'platform/users': [
        buildRecord('USR-0001', 'Иванов И.И.', {
          role: 'manager',
          department: 'Продажи',
        }),
        buildRecord(
          'USR-0002',
          'Петрова А.А.',
          {
            role: 'manager',
            department: 'Сервис',
          },
          'suspended',
        ),
      ],
      'platform/roles': [
        buildRecord('RLB-4101', 'sales_manager', {
          scope: 'CRM',
          permissions: 'create,edit,archive,close',
          owner: 'Security Team',
        }),
        buildRecord(
          'RLB-4103',
          'legacy_operator',
          {
            scope: 'Platform',
            permissions: 'read',
            owner: 'Security Team',
          },
          'closed',
        ),
      ],
      'crm-sales/leads': [
        buildRecord('LD-0001', 'Лид', {
          manager: 'Иванов И.И.',
        }),
      ],
      'service/orders': [
        buildRecord('WO-0001', 'Заказ-наряд', {
          master: 'Петров П.П.',
        }),
      ],
      'service/events': [
        buildRecord('SEV-0001', 'Сервисное событие', {
          owner: 'Старший мастер',
        }),
      ],
    }

    const migratedStore = migrateEntityStore(legacyStore)
    const salesUser = migratedStore['platform/users'].find((item) => item.id === 'USR-0001')
    const serviceUser = migratedStore['platform/users'].find((item) => item.id === 'USR-0002')
    const salesRole = migratedStore['platform/roles'].find((item) => item.id === 'RLB-SALES')
    const mechanicRole = migratedStore['platform/roles'].find((item) => item.id === 'RLB-MECHANIC')
    const migratedLead = migratedStore['crm-sales/leads'][0]
    const migratedWorkorder = migratedStore['service/orders'][0]
    const migratedServiceEvent = migratedStore['service/events'][0]

    expect(salesUser?.values.accessRole).toBeUndefined()
    expect(salesUser?.values.businessRoleId).toBe('RLB-SALES')
    expect(salesUser?.values.role).toBeUndefined()
    expect(serviceUser?.status).toBe('disabled')
    expect(serviceUser?.values.businessRoleId).toBe('RLB-MECHANIC')
    expect(migratedStore['platform/roles'].map((item) => item.id)).toEqual([
      'RLB-ADMIN',
      'RLB-SALES',
      'RLB-MECHANIC',
      'RLB-ANALYST',
    ])
    expect(salesRole?.title).toBe('Менеджер по продажам')
    expect(salesRole?.values.users).toBe('1')
    expect(mechanicRole?.values.users).toBe('4')
    expect(migratedLead.values.manager).toBe('USR-0001')
    expect(migratedLead.values.managerText).toBe('')
    expect(migratedWorkorder.values.master).toBe('USR-4004')
    expect(migratedWorkorder.values.masterText).toBe('')
    expect(migratedServiceEvent.values.owner).toBe('USR-4006')
    expect(migratedServiceEvent.values.ownerText).toBe('')
  })

  it('keeps users without an unambiguous legacy role unassigned', () => {
    const migratedStore = migrateEntityStore({
      'platform/users': [
        buildRecord('USR-0099', 'Неизвестный пользователь', {
          department: 'Безопасность',
        }),
      ],
    })

    const user = migratedStore['platform/users'][0]
    expect(user.values.businessRoleId).toBe('')
    expect(user.values.businessRoleIdText).toBe('Требует назначения роли')
    expect(user.values.accessRole).toBeUndefined()
  })

  it('backfills finance invoices for deals that do not have one yet', () => {
    const legacyStore: EntityStoreSnapshot = {
      'crm-sales/clients': [buildRecord('CL-0001', 'ООО Автопарк', {})],
      'crm-sales/deals': [
        buildRecord('DL-0001', 'Сделка Camry', {
          client: 'CL-0001',
          amount: '2 000 000',
          manager: 'Иванов И.И.',
        }),
      ],
      'crm-sales/documents': [
        {
          ...buildRecord('DOC-0001', 'Договор CTR-0001', {
            docType: 'Договор',
            client: 'CL-0001',
          }),
          related: [
            {
              id: 'rel-doc-deal',
              label: 'Сделка',
              value: 'DL-0001: Сделка Camry',
              storeKey: 'crm-sales/deals',
              recordId: 'DL-0001',
            },
          ],
        },
      ],
      'finance/invoices': [],
      'finance/payments': [],
      'finance/reports': [],
      'finance/documents': [],
    }

    const migratedStore = migrateEntityStore(legacyStore)
    const invoice = migratedStore['finance/invoices'][0]
    const deal = migratedStore['crm-sales/deals'][0]

    expect(invoice.values.dealId).toBe('DL-0001')
    expect(invoice.values.counterparty).toBe('CL-0001')
    expect(invoice.status).toBe('issued')
    expect(
      deal.related.some(
        (item) => item.storeKey === 'finance/invoices' && item.recordId === invoice.id,
      ),
    ).toBe(true)
  })

  it('backfills finance report type from title heuristics', () => {
    const reportTypeMigration = entityStoreMigrationSteps.find(
      (step) => step.key === 'finance-report-type-normalization',
    )
    if (!reportTypeMigration) {
      throw new Error('finance-report-type-normalization step is missing')
    }

    const legacyStore: EntityStoreSnapshot = {
      'finance/reports': [
        buildRecord('RPT-0001', 'Cashflow Март', { period: '03.2026', format: 'CSV' }, 'draft'),
        buildRecord('RPT-0002', 'P&L Февраль', { period: '02.2026', format: 'PDF' }, 'draft'),
        buildRecord('RPT-0003', 'AR/AP Январь', { period: '01.2026', format: 'PDF' }, 'draft'),
      ],
    }

    const migratedStore = reportTypeMigration.migrate(legacyStore)
    const [cashflowReport, pnlReport, arapReport] = migratedStore['finance/reports']

    expect(cashflowReport.values.type).toBe('cashflow')
    expect(pnlReport.values.type).toBe('pnl')
    expect(arapReport.values.type).toBe('ar-ap')
  })

  it('synchronizes car statuses after loading persisted entity store snapshots', () => {
    const legacyStore: EntityStoreSnapshot = {
      'crm-sales/cars': [
        buildRecord('CAR-0001', 'Toyota Camry', { vin: 'VIN-001' }, 'active'),
        buildRecord('CAR-0002', 'Hyundai Tucson', { vin: 'VIN-002' }, 'active'),
        buildRecord('CAR-0003', 'Kia Rio', { vin: 'VIN-003' }, 'active'),
        buildRecord('CAR-0004', 'Skoda Octavia', { vin: 'VIN-004' }, 'archived'),
      ],
      'crm-sales/deals': [
        buildRecord('DL-0001', 'Сделка', { vin: 'VIN-001' }, 'closed'),
      ],
      'service/orders': [
        buildRecord('WO-0001', 'Заказ-наряд', { vin: 'CAR-0002' }, 'opened'),
        buildRecord('WO-0002', 'Заказ-наряд', { vin: 'VIN-004' }, 'closed'),
      ],
      'finance/invoices': [],
      'finance/payments': [],
      'finance/reports': [],
      'finance/documents': [],
    }

    const migratedStore = migrateEntityStore(legacyStore)
    const cars = migratedStore['crm-sales/cars']

    expect(cars.find((record) => record.id === 'CAR-0001')?.status).toBe('sold')
    expect(cars.find((record) => record.id === 'CAR-0002')?.status).toBe('in_service')
    expect(cars.find((record) => record.id === 'CAR-0003')?.status).toBe('active')
    expect(cars.find((record) => record.id === 'CAR-0004')?.status).toBe('archived')
  })
})
