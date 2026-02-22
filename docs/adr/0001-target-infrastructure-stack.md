# ADR 0001: Target Infrastructure Stack

- Status: Accepted
- Date: 2026-02-19

## Context
KIS Nexus requires a microservice platform with:
- asynchronous inter-service communication,
- strict domain boundaries with service-owned storage,
- centralized authentication/authorization,
- full observability and auditability,
- operational simplicity for MVP and predictable scaling path.

## Decision
Adopt the following stack:
- NATS JetStream as event bus.
- PostgreSQL as transactional storage (`database-per-service`).
- Redis for cache/locks.
- ClickHouse for analytical marts.
- Keycloak for IAM/SSO.
- HashiCorp Vault for secret management.
- Kong as API Gateway.
- OpenTelemetry + Prometheus + Loki + Tempo + Grafana for observability.
- Kubernetes for runtime, Terraform + Helm for provisioning/deployment.
- GitHub Actions + Argo CD for CI/CD and GitOps delivery.

## Consequences
Positive:
- Low-latency event-driven integration with simpler ops compared to Kafka for MVP.
- Strong ecosystem and compatibility with Go microservices.
- Clear path from local Docker stack to production Kubernetes.

Trade-offs:
- More components than minimal monolith infrastructure.
- Requires platform runbooks (backup, secrets rotation, observability ownership).

## Rollout notes
- Use `infra/docker` as local baseline.
- Promote configuration to `infra/k8s` as services mature.
- Revisit message bus decision if throughput/retention constraints exceed JetStream profile.