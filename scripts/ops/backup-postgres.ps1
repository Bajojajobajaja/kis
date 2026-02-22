param(
  [string]$OutputDir = "D:\KIS\backups\postgres",
  [string]$PostgresUser = "",
  [string]$PostgresDb = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($PostgresUser)) {
  $PostgresUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "kis" }
}
if ([string]::IsNullOrWhiteSpace($PostgresDb)) {
  $PostgresDb = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "platform" }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$composeFile = Join-Path $repoRoot "infra\docker\docker-compose.yml"
if (-not (Test-Path $composeFile)) {
  throw "Compose file not found: $composeFile"
}

$containerId = (& docker compose -f $composeFile ps -q postgres).Trim()
if ([string]::IsNullOrWhiteSpace($containerId)) {
  throw "Postgres container is not running. Start infra first: cd infra/docker && docker compose up -d"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = Join-Path $OutputDir "postgres-$PostgresDb-$timestamp.sql"
$stderrFile = Join-Path $OutputDir "postgres-$PostgresDb-$timestamp.stderr.log"

$process = Start-Process -FilePath "docker" `
  -ArgumentList @("exec", $containerId, "pg_dump", "-U", $PostgresUser, "-d", $PostgresDb) `
  -RedirectStandardOutput $backupFile `
  -RedirectStandardError $stderrFile `
  -NoNewWindow `
  -Wait `
  -PassThru

if ($process.ExitCode -ne 0) {
  $stderr = if (Test-Path $stderrFile) { Get-Content -Path $stderrFile -Raw } else { "" }
  throw "Backup failed (exit $($process.ExitCode)). $stderr"
}

if (Test-Path $stderrFile) {
  Remove-Item $stderrFile -Force
}

Write-Host "PostgreSQL backup created: $backupFile"
