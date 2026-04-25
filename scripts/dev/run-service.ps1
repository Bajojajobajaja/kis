param(
  [Parameter(Mandatory = $true)]
  [string]$Service,
  [Parameter(Mandatory = $true)]
  [int]$Port
)

$ErrorActionPreference = "Stop"

function Get-DotEnvValue {
  param(
    [string]$Path,
    [string]$Key,
    [string]$Fallback = ""
  )

  if (-not (Test-Path $Path)) {
    return $Fallback
  }

  $pattern = "^\s*" + [regex]::Escape($Key) + "\s*="
  $line = Get-Content -Path $Path | Where-Object { $_ -match $pattern } | Select-Object -First 1
  if (-not $line) {
    return $Fallback
  }

  $value = ($line -split "=", 2)[1].Trim()
  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
    if ($value.Length -ge 2) {
      $value = $value.Substring(1, $value.Length - 2)
    }
  }
  return $value
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$servicePath = Join-Path $repoRoot ("services\" + $Service)
$mainPath = Join-Path $servicePath "cmd\api\main.go"
if (-not (Test-Path $mainPath)) {
  throw "service entrypoint not found: $mainPath"
}

$envPath = Join-Path $repoRoot "infra\docker\.env"
$envExamplePath = Join-Path $repoRoot "infra\docker\.env.example"
if (-not (Test-Path $envPath)) {
  if (-not (Test-Path $envExamplePath)) {
    throw "missing env template: $envExamplePath"
  }
  Copy-Item -Path $envExamplePath -Destination $envPath
}

$dbUser = Get-DotEnvValue -Path $envPath -Key "POSTGRES_USER" -Fallback "kis"
$dbPassword = Get-DotEnvValue -Path $envPath -Key "POSTGRES_PASSWORD" -Fallback "kis_local_password"
$dbName = $Service -replace "-", "_"

$tmpDir = Join-Path $servicePath ".tmp"
$goCache = Join-Path $tmpDir "go-cache"
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
New-Item -ItemType Directory -Force -Path $goCache | Out-Null

$env:DB_HOST = "localhost"
$env:DB_PORT = "5432"
$env:DB_USER = $dbUser
$env:DB_PASSWORD = $dbPassword
$env:DB_NAME = $dbName
$env:DB_SSLMODE = "disable"
$env:DB_PING_TIMEOUT = "5s"
$env:KIS_DOCKER_DIR = Join-Path $repoRoot "infra\docker"
$env:KIS_DOCKER_COMPOSE_FILE = Join-Path $env:KIS_DOCKER_DIR "docker-compose.yml"
$env:SERVER_PORT = [string]$Port
if ($Service -eq "finance-invoicing") {
  $env:FINANCE_INVOICING_DEV_SEED_ENABLED = "true"
} else {
  Remove-Item Env:FINANCE_INVOICING_DEV_SEED_ENABLED -ErrorAction SilentlyContinue
}
if ($Service -eq "finance-reporting") {
  $env:FINANCE_REPORTING_DEV_SEED_ENABLED = "true"
} else {
  Remove-Item Env:FINANCE_REPORTING_DEV_SEED_ENABLED -ErrorAction SilentlyContinue
}
$env:GOTELEMETRY = "off"
$env:TMP = $tmpDir
$env:TEMP = $tmpDir
$env:GOTMPDIR = $tmpDir
$env:GOCACHE = $goCache

Push-Location $servicePath
try {
  go run ./cmd/api
}
finally {
  Pop-Location
}
