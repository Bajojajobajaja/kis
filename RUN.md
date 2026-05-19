# Локальный запуск КИС

Инструкция по запуску всей системы локально: 25 микросервисов в Docker + Vite-фронтенд.

## Требования

- Docker Desktop (Compose v2)
- Node.js 20+ и npm
- Свободные порты: `5432`, `4222`, `6379`, `8123`, `9000`, `5173`, `19080–19105`

---

## 1. Первый запуск

Выполняется один раз — собирает образы микросервисов (займёт 5–15 минут) и устанавливает зависимости фронта.

### 1.1. Подготовить `.env` для инфраструктуры

```powershell
cd E:\kis-repo\infra\docker
Copy-Item .env.example .env
```

Откройте `.env` и замените `CHANGE_ME_STRONG_PASSWORD` на собственные пароли. Минимум — `POSTGRES_PASSWORD`. Этот же пароль будет использоваться сервисами (они читают `DB_PASSWORD` из этого `.env`).

### 1.2. Собрать и поднять весь стек

```powershell
cd E:\kis-repo\infra\docker
docker compose up -d --build
```

Будут собраны и запущены:

- Инфраструктура: `postgres` (healthcheck), `nats`, `redis`, `clickhouse`
- 25 микросервисов (порты `19080–19105`)

Postgres инициализируется скриптами из `infra/docker/postgres/init` — миграции БД сервисы накатывают сами при старте.

Проверка:

```powershell
docker compose ps
curl http://localhost:19081/healthz   # api-gateway → 200
```

### 1.3. Установить зависимости фронта и запустить dev-сервер

```powershell
cd E:\kis-repo\frontend\web
npm install
npm run dev
```

Фронт будет на **http://localhost:5173**. Vite проксирует запросы к сервисам через `/gateway` (api-gateway:19081) и `/svc/<имя>` (см. `frontend/web/vite.config.ts`).

---

## 2. Повторный запуск (после первого)

### 2.1. Стек микросервисов

```powershell
cd E:\kis-repo\infra\docker
docker compose up -d
```

Образы уже собраны — запуск занимает 10–30 секунд. Данные Postgres/Redis/ClickHouse сохраняются в Docker-волюмах (`postgres_data`, `redis_data`, `clickhouse_data`, `nats_data`).

### 2.2. Фронтенд

```powershell
cd E:\kis-repo\frontend\web
npm run dev
```

---

## 3. Опциональные профили

По умолчанию запускается ядро (БД + сервисы). Дополнительные слои поднимаются через `--profile`:

```powershell
# Edge: Kong API Gateway
docker compose --profile edge up -d

# Security: Keycloak + Vault
docker compose --profile security up -d

# Observability: OTel Collector + Prometheus + Loki + Tempo + Grafana
docker compose --profile observability up -d

# Всё сразу
docker compose --profile edge --profile security --profile observability up -d
```

Эндпоинты:

| Сервис      | URL                       |
|-------------|---------------------------|
| Grafana     | http://localhost:3000     |
| Prometheus  | http://localhost:9090     |
| Loki        | http://localhost:3100     |
| Tempo       | http://localhost:3200     |
| Keycloak    | http://localhost:8081     |
| Vault       | http://localhost:8200     |
| Kong proxy  | http://localhost:8000     |

---

## 4. Порты микросервисов

Все сервисы слушают `localhost:<port>`, эндпоинт здоровья — `/healthz`.

| Порт   | Сервис                  |
|--------|-------------------------|
| 19080  | analytics-marts         |
| 19081  | api-gateway             |
| 19082  | audit-log               |
| 19083  | crm-contacts            |
| 19084  | crm-leads               |
| 19085  | finance-costing         |
| 19086  | finance-invoicing       |
| 19087  | finance-ledger          |
| 19088  | finance-reporting       |
| 19089  | identity-access         |
| 19090  | inventory-audit         |
| 19091  | inventory-procurement   |
| 19092  | inventory-receiving     |
| 19093  | inventory-stock         |
| 19094  | masterdata-catalog      |
| 19095  | notification            |
| 19096  | pricing                 |
| 19097  | reporting-bi            |
| 19098  | sales-deals             |
| 19099  | sales-documents         |
| 19100  | service-appointments    |
| 19101  | service-billing         |
| 19102  | service-diagnostics     |
| 19103  | service-labor-catalog   |
| 19104  | service-parts-usage     |
| 19105  | service-workorders      |

---

## 5. Полезные команды

```powershell
# Логи конкретного сервиса
docker compose logs -f api-gateway

# Перезапуск одного сервиса
docker compose restart service-workorders

# Пересобрать один сервис после правок кода
docker compose up -d --build service-workorders

# Подключиться к Postgres
docker compose exec postgres psql -U kis -d platform

# Остановить весь стек (данные сохраняются)
docker compose down

# Полная очистка вместе с данными
docker compose down -v
```

---

## 6. Типичные проблемы

- **Сервис рестартится** — проверьте `docker compose logs <имя>`. Чаще всего: Postgres ещё не успел стартовать (compose ждёт healthcheck, но при пересборке `.env` могут разъезжаться пароли).
- **`DB_PASSWORD` не совпадает** — пароль в `infra/docker/.env` должен совпадать у `POSTGRES_PASSWORD` и `DB_PASSWORD`. После смены — `docker compose down -v && docker compose up -d --build`.
- **Порт занят** — посмотрите занявшего: `netstat -ano | findstr :5173` (или нужный порт), завершите процесс или поменяйте port-mapping в `docker-compose.yml`.
- **Фронт не достучался до сервиса** — проверьте, что сервис в `docker compose ps` имеет статус `Up` и отвечает на `curl http://localhost:<port>/healthz`.
