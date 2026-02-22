# Roadmap проекта KIS Nexus

Обновлено: 19.02.2026

## 1. Инициация и архитектура
- [x] Сформировать базовый контур архитектуры (микросервисы + SPA + event bus)
- [x] Разложить систему по доменам из ТЗ (CRM/Sales, Service, Inventory, Finance, Platform)
- [x] Утвердить целевой стек инфраструктуры (NATS, PostgreSQL, Redis, ClickHouse, Keycloak, Vault, OTel)
- [x] Зафиксировать ADR по ключевым решениям (см. `docs/adr/0001-target-infrastructure-stack.md`)

## 2. Базовый каркас репозитория
- [x] Создать структуру монорепозитория (`services`, `frontend`, `docs`, `infra`, `pkg`, `tests`)
- [x] Добавить базовые служебные файлы (`README.md`, `go.work`, `.gitignore`, `.editorconfig`, `Makefile`)
- [x] Подготовить шаблоны документации (`docs/architecture`, `docs/api`, `docs/events`, `docs/adr`)
- [x] Подготовить базовый `docker-compose` и заготовки `k8s` overlays/base
- [x] Расширить `docker-compose` до целевого инфраструктурного baseline

## 3. Каркас микросервисов
- [x] Создать каркас platform-сервисов (`api-gateway`, `identity-access`, `audit-log`, `notification`, `reporting-bi`)
- [x] Создать каркас CRM/Sales-сервисов (`crm-contacts`, `crm-leads`, `sales-deals`, `sales-documents`, `pricing`)
- [x] Создать каркас Service-сервисов (`service-appointments`, `service-workorders`, `service-diagnostics`, `service-labor-catalog`, `service-parts-usage`, `service-billing`)
- [x] Создать каркас Inventory-сервисов (`masterdata-catalog`, `inventory-stock`, `inventory-procurement`, `inventory-receiving`, `inventory-audit`)
- [x] Создать каркас Finance-сервисов (`finance-ledger`, `finance-invoicing`, `finance-costing`, `finance-reporting`, `analytics-marts`)
- [x] Для каждого сервиса добавить минимальный шаблон (`go.mod`, `cmd/api/main.go`, `internal/*`, `api/openapi.yaml`, `configs/config.yaml`, `Dockerfile`, `README.md`)

## 4. Технический baseline качества
- [x] Проверить, что шаблонные сервисы компилируются/проходят `go test ./...`
- [x] Добавить линтеры (`golangci-lint`) и единые правила форматирования
- [x] Добавить pre-commit hooks
- [x] Добавить CI pipeline (lint + test + build)

## 5. Frontend (SPA shell)
- [x] Подготовить базовую папку фронтенда `frontend/web` с заготовкой
- [x] Инициализировать SPA (например, React + Vite)
- [x] Реализовать каркас приложения: layout, меню подсистем, auth guard
- [x] Реализовать глобальный поиск (client/phone, VIN, WO, deal/invoice)

## 6. Реализация MVP доменов
- [x] MVP CRM/Sales: лиды, контакты, сделки, документы, резерв авто
- [x] MVP Service: запись, WO, диагностика, списание/резерв запчастей, биллинг
- [x] MVP Inventory: остатки, движения, закупки, приемка, инвентаризация
- [x] MVP Finance: проводки, счета/оплаты, себестоимость, базовые отчеты
- [x] Саги и компенсирующие операции для междоменных процессов

## 7. Сквозные платформенные функции
- [x] RBAC на уровне endpoint + объектных прав
- [x] Аудит критичных действий (до/после)
- [x] Централизованные логи, метрики, трейсинг
- [x] Notification pipeline (email/SMS)
- [x] Backup/restore и управление секретами

## 8. Тестирование и приемка
- [x] Модульные тесты core-логики в каждом сервисе
- [x] Интеграционные тесты саг (продажа авто, закрытие ремонта)
- [x] Нагрузочные тесты (поиск, списания, отчеты)
- [x] E2E сценарии и UAT с бизнес-ролями
- [x] Финальные критерии приемки из ТЗ

## 9. Подготовка к production
- [x] Production-ready Kubernetes манифесты/helm
- [x] CI/CD деплой по окружениям (dev/stage/prod)
- [x] Мониторинг SLA/SLO и алертинг
- [x] План миграции данных и cutover
- [x] Runbook/операционные инструкции для поддержки

## 10. Пост-MVP развитие
- [x] Расширенная BI/витрины near real-time
- [x] Продвинутый pricing/акции/комиссионные
- [x] Интеграции с внешними каналами (сайт/телефония/мессенджеры)
- [x] Оптимизация производительности и стоимости инфраструктуры
