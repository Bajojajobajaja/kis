# service-workorders

Backend microservice skeleton for KIS Nexus.

## Local run

go run ./cmd/api

## Default endpoints

- GET /healthz
- GET /readyz
- GET /workorders
- POST /workorders
- GET /workorders/{id}
- PUT /workorders/{id}
- POST /workorders/{id}/status
- POST /workorders/{id}/close
- POST /workorders/{id}/quality
- GET /audit/trail
- GET /notifications/outbox
- GET /kpi/service

RBAC headers for business endpoints:
- `X-Role`: `platform_admin` | `service_manager` | `service_advisor`
- `X-User-ID`: required for object-level checks (`service_advisor` can modify only own workorders)
