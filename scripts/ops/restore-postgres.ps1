param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [string]$PostgresUser = "",
  [string]$PostgresDb = "",
  [switch]$AllDatabases
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $BackupFile)) {
  throw "Backup file not found: $BackupFile"
}

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

$stderrFile = Join-Path (Split-Path $BackupFile -Parent) "restore.stderr.log"
$restoreDb = if ($AllDatabases) { "postgres" } else { $PostgresDb }

$process = Start-Process -FilePath "docker" `
  -ArgumentList @("exec", "-i", $containerId, "psql", "-U", $PostgresUser, "-d", $restoreDb) `
  -RedirectStandardInput $BackupFile `
  -RedirectStandardError $stderrFile `
  -NoNewWindow `
  -Wait `
  -PassThru

if ($process.ExitCode -ne 0) {
  $stderr = if (Test-Path $stderrFile) { Get-Content -Path $stderrFile -Raw } else { "" }
  throw "Restore failed (exit $($process.ExitCode)). $stderr"
}

if (Test-Path $stderrFile) {
  Remove-Item $stderrFile -Force
}

Write-Host "PostgreSQL restore completed from: $BackupFile"
