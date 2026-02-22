param(
  [switch]$SkipInfra,
  [switch]$SkipBuild,
  [switch]$WithEdge,
  [switch]$WithSecurity,
  [switch]$WithObservability
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repoRoot

if (-not $SkipInfra) {
  $infraArgs = @()
  if ($WithEdge) { $infraArgs += "-WithEdge" }
  if ($WithSecurity) { $infraArgs += "-WithSecurity" }
  if ($WithObservability) { $infraArgs += "-WithObservability" }
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot "scripts\infra-up.ps1") @infraArgs
}

if (-not $SkipBuild) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot "scripts\dev\build-services.ps1")
}

$goreman = Get-Command goreman -ErrorAction SilentlyContinue
if ($null -eq $goreman) {
  $fallback = Join-Path $HOME "go\bin\goreman.exe"
  if (-not (Test-Path $fallback)) {
    throw "goreman not found in PATH and not found at $fallback"
  }
  $goremanPath = $fallback
}
else {
  $goremanPath = $goreman.Source
}

& $goremanPath -f (Join-Path $repoRoot "Procfile.dev") check
& $goremanPath -f (Join-Path $repoRoot "Procfile.dev") -set-ports=false -rpc-server=false start
