# CI/CD Deployments (Dev/Stage/Prod)

Updated: 2026-05-04

## Workflow

- File: `.github/workflows/cd.yml`
- Push to `main/master`: validate manifests only.
- Manual run (`workflow_dispatch`): deploy selected environment (`dev`, `stage`, `prod`).

## Prerequisites

- Configure GitHub Environments: `dev`, `stage`, `prod`.
- Add base64 kubeconfig secrets:
- `KUBE_CONFIG_DEV`
- `KUBE_CONFIG_STAGE`
- `KUBE_CONFIG_PROD`

## Deployment model

- Manifests are rendered from `infra/k8s/overlays/<environment>`.
- `dev`, `stage`, and `prod` overlays carry environment-specific replicas, quota, and ingress hostnames.
- Production deployment should be protected by environment approval rules.
