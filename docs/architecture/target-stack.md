# Target Infrastructure Stack

## Scope
This document fixes the baseline infrastructure stack for KIS Nexus MVP and the first production iteration.

## Platform
- Kubernetes: managed cluster, HA control plane
- API edge: Kong Gateway (north-south), ingress-nginx in Kubernetes
- CI/CD: GitHub Actions + Argo CD (GitOps)
- Infrastructure as Code: Terraform + Helm

## Data and Messaging
- Event bus: NATS JetStream
- Transactional storage: PostgreSQL (database-per-service)
- Cache and distributed locks: Redis
- Analytical storage: ClickHouse (`analytics-marts` contour)

## Security
- IAM/SSO: Keycloak (OIDC)
- Secrets: HashiCorp Vault + External Secrets Operator (for k8s)
- Transport security: TLS with cert-manager
- Network policy: Cilium

## Observability
- Traces/metrics/log telemetry: OpenTelemetry Collector
- Metrics: Prometheus + Alertmanager
- Logs: Loki
- Traces: Tempo
- Dashboards: Grafana

## Local development profile
`infra/docker` provides a Docker-based local stack with profiles:
- core: NATS, PostgreSQL, Redis, ClickHouse
- edge: Kong
- security: Keycloak, Vault
- observability: OTel, Prometheus, Loki, Tempo, Grafana