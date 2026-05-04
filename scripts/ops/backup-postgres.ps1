param(
  [string]$OutputDir = "",
  [string]$PostgresUser = "",
  [string]$PostgresDb = "",
  [switch]$AllDatabases
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($PostgresUser)) {
  $PostgresUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "kis" }
}
if (-not $AllDatabases -and [string]::IsNullOrWhiteSpace($PostgresDb)) {
  $PostgresDb = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "platform" }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$composeFile = Join-Path $repoRoot "infra\docker\docker-compose.yml"
if (-not (Test-Path $composeFile)) {
  throw "Compose file not found: $composeFile"
}

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $OutputDir = Join-Path $repoRoot "infra\docker\postgres\backups"
}

$dockerExitCode = 0
try {
  $containerOutput = & docker compose -f $composeFile ps -q postgres 2>&1
  $dockerExitCode = $LASTEXITCODE
} catch {
  throw "Unable to query Docker Compose for postgres container. Ensure Docker Desktop is running. Details: $($_.Exception.Message)"
}

if ($dockerExitCode -ne 0) {
  throw "Unable to query Docker Compose for postgres container. Ensure Docker Desktop is running. Details: $($containerOutput | Out-String)"
}

$containerId = ($containerOutput | Out-String).Trim()
if ([string]::IsNullOrWhiteSpace($containerId)) {
  throw "Postgres container is not running. Start infra first: cd infra/docker && docker compose up -d"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupTarget = if ($AllDatabases) { "cluster" } else { $PostgresDb }
$backupFile = Join-Path $OutputDir "postgres-$backupTarget-$timestamp.sql"
$stderrFile = Join-Path $OutputDir "postgres-$backupTarget-$timestamp.stderr.log"

$dumpArgs = if ($AllDatabases) {
  @("exec", $containerId, "pg_dumpall", "-U", $PostgresUser)
} else {
  @("exec", $containerId, "pg_dump", "-U", $PostgresUser, "-d", $PostgresDb)
}

$process = Start-Process -FilePath "docker" `
  -ArgumentList $dumpArgs `
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
