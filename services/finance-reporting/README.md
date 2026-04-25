# finance-reporting

Backend microservice skeleton for KIS Nexus.

## Local run

go run ./cmd/api

## Default endpoints

- GET /healthz
- GET /readyz
- GET /reports
- POST /reports/export

## Dev seed mode

When `FINANCE_REPORTING_DEV_SEED_ENABLED=true`, the service enables:

- `POST /dev/reset` resets in-memory finance-reporting state (exports/schedules/events and default metrics)
