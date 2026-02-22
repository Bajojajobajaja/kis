param(
  [switch]$WithEdge,
  [switch]$WithSecurity,
  [switch]$WithObservability,
  [switch]$SkipInfra,
  [switch]$SkipDbEnsure,
  [int]$BasePort = 19080
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

function Ensure-DbExists {
  param(
    [string]$InfraDir,
    [string]$DbUser,
    [string]$DbName
  )

  Push-Location $InfraDir
  try {
    $exists = docker compose exec -T postgres psql -U $DbUser -d platform -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName';"
    if ($LASTEXITCODE -ne 0) {
      throw "failed to check database $DbName"
    }

    if ($exists.Trim() -ne "1") {
      docker compose exec -T postgres psql -U $DbUser -d platform -c "CREATE DATABASE $DbName;"
      if ($LASTEXITCODE -ne 0) {
        throw "failed to create database $DbName"
      }
      Write-Host "created database: $DbName"
    }
  }
  finally {
    Pop-Location
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$infraDir = Join-Path $repoRoot "infra\docker"
$servicesDir = Join-Path $repoRoot "services"
$runtimeDir = Join-Path $repoRoot "runtime\services"

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

$envPath = Join-Path $infraDir ".env"
$envExamplePath = Join-Path $infraDir ".env.example"
if (-not (Test-Path $envPath)) {
  if (-not (Test-Path $envExamplePath)) {
    throw "missing env template: $envExamplePath"
  }
  Copy-Item -Path $envExamplePath -Destination $envPath
  Write-Host "created $envPath from template"
}

$dbUser = Get-DotEnvValue -Path $envPath -Key "POSTGRES_USER" -Fallback "kis"
$dbPassword = Get-DotEnvValue -Path $envPath -Key "POSTGRES_PASSWORD" -Fallback "kis_local_password"

if (-not $SkipInfra) {
  $composeArgs = @("compose")
  if ($WithEdge) { $composeArgs += @("--profile", "edge") }
  if ($WithSecurity) { $composeArgs += @("--profile", "security") }
  if ($WithObservability) { $composeArgs += @("--profile", "observability") }
  $composeArgs += @("up", "-d", "postgres", "redis")

  Push-Location $infraDir
  try {
    docker @composeArgs
    if ($LASTEXITCODE -ne 0) {
      throw "failed to start infra"
    }
  }
  finally {
    Pop-Location
  }
}

$serviceDirs = Get-ChildItem -Path $servicesDir -Directory | Sort-Object Name
$started = @()
$failed = @()
$index = 0

foreach ($svc in $serviceDirs) {
  $serviceName = $svc.Name
  $servicePath = $svc.FullName
  $mainPath = Join-Path $servicePath "cmd\api\main.go"
  if (-not (Test-Path $mainPath)) {
    continue
  }

  $dbName = $serviceName -replace "-", "_"
  $port = $BasePort + $index
  $index++

  if (-not $SkipDbEnsure) {
    Ensure-DbExists -InfraDir $infraDir -DbUser $dbUser -DbName $dbName
  }

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
  $env:SERVER_PORT = [string]$port
  $env:GOTELEMETRY = "off"
  $env:TMP = $tmpDir
  $env:TEMP = $tmpDir
  $env:GOTMPDIR = $tmpDir
  $env:GOCACHE = $goCache

  $stdoutPath = Join-Path $runtimeDir ($serviceName + ".out.log")
  $stderrPath = Join-Path $runtimeDir ($serviceName + ".err.log")
  if (Test-Path $stdoutPath) { Remove-Item -Path $stdoutPath -Force }
  if (Test-Path $stderrPath) { Remove-Item -Path $stderrPath -Force }

  $proc = Start-Process -FilePath "go" -ArgumentList @("run", "./cmd/api") -WorkingDirectory $servicePath -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru

  Start-Sleep -Milliseconds 200
  if ($proc.HasExited) {
    $errorText = ""
    if (Test-Path $stderrPath) {
      $errorText = (Get-Content -Path $stderrPath | Select-Object -First 5) -join " | "
    }

    $failed += [PSCustomObject]@{
      service = $serviceName
      port = $port
      db = $dbName
      error = $errorText
    }
    continue
  }

  $started += [PSCustomObject]@{
    service = $serviceName
    pid = $proc.Id
    port = $port
    db = $dbName
    url = "http://localhost:$port"
    stdout = $stdoutPath
    stderr = $stderrPath
  }
}

$statePath = Join-Path $runtimeDir "pids.json"
$started | ConvertTo-Json | Set-Content -Path $statePath -Encoding Ascii

Write-Host ""
Write-Host "started services:"
$started | Format-Table service, pid, port, db, url -AutoSize
Write-Host ""
Write-Host "pid state file: $statePath"

if ($failed.Count -gt 0) {
  Write-Host ""
  Write-Host "failed services:"
  $failed | Format-Table service, port, db, error -AutoSize
  exit 1
}
