# Kubernetes Base

Production baseline manifests shared by all environments.

## What is included

- Namespace and global labels.
- Platform-level config map (`platform-settings`).
- Namespace guardrails (limit range, resource quota, default deny ingress policy).
- API Gateway workload (`Deployment`, `Service`, `HPA`, `PDB`, `Ingress`).

## Render and apply

```bash
kubectl kustomize infra/k8s/base
kubectl apply -k infra/k8s/base
```
