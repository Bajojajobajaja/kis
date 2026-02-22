# Post-MVP Development Plan

Updated: 2026-02-19

## Goal

Define the next evolution wave after MVP stabilization.

## Stream 1: BI and near real-time marts

- Build domain marts in ClickHouse for Sales, Service, Inventory, Finance.
- Introduce event-driven ingestion with end-to-end freshness target <= 5 minutes.
- Add business dashboards for margin, conversion, service throughput, stock turns.

## Stream 2: Advanced pricing, promotions, commissions

- Move pricing logic to rules and campaign engine.
- Add discount governance by role, channel, and product group.
- Introduce commission calculation with transparent audit trail.

## Stream 3: External channel integrations

- Add integrations for website leads, telephony, and messaging providers.
- Provide standardized inbound/outbound adapters with retries and idempotency.
- Track channel attribution through deal and workorder lifecycle.

## Stream 4: Performance and cost optimization

- Define service-level capacity baselines and scaling targets.
- Add workload right-sizing and storage lifecycle policies.
- Introduce monthly FinOps review (cost per domain and per transaction).

## Delivery phasing

| Phase | Focus | Exit criteria |
| --- | --- | --- |
| Phase A | BI + telemetry hardening | Near real-time marts and data freshness SLA in stage |
| Phase B | Pricing/promotions/commissions | Campaign and commission rules enabled for pilot units |
| Phase C | External channels | Stable production integrations and attribution analytics |
| Phase D | Performance/cost | Documented savings and sustained SLO compliance |

