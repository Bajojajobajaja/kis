param(
  [switch]$StopInfra
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$runtimeDir = Join-Path $repoRoot "runtime\services"
$statePath = Join-Path $runtimeDir "pids.json"
$infraDir = Join-Path $repoRoot "infra\docker"

if (-not (Test-Path $statePath)) {
  Write-Host "no pid state file found: $statePath"
}
else {
  $raw = Get-Content -Path $statePath -Raw
  if ([string]::IsNullOrWhiteSpace($raw)) {
    Write-Host "pid state file is empty"
  }
  else {
    $entries = $raw | ConvertFrom-Json
    if ($entries -isnot [array]) {
      $entries = @($entries)
    }

    foreach ($entry in $entries) {
      if (-not $entry.pid) {
        continue
      }

      $proc = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
      if ($null -eq $proc) {
        Write-Host "already stopped: $($entry.service) (pid=$($entry.pid))"
        continue
      }

      Stop-Process -Id $entry.pid -Force
      Write-Host "stopped: $($entry.service) (pid=$($entry.pid))"
    }
  }

  Remove-Item -Path $statePath -Force
}

if ($StopInfra) {
  Push-Location $infraDir
  try {
    docker compose down
  }
  finally {
    Pop-Location
  }
}
