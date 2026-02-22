# Data Migration And Cutover Plan

Updated: 2026-02-19

## Scope

This plan covers migration from legacy systems to KIS Nexus for:

- customer and vehicle master data;
- open sales deals and service workorders;
- balances and financial opening entries.

## Migration strategy

- Approach: phased migration with rehearsal.
- Data movement model:
- full snapshot for reference data;
- incremental delta loads for operational entities;
- final freeze window for last-delta and cutover.

## Timeline template

- `T-14 days`: dry-run #1 in stage with production-like data volume.
- `T-7 days`: dry-run #2 and reconciliation sign-off.
- `T-2 days`: final backup and rollback checkpoint.
- `T-0`: freeze legacy writes, run final delta, switch traffic to KIS Nexus.
- `T+1 day`: business validation and close cutover.

## Cutover checklist

- Freeze confirmed for all source systems.
- Full backup completed and validated.
- Final migration delta executed.
- Reconciliation checks passed:
- row counts by entity;
- financial control totals;
- sample-based semantic validation.
- DNS/API gateway routing switched to KIS Nexus.
- Smoke tests passed for CRM, Service, Inventory, Finance.

## Rollback criteria

Rollback is required if any condition is true:

- P1 outage longer than 30 minutes during cutover window;
- reconciliation mismatch exceeds agreed tolerance;
- critical business flow is unavailable after go-live smoke test.

## Rollback procedure

- Restore previous routing/DNS.
- Re-enable writes in legacy systems.
- Restore latest verified backup if needed.
- Publish incident status and revised migration date.

