# E2E and UAT Scenarios

Реализованные E2E/UAT сценарии (п. 8.4 ROADMAP):

- Продажи (`sales-deals`):
- `sales_manager` создаёт сделку для `sales_agent`.
- `sales_agent` видит только свои сделки.
- Чужой `sales_agent` не может менять этап/закрывать сделку.
- Успешное закрытие сделки (`completed`) переводит сделку в `won`.

- Сервис (`service-workorders`):
- `service_manager` создаёт заказ-наряд для `service_advisor`.
- `service_advisor` видит только свои WO.
- Чужой `service_advisor` не может менять статус WO.
- Успешное закрытие WO (`completed`) переводит WO в `closed`.

## Запуск

```bash
make e2e-test
```

Тесты запускаются тегом `e2e`.
