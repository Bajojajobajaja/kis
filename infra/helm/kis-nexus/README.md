# KIS Nexus Helm Chart

## Render

```bash
helm template kis-nexus infra/helm/kis-nexus
```

## Install

```bash
helm upgrade --install kis-nexus infra/helm/kis-nexus --namespace kis-nexus --create-namespace
```

## Environment-specific values

Use `-f` files per environment, for example:

```bash
helm upgrade --install kis-nexus infra/helm/kis-nexus -f values-prod.yaml
```

