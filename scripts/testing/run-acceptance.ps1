$ErrorActionPreference = 'Stop'

Write-Host 'Running unit tests...'
go run ./scripts/dev/run-in-modules.go -- go test ./...

Write-Host 'Running integration tests...'
go run ./scripts/dev/run-in-modules.go -- go test -tags integration ./...

Write-Host 'Running e2e tests...'
go run ./scripts/dev/run-in-modules.go -- go test -tags e2e ./...

if (Get-Command k6 -ErrorAction SilentlyContinue) {
    Write-Host 'Running performance tests...'
    powershell -ExecutionPolicy Bypass -File ./scripts/testing/run-k6.ps1 -Scenario all
} else {
    Write-Warning 'k6 is not installed; skipping performance tests. Install k6 and run scripts/testing/run-k6.ps1.'
}

Write-Host 'Acceptance run completed.'
