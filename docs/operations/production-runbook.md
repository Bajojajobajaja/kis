# Production Runbook

Updated: 2026-02-19

## Incident severity

| Severity | Definition | Initial response target |
| --- | --- | --- |
| P1 | Full outage or critical data corruption risk | 10 minutes |
| P2 | Major feature degradation with workaround | 30 minutes |
| P3 | Limited degradation, low business impact | Same business day |

## First 15 minutes checklist

1. Confirm alert validity (false positive vs real impact).
2. Assign incident commander and communication owner.
3. Assess blast radius (domains, users, geography).
4. Apply immediate mitigation (rollback, traffic shift, scale up).
5. Publish first status update.

## Standard operating procedures

### API error spike

1. Check `KISHigh5xxErrorRate` and `KISVeryHigh5xxErrorRate`.
2. Inspect last deployment in target environment.
3. Roll back deployment if correlation is confirmed.
4. Verify error ratio returns below threshold.

### Latency regression

1. Check `KISHighP95Latency` and infrastructure saturation.
2. Scale workload via HPA/manual replica increase.
3. Inspect slow endpoints and dependent services.
4. Keep incident open until latency stabilizes.

### Database stress

1. Check connection count, locks, and slow queries.
2. Apply throttling and reduce non-critical batch load.
3. If needed, execute failover/run restore plan from backup.

## Communication template

- Incident ID:
- Severity:
- Start time (UTC):
- User impact:
- Current mitigation:
- Next update time:

## Post-incident requirements

- Publish preliminary report within 24 hours.
- Publish full RCA and corrective actions within 5 business days.
- Track action items in backlog until verified in production.

