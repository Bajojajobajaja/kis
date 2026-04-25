import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EntityRecord } from './model'
import {
  applyWorkorderPartDraftLinePreview,
  buildInventoryStockProjection,
  buildServiceWorkorderUpsertRequest,
  buildServiceWorkorderSyncPayload,
  closeServiceWorkorder,
  ensureServiceWorkorder,
  normalizeWorkorderPartDraftLines,
  prepareWorkorderPartPlanLines,
  resolveServiceWorkorderClosePreparation,
  resolveWorkorderPartTitle,
  saveWorkorderPartsPlan,
  updateServiceWorkorderStatus,
  upsertServiceWorkorder,
  type WorkorderPartDraftLine,
} from './serviceWorkorderParts'

function buildRecord(
  id: string,
  values: Record<string, string>,
  overrides: Partial<EntityRecord> = {},
): EntityRecord {
  return {
    id,
    title: id,
    subtitle: id,
    status: 'opened',
    values,
    history: [],
    related: [],
    ...overrides,
  }
}

describe('serviceWorkorderParts', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('collapses duplicate draft lines by sku and sums quantity', () => {
    const lines: WorkorderPartDraftLine[] = [
      {
        key: '1',
        sku: 'part-filter',
        title: 'Filter',
        quantity: '2',
        availableQuantity: 0,
        missingQuantity: 0,
        state: 'draft',
        procurementRequestId: '',
      },
      {
        key: '2',
        sku: 'PART-FILTER',
        title: '',
        quantity: '3',
        availableQuantity: 0,
        missingQuantity: 0,
        state: 'draft',
        procurementRequestId: '',
      },
      {
        key: '3',
        sku: '',
        title: 'Skip',
        quantity: '1',
        availableQuantity: 0,
        missingQuantity: 0,
        state: 'draft',
        procurementRequestId: '',
      },
    ]

    expect(normalizeWorkorderPartDraftLines(lines)).toEqual([
      {
        sku: 'PART-FILTER',
        title: 'Filter',
        quantity: 5,
      },
    ])
  })

  it('classifies workorder status before close flow', () => {
    expect(resolveServiceWorkorderClosePreparation('closed')).toBe('already_closed')
    expect(resolveServiceWorkorderClosePreparation('ready')).toBe('close_directly')
    expect(resolveServiceWorkorderClosePreparation('released')).toBe('close_directly')
    expect(resolveServiceWorkorderClosePreparation('opened')).toBe('prepare_before_close')
    expect(resolveServiceWorkorderClosePreparation('accepted')).toBe('prepare_before_close')
    expect(resolveServiceWorkorderClosePreparation('compensated')).toBe('prepare_before_close')
    expect(resolveServiceWorkorderClosePreparation('close_failed')).toBe('blocked')
  })

  it('builds workorder sync payload with resolved VIN and client fields', () => {
    const workorder = buildRecord('WO-10031', {
      vin: 'CAR-1001',
      client: 'CL-1001',
      master: 'USR-4004',
      eta: '2026-03-15',
    })
    const cars = [
      buildRecord('CAR-1001', {
        vin: 'XW7BF4FK30S123456',
      }),
    ]

    expect(buildServiceWorkorderSyncPayload(workorder, cars)).toEqual({
      id: 'WO-10031',
      client_id: 'CL-1001',
      client_name: '',
      vehicle_vin: 'XW7BF4FK30S123456',
      assignee: 'USR-4004',
      deadline: '2026-03-15T12:00:00Z',
      status: 'opened',
    })
  })

  it('builds workorder upsert request body without duplicating id in JSON', () => {
    expect(
      buildServiceWorkorderUpsertRequest({
        id: 'WO-10031',
        client_id: 'CL-1001',
        client_name: 'Test Client',
        vehicle_vin: 'XW7BF4FK30S123456',
        assignee: 'USR-4004',
        deadline: '2026-03-15T12:00:00Z',
        status: 'opened',
      }),
    ).toEqual({
      client_id: 'CL-1001',
      client_name: 'Test Client',
      vehicle_vin: 'XW7BF4FK30S123456',
      assignee: 'USR-4004',
      deadline: '2026-03-15T12:00:00Z',
      status: 'opened',
    })
  })

  it('reuses the same in-flight workorder upsert request for duplicate calls', async () => {
    let resolveFetch: ((value: Response) => void) | null = null
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const payload = {
      id: 'WO-10032',
      client_id: 'CL-1001',
      client_name: 'Test Client',
      vehicle_vin: 'XW7BF4FK30S123456',
      assignee: 'USR-4004',
      deadline: '2026-03-15T12:00:00Z',
      status: 'opened',
    }

    const first = upsertServiceWorkorder(payload)
    const second = upsertServiceWorkorder(payload)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    if (!resolveFetch) {
      throw new Error('expected duplicate upsert request to stay in flight')
    }
    const resolveInFlight = resolveFetch as (value: Response) => void
    resolveInFlight(
      new Response(JSON.stringify({ id: payload.id }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(Promise.all([first, second])).resolves.toBeDefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries transient idempotency conflicts for workorder upsert', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'idempotency conflict' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'WO-10034' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      upsertServiceWorkorder({
        id: 'WO-10034',
        client_id: 'CL-1001',
        client_name: 'Test Client',
        vehicle_vin: 'XW7BF4FK30S123456',
        assignee: 'USR-4004',
        deadline: '2026-03-15T12:00:00Z',
        status: 'opened',
      }),
    ).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reuses existing backend workorder without sending an upsert', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'WO-10034', status: 'in_progress' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      ensureServiceWorkorder({
        id: 'WO-10034',
        client_id: 'CL-1001',
        client_name: 'Test Client',
        vehicle_vin: 'XW7BF4FK30S123456',
        assignee: 'USR-4004',
        deadline: '2026-03-15T12:00:00Z',
        status: 'opened',
      }),
    ).resolves.toEqual({
      id: 'WO-10034',
      status: 'in_progress',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/svc/service-workorders/workorders/WO-10034',
      expect.objectContaining({
        method: 'GET',
      }),
    )
  })

  it('creates backend workorder only when it is missing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'workorder not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'WO-10034' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'WO-10034', status: 'opened' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      ensureServiceWorkorder({
        id: 'WO-10034',
        client_id: 'CL-1001',
        client_name: 'Test Client',
        vehicle_vin: 'XW7BF4FK30S123456',
        assignee: 'USR-4004',
        deadline: '2026-03-15T12:00:00Z',
        status: 'opened',
      }),
    ).resolves.toEqual({
      id: 'WO-10034',
      status: 'opened',
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('updates workorder status through service-workorders API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'WO-10034', status: 'ready' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(updateServiceWorkorderStatus('WO-10034', 'ready')).resolves.toEqual({
      id: 'WO-10034',
      status: 'ready',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/svc/service-workorders/workorders/WO-10034/status',
      expect.objectContaining({
        method: 'POST',
      }),
    )
  })

  it('closes workorder through close saga with retry on idempotency conflict', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'idempotency conflict' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            saga: 'workorder-close',
            result: 'completed',
            steps: [],
            workorder: { id: 'WO-10034', status: 'closed' },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(closeServiceWorkorder('WO-10034')).resolves.toEqual({
      saga: 'workorder-close',
      result: 'completed',
      steps: [],
      workorder: { id: 'WO-10034', status: 'closed' },
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('resolves part titles and builds stock projection payload', () => {
    const stockRecords = [
      buildRecord(
        'STK-2101',
        {
          sku: 'PART-FILTER',
          available: '58',
          reserved: '6',
          min: '20',
          warehouse: 'main',
        },
        {
          title: 'Oil filter',
          subtitle: 'Main warehouse',
          status: 'normal',
        },
      ),
    ]

    expect(resolveWorkorderPartTitle('part-filter', stockRecords)).toBe('Oil filter')

    expect(
      buildInventoryStockProjection(
        {
          id: 'st-0001',
          sku: 'PART-FILTER',
          location: 'main',
          on_hand: 12,
          reserved: 2,
          min_qty: 4,
          reorder_point: 6,
        },
        stockRecords[0],
      ),
    ).toEqual({
      title: 'Oil filter',
      subtitle: 'Main warehouse',
      values: {
        sku: 'PART-FILTER',
        available: '10',
        reserved: '2',
        min: '4',
        warehouse: 'main',
      },
      status: 'normal',
    })
  })

  it('requires an exact stock sku and suggests the canonical value', () => {
    const stockRecords = [
      buildRecord(
        'STK-2115',
        {
          sku: 'PART-BATTERY-60',
          available: '5',
          reserved: '1',
          min: '2',
          warehouse: 'Основной',
        },
        {
          title: 'Аккумулятор 60Ah',
        },
      ),
    ]

    expect(() =>
      prepareWorkorderPartPlanLines(
        [
          {
            key: '1',
            sku: 'SKUPART-BATTERY-60',
            title: 'Аккумулятор 60Ah',
            quantity: '1',
            availableQuantity: 0,
            missingQuantity: 0,
            state: 'draft',
            procurementRequestId: '',
          },
        ],
        stockRecords,
      ),
    ).toThrow('SKU "SKUPART-BATTERY-60" не найден на складе. Используйте "PART-BATTERY-60".')

    expect(
      prepareWorkorderPartPlanLines(
        [
          {
            key: '2',
            sku: 'part-battery-60',
            title: 'Произвольный заголовок',
            quantity: '1',
            availableQuantity: 0,
            missingQuantity: 0,
            state: 'draft',
            procurementRequestId: '',
          },
        ],
        stockRecords,
      ),
    ).toEqual([
      {
        sku: 'PART-BATTERY-60',
        title: 'Аккумулятор 60Ah',
        quantity: 1,
      },
    ])
  })

  it('normalizes stale sku values to the canonical stock sku and computes availability preview', () => {
    const stockRecords = [
      buildRecord(
        'STK-2115',
        {
          sku: 'PART-BATTERY-60',
          available: '5',
          reserved: '1',
          min: '4',
          warehouse: 'Основной',
        },
        {
          title: 'Аккумулятор 60Ah',
        },
      ),
    ]

    expect(
      applyWorkorderPartDraftLinePreview(
        {
          key: '1',
          sku: 'SKUPART-BATTERY-60',
          title: 'Аккумулятор 60Ah',
          quantity: '1',
          availableQuantity: 0,
          missingQuantity: 0,
          state: 'draft',
          procurementRequestId: '',
        },
        stockRecords,
      ),
    ).toEqual({
      key: '1',
      sku: 'PART-BATTERY-60',
      title: 'Аккумулятор 60Ah',
      quantity: '1',
      availableQuantity: 5,
      missingQuantity: 0,
      state: 'draft',
      procurementRequestId: '',
    })
  })

  it('reuses the same in-flight parts-plan save request for duplicate calls', async () => {
    let resolveFetch: ((value: Response) => void) | null = null
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const first = saveWorkorderPartsPlan('WO-10033', [
      { sku: 'PART-BATTERY-60', title: 'Battery', quantity: 1 },
    ])
    const second = saveWorkorderPartsPlan('WO-10033', [
      { sku: 'PART-BATTERY-60', title: 'Battery', quantity: 1 },
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    if (!resolveFetch) {
      throw new Error('expected duplicate parts-plan save request to stay in flight')
    }
    const resolveInFlight = resolveFetch as (value: Response) => void
    resolveInFlight(
      new Response(JSON.stringify({ workorder_id: 'WO-10033', lines: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(Promise.all([first, second])).resolves.toEqual([
      { workorder_id: 'WO-10033', lines: [] },
      { workorder_id: 'WO-10033', lines: [] },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries transient idempotency conflicts for parts-plan save', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'idempotency conflict' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ workorder_id: 'WO-10035', lines: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      saveWorkorderPartsPlan('WO-10035', [
        { sku: 'PART-BATTERY-60', title: 'Battery', quantity: 1 },
      ]),
    ).resolves.toEqual({
      workorder_id: 'WO-10035',
      lines: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
