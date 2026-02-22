import http from 'k6/http';
import { check, sleep } from 'k6';

const FINANCE_REPORTING_URL = __ENV.FINANCE_REPORTING_URL || 'http://localhost:18086';

export const options = {
  scenarios: {
    reports: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 5 },
        { duration: '1m', target: 25 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
      exec: 'reportsScenario',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
    checks: ['rate>0.99'],
  },
};

export function reportsScenario() {
  const readRes = http.get(`${FINANCE_REPORTING_URL}/reports?type=pnl`);
  check(readRes, {
    'report read: status 200': (r) => r.status === 200,
  });

  const exportRes = http.post(
    `${FINANCE_REPORTING_URL}/reports/export`,
    JSON.stringify({ report: 'pnl', format: 'xlsx' }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(exportRes, {
    'report export: status 201': (r) => r.status === 201,
  });

  sleep(0.2);
}
