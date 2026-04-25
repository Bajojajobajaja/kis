# KIS Nexus Monorepo

Monorepo skeleton for KIS Nexus microservices platform.

## Domains
- CRM & Sales
- Service & Repair
- Inventory & Procurement
- Finance & Reporting
- Shared platform services

## Stack
- Backend: Go microservices
- Frontend: SPA shell (`frontend/web`)
- Communication: REST/gRPC + event bus
- Deployment: Docker + Kubernetes manifests
- Infra baseline: NATS JetStream, PostgreSQL, Redis, ClickHouse, Keycloak, Vault, OTel/Prometheus/Loki/Tempo/Grafana

## Repository layout
- `services/` - backend microservices
- `frontend/` - SPA entry point
- `docs/` - architecture, APIs, events, ADR
- `infra/` - docker and k8s manifests
- `pkg/` - shared packages
- `tests/` - integration/e2e/performance test suites

## Local infrastructure
- Core stack:
`cd infra/docker && docker compose up -d`
- Full stack (edge + security + observability):
`cd infra/docker && docker compose --profile edge --profile security --profile observability up -d`

## Run all backend services (dev)
- Start infra (Postgres/Redis), ensure per-service databases, then run all Go APIs:
`powershell -File scripts/dev/start-all-services.ps1`
- Stop all started Go APIs:
`powershell -File scripts/dev/stop-all-services.ps1`
- Stop APIs and Docker infra:
`powershell -File scripts/dev/stop-all-services.ps1 -StopInfra`

## Run all services with goreman
- Install once:
`go install github.com/mattn/goreman@latest`
- Build all service binaries (`bin/*.exe`):
`powershell -File scripts/dev/build-services.ps1`
- (Optional, one-time as Administrator) add firewall rules for all service ports:
`powershell -File scripts/dev/allow-firewall-services.ps1 -PrivateOnly`
- Start infra + build + all services from one console:
`powershell -File scripts/dev/start-goreman.ps1`
- If infra is already running:
`powershell -File scripts/dev/start-goreman.ps1 -SkipInfra`
- If binaries are already built:
`powershell -File scripts/dev/start-goreman.ps1 -SkipBuild`
- Stop all services:
`Ctrl+C` in goreman console.
- Note: goreman RPC is disabled by default (`-rpc-server=false`) to avoid Windows Firewall popup.

## Durable CRUD persistence (Postgres)
- All services wrap HTTP mutating requests (`POST/PUT/PATCH/DELETE`) with a Postgres-backed persistence middleware.
- The middleware uses direct Postgres wire protocol (no `docker compose exec` in request path).
- On startup each service replays `kis_http_journal` to restore in-memory state.
- Per-service tables (inside each service DB):
`kis_schema_migrations`, `kis_service_state`, `kis_http_idempotency`, `kis_http_journal`,
`kis_entities`, `kis_outbox`, `kis_inbox`, `kis_saga_instances`, `kis_saga_steps`, `kis_entity_links`.
- Idempotency is enabled for write requests via `Idempotency-Key` header (auto-fallback to request hash if header is missing).
- Outbox dispatch is available for cross-service delivery (`OUTBOX_DISPATCH_ENABLED`, `OUTBOX_TARGETS`).
- Strict mode returns `503` on persistence failure.
- Feature flags:
`PERSISTENCE_ENABLED=true|false` (default `true`),
`PERSISTENCE_STRICT=true|false` (default `true`).

## Local quality checks
- Format all Go modules:
`go run ./scripts/dev/run-in-modules.go -- go fmt ./...`
- Lint all Go modules (`golangci-lint`):
`go run ./scripts/dev/run-in-modules.go -- golangci-lint run ./...`
- Test all Go modules:
`go run ./scripts/dev/run-in-modules.go -- go test ./...`
- Run DB-tagged persistence tests (requires PostgreSQL):
`go run ./scripts/dev/run-in-modules.go -- go test -tags db ./internal/transport/http`
- Check per-service HTTP package coverage threshold (default `55%`):
`go run ./scripts/testing/check-http-coverage.go --threshold 55 --tags db`
- Run integration suite (saga flows):
`go run ./scripts/dev/run-in-modules.go -- go test -tags integration ./...`
- Run E2E/UAT suite:
`go run ./scripts/dev/run-in-modules.go -- go test -tags e2e ./...`
- Build all Go modules:
`go run ./scripts/dev/run-in-modules.go -- go build ./...`

Install git hooks:
`powershell -File scripts/install-git-hooks.ps1`

See:
- `docs/architecture/target-stack.md`
- `docs/architecture/subsystems-functional-roadmap.md`
- `docs/adr/0001-target-infrastructure-stack.md`
- `docs/operations/local-development-step-by-step-ru.md`
- `docs/operations/backup-restore-and-secrets.md`
- `docs/operations/sla-slo-and-alerting.md`
- `docs/operations/data-migration-and-cutover.md`
- `docs/operations/production-runbook.md`
- `docs/operations/cicd-deployments.md`
- `docs/architecture/post-mvp-development-plan.md`
- `docs/testing/final-acceptance-criteria.md`
- `infra/k8s/base/README.md`
- `infra/helm/kis-nexus/README.md`
