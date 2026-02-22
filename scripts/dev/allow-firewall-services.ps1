param(
  [int]$BasePort = 19080,
  [switch]$PrivateOnly
)

$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "run as Administrator: powershell -File scripts/dev/allow-firewall-services.ps1"
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$servicesDir = Join-Path $repoRoot "services"
$binDir = Join-Path $repoRoot "bin"

$profile = if ($PrivateOnly) { "Private" } else { "Any" }
$serviceDirs = Get-ChildItem -Path $servicesDir -Directory | Sort-Object Name
$created = @()
$exists = @()
$missingBin = @()
$index = 0

foreach ($svc in $serviceDirs) {
  $serviceName = $svc.Name
  $mainPath = Join-Path $svc.FullName "cmd\api\main.go"
  if (-not (Test-Path $mainPath)) {
    continue
  }

  $port = $BasePort + $index
  $index++
  $exePath = Join-Path $binDir ($serviceName + ".exe")
  if (-not (Test-Path $exePath)) {
    $missingBin += $serviceName
    continue
  }

  $ruleName = "KIS-DEV-" + $serviceName
  $rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  if ($rule) {
    $exists += $serviceName
    continue
  }

  New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Action Allow `
    -Program $exePath `
    -Protocol TCP `
    -LocalPort $port `
    -Profile $profile | Out-Null

  $created += $serviceName
}

Write-Host "firewall summary:"
Write-Host "created rules: $($created.Count)"
if ($created.Count -gt 0) {
  Write-Host ($created -join ", ")
}

Write-Host "already exists: $($exists.Count)"
if ($exists.Count -gt 0) {
  Write-Host ($exists -join ", ")
}

if ($missingBin.Count -gt 0) {
  Write-Host "missing binaries: $($missingBin.Count)"
  Write-Host ($missingBin -join ", ")
  Write-Host "build first: powershell -File scripts/dev/build-services.ps1"
}
