import { describe, expect, it } from 'vitest'

import { resolveEntityFieldOptions } from './fieldOptions'
import type { EntityCreateField, EntityRecord } from './model'

const carSelectField: EntityCreateField = {
  key: 'vin',
  label: 'VIN',
  placeholder: 'WBAKS610X0X334455',
  optionsSource: {
    type: 'store',
    storeKey: 'crm-sales/cars',
    valueKey: 'id',
    labelKey: 'vin',
  },
}

const salesManagerField: EntityCreateField = {
  key: 'manager',
  label: 'Менеджер',
  placeholder: 'USR-4001',
  optionsSource: {
    type: 'store',
    storeKey: 'platform/users',
    valueKey: 'id',
    labelKey: 'title',
  },
}

const serviceMasterField: EntityCreateField = {
  key: 'master',
  label: 'Мастер',
  placeholder: 'USR-4004',
  optionsSource: {
    type: 'store',
    storeKey: 'platform/users',
    valueKey: 'id',
    labelKey: 'title',
  },
}

const serviceEventOwnerField: EntityCreateField = {
  key: 'owner',
  label: 'Ответственный',
  placeholder: 'USR-4004',
  optionsSource: {
    type: 'store',
    storeKey: 'platform/users',
    valueKey: 'id',
    labelKey: 'title',
  },
}

const financeInvoiceField: EntityCreateField = {
  key: 'invoice',
  label: 'Счет',
  placeholder: 'INV-0001',
  optionsSource: {
    type: 'store',
    storeKey: 'finance/invoices',
    valueKey: 'id',
    labelKey: 'title',
  },
}

const cars: EntityRecord[] = [
  {
    id: 'CAR-1001',
    title: 'BMW X5 2020',
    subtitle: '',
    status: 'active',
    values: {
      vin: 'WBAKS610X0X334455',
      year: '2020',
    },
    history: [],
    related: [],
  },
  {
    id: 'CAR-1002',
    title: 'Toyota Camry 2021',
    subtitle: '',
    status: 'active',
    values: {
      vin: 'VIN-TOYOTA-001',
      year: '2021',
    },
    history: [],
    related: [],
  },
]

const deals: EntityRecord[] = [
  {
    id: 'DL-1001',
    title: 'Deal',
    subtitle: '',
    status: 'new',
    values: {
      vin: 'CAR-1002',
    },
    history: [],
    related: [],
  },
]

const users: EntityRecord[] = [
  {
    id: 'USR-4001',
    title: 'Иванов И.И.',
    subtitle: '',
    status: 'active',
    values: {
      businessRoleId: 'RLB-SALES',
      department: 'Продажи',
    },
    history: [],
    related: [],
  },
  {
    id: 'USR-4002',
    title: 'Петров П.П.',
    subtitle: '',
    status: 'active',
    values: {
      businessRoleId: 'RLB-MECHANIC',
      department: 'Сервис и склад',
    },
    history: [],
    related: [],
  },
  {
    id: 'USR-4003',
    title: 'Сидоров С.С.',
    subtitle: '',
    status: 'active',
    values: {
      businessRoleId: 'RLB-MECHANIC',
      department: 'Сервис и склад',
    },
    history: [],
    related: [],
  },
  {
    id: 'USR-4004',
    title: 'Смирнов С.С.',
    subtitle: '',
    status: 'disabled',
    values: {
      businessRoleId: 'RLB-MECHANIC',
      department: 'Сервис и склад',
    },
    history: [],
    related: [],
  },
]

const invoices: EntityRecord[] = [
  {
    id: 'INV-1001',
    title: 'Outgoing invoice 1001',
    subtitle: '',
    status: 'issued',
    values: {
      dealId: 'DL-1001',
    },
    history: [],
    related: [],
  },
  {
    id: 'INV-1002',
    title: 'Outgoing invoice 1002',
    subtitle: '',
    status: 'issued',
    values: {
      dealId: 'DL-9999',
    },
    history: [],
    related: [],
  },
  {
    id: 'INV-1003',
    title: 'Outgoing invoice 1003',
    subtitle: '',
    status: 'paid',
    values: {
      dealId: 'DL-1001',
    },
    history: [],
    related: [],
  },
]

const getRecords = (storeKey: string): EntityRecord[] => {
  if (storeKey === 'crm-sales/cars') {
    return cars
  }
  if (storeKey === 'crm-sales/deals') {
    return deals
  }
  if (storeKey === 'platform/users') {
    return users
  }
  if (storeKey === 'finance/invoices') {
    return invoices
  }
  return []
}

describe('fieldOptions', () => {
  it('formats car labels for service workorder creation', () => {
    const options = resolveEntityFieldOptions({
      storeKey: 'service/orders',
      field: carSelectField,
      getRecords,
    })

    expect(options).toEqual(
      expect.arrayContaining([
        {
          value: 'CAR-1001',
          label: 'BMW X5 2020 (2020) — WBAKS610X0X334455',
        },
      ]),
    )
  })

  it('keeps formatted labels for deals while filtering occupied cars', () => {
    const options = resolveEntityFieldOptions({
      storeKey: 'crm-sales/deals',
      field: carSelectField,
      getRecords,
    })

    expect(options).toEqual([
      {
        value: 'CAR-1001',
        label: 'BMW X5 2020 (2020) — WBAKS610X0X334455',
      },
    ])
  })

  it('shows only active sales managers in crm selectors', () => {
    const options = resolveEntityFieldOptions({
      storeKey: 'crm-sales/deals',
      field: salesManagerField,
      getRecords,
    })

    expect(options).toEqual([
      {
        value: 'USR-4001',
        label: 'Иванов И.И.',
      },
    ])
  })

  it('shows only active service masters in service selectors', () => {
    const workorderOptions = resolveEntityFieldOptions({
      storeKey: 'service/orders',
      field: serviceMasterField,
      getRecords,
    })

    const eventOptions = resolveEntityFieldOptions({
      storeKey: 'service/events',
      field: serviceEventOwnerField,
      getRecords,
    })

    const expectedOptions = [
      {
        value: 'USR-4002',
        label: 'Петров П.П.',
      },
      {
        value: 'USR-4003',
        label: 'Сидоров С.С.',
      },
    ]

    expect(workorderOptions).toEqual(expectedOptions)
    expect(eventOptions).toEqual(expectedOptions)
  })

  it('filters finance invoice options by payment context while keeping the selected invoice', () => {
    const contextualOptions = resolveEntityFieldOptions({
      storeKey: 'finance/payments',
      field: financeInvoiceField,
      getRecords,
      formValues: {
        dealId: 'DL-1001',
      },
    })

    const editOptions = resolveEntityFieldOptions({
      storeKey: 'finance/payments',
      field: financeInvoiceField,
      getRecords,
      currentValue: 'INV-1003',
      formValues: {
        dealId: 'DL-1001',
      },
    })

    expect(contextualOptions).toEqual([
      {
        value: 'INV-1001',
        label: 'Outgoing invoice 1001',
      },
    ])
    expect(editOptions).toEqual([
      {
        value: 'INV-1001',
        label: 'Outgoing invoice 1001',
      },
      {
        value: 'INV-1003',
        label: 'Outgoing invoice 1003',
      },
    ])
  })
})
