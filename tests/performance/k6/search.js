import http from 'k6/http';
import { check, sleep } from 'k6';

const CRM_CONTACTS_URL = __ENV.CRM_CONTACTS_URL || 'http://localhost:18081';
const SALES_DEALS_URL = __ENV.SALES_DEALS_URL || 'http://localhost:18082';
const SERVICE_WORKORDERS_URL = __ENV.SERVICE_WORKORDERS_URL || 'http://localhost:18083';

const SALES_HEADERS = {
  headers: {
    'X-Role': 'sales_manager',
    'X-User-ID': 'perf-sales-manager',
  },
};

const WORKORDER_HEADERS = {
  headers: {
    'X-Role': 'service_manager',
    'X-User-ID': 'perf-service-manager',
  },
};

export const options = {
  scenarios: {
    search: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 30 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
      exec: 'searchScenario',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  const seedClient = {
    name: 'Perf Search Client',
    phone: '+10000000001',
    email: 'perf.search@example.com',
  };
  http.post(`${CRM_CONTACTS_URL}/clients`, JSON.stringify(seedClient), {
    headers: { 'Content-Type': 'application/json' },
  });

  const seedDeal = {
    client_id: 'perf-client',
    owner_id: 'perf-sales-manager',
    vehicle_vin: 'VIN-PERF-SEARCH',
    amount: 100000,
  };
  http.post(`${SALES_DEALS_URL}/deals`, JSON.stringify(seedDeal), {
    headers: {
      ...SALES_HEADERS.headers,
      'Content-Type': 'application/json',
    },
  });

  const seedWorkorder = {
    client_id: 'perf-client',
    owner_id: 'perf-service-manager',
    vehicle_vin: 'VIN-PERF-SEARCH',
  };
  http.post(`${SERVICE_WORKORDERS_URL}/workorders`, JSON.stringify(seedWorkorder), {
    headers: {
      ...WORKORDER_HEADERS.headers,
      'Content-Type': 'application/json',
    },
  });
}

export function searchScenario() {
  const clientRes = http.get(`${CRM_CONTACTS_URL}/clients`);
  check(clientRes, {
    'clients search: status 200': (r) => r.status === 200,
  });

  const dealsRes = http.get(`${SALES_DEALS_URL}/deals`, SALES_HEADERS);
  check(dealsRes, {
    'deals search: status 200': (r) => r.status === 200,
  });

  const workordersRes = http.get(`${SERVICE_WORKORDERS_URL}/workorders`, WORKORDER_HEADERS);
  check(workordersRes, {
    'workorders search: status 200': (r) => r.status === 200,
  });

  sleep(0.2);
}
