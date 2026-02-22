# Integration Tests

The integration suite validates saga flows required by the technical specification:

- Vehicle sale closing saga (`sales-deals`):
- Success path: reserve -> finance -> commit -> closed/won.
- Failure path: inventory failure or finance failure with compensation.

- Workorder closing saga (`service-workorders`):
- Success path: parts consume -> billing -> close.
- Failure path: parts failure or billing failure with compensation.

## Run

```bash
make integration-test
```

This executes tests tagged with `integration` across all service modules.
