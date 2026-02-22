import http from 'k6/http';
import { check, sleep } from 'k6';

const INVENTORY_STOCK_URL = __ENV.INVENTORY_STOCK_URL || 'http://localhost:18084';
const SERVICE_WORKORDERS_URL = __ENV.SERVICE_WORKORDERS_URL || 'http://localhost:18083';
const SERVICE_PARTS_USAGE_URL = __ENV.SERVICE_PARTS_USAGE_URL || 'http://localhost:18085';

const WORKORDER_HEADERS = {
  headers: {
    'X-Role': 'service_manager',
    'X-User-ID': 'perf-service-manager',
  },
};

export const options = {
  scenarios: {
    writeoffs: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 5 },
        { duration: '1m', target: 20 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
      exec: 'writeoffScenario',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  const seedSKU = `perf-sku-${Date.now()}`;
  const stockRes = http.post(
    `${INVENTORY_STOCK_URL}/stock`,
    JSON.stringify({ sku: seedSKU, location: 'main', quantity: 50000 }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(stockRes, {
    'seed stock created': (r) => r.status === 201,
  });

  const workorderRes = http.post(
    `${SERVICE_WORKORDERS_URL}/workorders`,
    JSON.stringify({
      client_id: 'perf-client',
      owner_id: 'perf-service-manager',
      vehicle_vin: `VIN-PERF-${Date.now()}`,
    }),
    {
      headers: {
        ...WORKORDER_HEADERS.headers,
        'Content-Type': 'application/json',
      },
    }
  );

  check(workorderRes, {
    'seed workorder created': (r) => r.status === 201,
  });

  const workorder = workorderRes.json();
  return {
    sku: seedSKU,
    workorderID: workorder.id,
  };
}

export function writeoffScenario(data) {
  const reserveRes = http.post(
    `${INVENTORY_STOCK_URL}/stock/reserve`,
    JSON.stringify({ sku: data.sku, quantity: 1 }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(reserveRes, {
    'stock reserve: status 200': (r) => r.status === 200,
  });

  const consumeRes = http.post(
    `${SERVICE_PARTS_USAGE_URL}/workorders/${data.workorderID}/parts`,
    JSON.stringify({ part_code: data.sku, quantity: 1, action: 'consume' }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(consumeRes, {
    'parts consume: status 201': (r) => r.status === 201,
  });

  sleep(0.2);
}
