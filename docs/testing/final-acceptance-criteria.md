# Final Acceptance Criteria (MVP)

Updated: 2026-02-19

## Acceptance Scope

This document finalizes acceptance criteria from `techicaldocumentation.md` section "Тестирование и приёмка":

- core logic unit tests
- saga integration tests (vehicle sale and workorder close)
- load tests (search, write-offs, reports)
- E2E + UAT role scenarios
- reporting and audit evidence in end-to-end flows

## Criteria Matrix

| ID | Criterion from TZ | Evidence | Execution command | Current status |
| --- | --- | --- | --- | --- |
| AC-01 | Unit tests for core logic, statuses, transitions | `services/*/internal/transport/http/handlers_test.go`, `services/*/internal/transport/http/persistence_runtime_helpers_test.go`, `services/*/internal/transport/http/persistence_runtime_db_test.go` | `make test && make db-test && make coverage-check` | Passed |
| AC-02 | Integration tests for sales close saga with compensation | `services/sales-deals/internal/transport/http/saga_integration_test.go` | `make integration-test` | Passed |
| AC-03 | Integration tests for workorder close saga with compensation | `services/service-workorders/internal/transport/http/saga_integration_test.go` | `make integration-test` | Passed |
| AC-04 | Load tests for search, write-offs, reports with 2s target | `tests/performance/k6/search.js`, `tests/performance/k6/writeoffs.js`, `tests/performance/k6/reports.js` | `make performance-test` | Ready (scripts and thresholds) |
| AC-05 | E2E and UAT with business roles | `services/sales-deals/internal/transport/http/e2e_uat_test.go`, `services/service-workorders/internal/transport/http/e2e_uat_test.go`, `tests/e2e/README.md` | `make e2e-test` | Passed |
| AC-06 | End-to-end scenarios include report and audit aspects | `services/finance-reporting/internal/transport/http/handlers_test.go`, `services/audit-log/internal/transport/http/handlers_test.go`, saga/e2e tests with `/audit/trail` checks | `make test && make integration-test && make e2e-test` | Passed |

## Consolidated Acceptance Run

Use a single command to execute the acceptance suite:

```powershell
./scripts/testing/run-acceptance.ps1
```

The script runs unit, integration, and e2e test stages, then attempts performance tests if `k6` is available.
