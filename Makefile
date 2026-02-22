.PHONY: help fmt lint vet test integration-test e2e-test performance-test acceptance-check build check

MODULE_RUNNER := go run ./scripts/dev/run-in-modules.go --

help:
	@echo "Targets: fmt lint vet test integration-test e2e-test performance-test acceptance-check build check"

fmt:
	@$(MODULE_RUNNER) go fmt ./...

lint:
	@$(MODULE_RUNNER) golangci-lint run ./...

vet:
	@$(MODULE_RUNNER) go vet ./...

test:
	@$(MODULE_RUNNER) go test ./...

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
