# finance-invoicing

Backend microservice skeleton for KIS Nexus.

## Local run

go run ./cmd/api

## Default endpoints

- GET /healthz
- GET /readyz
- GET /invoices
- POST /invoices
- GET /payments
- POST /payments

## Dev seed mode

When `FINANCE_INVOICING_DEV_SEED_ENABLED=true`, the service enables dev-only seeding helpers:

- `POST /invoices` accepts optional `created_at` (RFC3339)
- `POST /invoices` accepts optional `number`
- `POST /dev/reset` clears in-memory finance-invoicing state

This is intended only for local data seeding workflows.
