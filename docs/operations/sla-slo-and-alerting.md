# SLA/SLO And Alerting

Updated: 2026-02-19

## SLA targets (external)

- API availability: `99.5%` monthly.
- P95 API latency: `<= 750ms` for read operations, `<= 1.5s` for write operations.
- Incident response:
- `P1`: acknowledge within 10 minutes.
- `P2`: acknowledge within 30 minutes.

## SLOs and SLIs (internal)

| SLO ID | SLI | Target | Window | Error budget |
| --- | --- | --- | --- | --- |
| SLO-API-AVAIL-01 | Successful requests / all requests (`5xx` counted as failed) | 99.5% | 30d rolling | 0.5% |
| SLO-API-LAT-01 | `histogram_quantile(0.95)` for request duration | <= 750ms | 30d rolling | N/A |
| SLO-API-ERR-01 | 5xx error ratio | < 2% (warning), < 5% (critical) | 5m | N/A |

## Alerting policy

- Prometheus rules are defined in `infra/docker/prometheus/alerts-kis-nexus.yml`.
- Alert severity routing:
- `warning`: on-call engineer + team chat.
- `critical`: on-call engineer + incident commander + phone escalation.
- Fast burn-rate alert is used to protect monthly availability error budget.

## Error-budget policy

- If monthly burn reaches 50%, feature releases must include reliability fixes.
- If monthly burn reaches 100%, new feature rollouts are frozen until corrective actions are delivered.
- Every budget breach triggers a post-incident reliability review.

## Dashboards

- Availability and error ratio by service.
- P95/P99 latency by endpoint and operation type.
- Resource saturation (CPU, memory, pod restarts) for critical workloads.

