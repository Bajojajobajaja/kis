.PHONY: help fmt lint vet test db-test coverage-check integration-test e2e-test performance-test acceptance-check build check

MODULE_RUNNER := go run ./scripts/dev/run-in-modules.go --
HTTP_COVERAGE_CHECKER := go run ./scripts/testing/check-http-coverage.go --threshold 55 --tags db

help:
	@echo "Targets: fmt lint vet test db-test coverage-check integration-test e2e-test performance-test acceptance-check build check"

fmt:
	@$(MODULE_RUNNER) go fmt ./...

lint:
	@$(MODULE_RUNNER) golangci-lint run ./...

vet:
	@$(MODULE_RUNNER) go vet ./...

test:
	@$(MODULE_RUNNER) go test ./...

db-test:
	@$(MODULE_RUNNER) go test -tags db ./internal/transport/http

coverage-check:
	@$(HTTP_COVERAGE_CHECKER)

integration-test:
	@$(MODULE_RUNNER) go test -tags integration ./...

e2e-test:
	@$(MODULE_RUNNER) go test -tags e2e ./...

performance-test:
	@powershell -ExecutionPolicy Bypass -File ./scripts/testing/run-k6.ps1 -Scenario all

acceptance-check:
	@powershell -ExecutionPolicy Bypass -File ./scripts/testing/run-acceptance.ps1

build:
	@$(MODULE_RUNNER) go build ./...

check: fmt lint test
