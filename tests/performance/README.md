# Performance Tests

Нагрузочные сценарии по ТЗ (п. 8.3):

- `search.js`: поиск/чтение клиентских и операционных сущностей (`/clients`, `/deals`, `/workorders`)
- `writeoffs.js`: списания/резервы (`/stock/reserve`, `/workorders/{id}/parts`)
- `reports.js`: чтение и экспорт отчётов (`/reports`, `/reports/export`)

Во всех сценариях заданы пороги:

- `p(95) < 2000ms`
- `http_req_failed < 1%`
- `checks > 99%`

## Запуск

1. Поднимите нужные сервисы и передайте URL через env-переменные.
2. Установите `k6`.
3. Запустите:

```powershell
./scripts/testing/run-k6.ps1 -Scenario all
```

Или по отдельности:

```powershell
k6 run tests/performance/k6/search.js
k6 run tests/performance/k6/writeoffs.js
k6 run tests/performance/k6/reports.js
```
