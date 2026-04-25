# service-parts-usage

Backend microservice skeleton for KIS Nexus.

## Local run

go run ./cmd/api

## Default endpoints

- GET /healthz
- GET /readyz
- GET /workorders/{id}/parts
- POST /workorders/{id}/parts
- GET /workorders/{id}/parts-plan
- PUT /workorders/{id}/parts-plan
- POST /workorders/{id}/writeoff
- GET /stock
- GET /procurement/requests
- GET /events
