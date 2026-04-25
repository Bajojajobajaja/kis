import { afterEach, describe, expect, it, vi } from 'vitest'

import { reconcileInventoryStockRecords, upsertInventoryStockValues } from './inventoryStockService'

describe('inventoryStockService', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('retries transient idempotency conflicts for stock sync', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'idempotency conflict' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      upsertInventoryStockValues(
        {
          sku: 'PART-BATTERY-60',
          available: '5',
          reserved: '1',
          min: '2',
          warehouse: 'main',
        },
        'STK-2101',
      ),
    ).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not overwrite inventory-stock when the service already has the sku', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            sku: 'PART-BATTERY-60',
            location: 'main',
            on_hand: 9,
            reserved: 2,
            min_qty: 2,
            max_qty: 0,
            reorder_point: 2,
          },
        ]),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      reconcileInventoryStockRecords([
        {
          id: 'STK-3101',
          title: 'Battery',
          subtitle: 'Main warehouse',
          status: 'normal',
          values: {
            sku: 'PART-BATTERY-60',
            available: '5',
            reserved: '1',
            min: '2',
            warehouse: 'main',
          },
          history: [],
          related: [],
        },
      ]),
    ).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/svc/inventory-stock/stock?sku=PART-BATTERY-60',
      expect.objectContaining({
        method: 'GET',
      }),
    )
  })

  it('creates missing inventory-stock positions during reconcile', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      reconcileInventoryStockRecords([
        {
          id: 'STK-2102',
          title: 'Battery',
          subtitle: 'Main warehouse',
          status: 'normal',
          values: {
            sku: 'PART-BATTERY-60',
            available: '5',
            reserved: '1',
            min: '2',
            warehouse: 'main',
          },
          history: [],
          related: [],
        },
      ]),
    ).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/svc/inventory-stock/stock?sku=PART-BATTERY-60',
      expect.objectContaining({
        method: 'GET',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/svc/inventory-stock/stock',
      expect.objectContaining({
        method: 'POST',
      }),
    )
  })
})
