# sales-deals

Backend microservice skeleton for KIS Nexus.

## Local run

go run ./cmd/api

## Default endpoints

- GET /healthz
- GET /readyz
- GET /deals
- POST /deals
- POST /deals/{id}/stages
- POST /deals/{id}/reserve-vehicle
- POST /deals/{id}/close
- GET /audit/trail

RBAC headers for business endpoints:
- `X-Role`: `platform_admin` | `sales_manager` | `sales_agent`
- `X-User-ID`: required for object-level checks (`sales_agent` can modify only own deals)
