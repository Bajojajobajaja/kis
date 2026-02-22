# Local Infrastructure Stack

This directory contains a local Docker-based baseline of the target platform stack.

## Included components

Core (default):
- NATS JetStream
- PostgreSQL
- Redis
- ClickHouse

Optional profiles:
- edge: Kong API Gateway
- security: Keycloak, Vault
- observability: OTel Collector, Prometheus, Loki, Tempo, Grafana

## Quick start

1. Copy env template:

   cp .env.example .env

2. Start core services:

   docker compose up -d

3. Start all profiles:

   docker compose --profile edge --profile security --profile observability up -d

4. Stop stack:

   docker compose down

## Service database connection

All backend microservices now require PostgreSQL connectivity on startup (startup fails fast if DB is unavailable).

When running services locally (outside Docker), use:

- `DB_HOST=localhost`
- `DB_PORT=5432`
- `DB_USER=kis`
- `DB_PASSWORD=<your value from .env>`
- `DB_SSLMODE=disable`

If a service needs non-default DB name, set `DB_NAME=<database_name>`.
You can also provide full DSN via `DATABASE_URL`.

## Endpoints

- NATS: `localhost:4222`, monitoring `localhost:8222`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`
- ClickHouse: `localhost:8123`
- Kong proxy: `localhost:8000`
- Keycloak: `localhost:8081`
- Vault UI/API: `localhost:8200`
- Prometheus: `localhost:9090`
- Grafana: `localhost:3000`
- Loki: `localhost:3100`
- Tempo: `localhost:3200`

