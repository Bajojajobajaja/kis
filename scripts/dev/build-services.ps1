param(
  [switch]$OnlyMissing
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$servicesDir = Join-Path $repoRoot "services"
$binDir = Join-Path $repoRoot "bin"

New-Item -ItemType Directory -Force -Path $binDir | Out-Null

$serviceDirs = Get-ChildItem -Path $servicesDir -Directory | Sort-Object Name
$built = @()
$skipped = @()

foreach ($svc in $serviceDirs) {
  $serviceName = $svc.Name
  $servicePath = $svc.FullName
  $mainPath = Join-Path $servicePath "cmd\api\main.go"
  if (-not (Test-Path $mainPath)) {
    continue
  }

  $outputPath = Join-Path $binDir ($serviceName + ".exe")
  if ($OnlyMissing -and (Test-Path $outputPath)) {
    $skipped += $serviceName
    continue
  }

  $tmpDir = Join-Path $servicePath ".tmp"
  $goCacheDir = Join-Path $tmpDir "go-cache"
  New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
  New-Item -ItemType Directory -Force -Path $goCacheDir | Out-Null

  $env:GOTELEMETRY = "off"
  $env:TMP = $tmpDir
  $env:TEMP = $tmpDir
  $env:GOTMPDIR = $tmpDir
  $env:GOCACHE = $goCacheDir

  Push-Location $servicePath
  try {
    go build -o $outputPath ./cmd/api
    if ($LASTEXITCODE -ne 0) {
      throw "failed to build $serviceName"
    }
  }
  finally {
    Pop-Location
  }

  $built += $serviceName
  Write-Host "built: $serviceName -> $outputPath"
}

Write-Host ""
Write-Host "build summary:"
Write-Host "built: $($built.Count)"
if ($built.Count -gt 0) {
  Write-Host ($built -join ", ")
}

if ($skipped.Count -gt 0) {
  Write-Host "skipped (already exists): $($skipped.Count)"
  Write-Host ($skipped -join ", ")
}
