param(
  [switch]$SkipInfra,
  [switch]$SkipBuild,
  [switch]$WithEdge,
  [switch]$WithSecurity,
  [switch]$WithObservability
)

$ErrorActionPreference = "Stop"

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

function Get-ProcfileServices([string]$ProcfilePath) {
  $services = New-Object System.Collections.Generic.List[string]

  foreach ($line in Get-Content $ProcfilePath) {
    $trimmed = $line.Trim()
    if ($trimmed -eq "" -or $trimmed.StartsWith("#")) {
      continue
    }

    if ($trimmed -match "run-service\.cmd\s+([A-Za-z0-9-]+)\s+\d+") {
      $service = $matches[1]
      if (-not $services.Contains($service)) {
        [void]$services.Add($service)
      }
    }
  }

  return $services.ToArray()
}

function Assert-ServiceBinariesFresh([string]$RepoRoot, [string]$ProcfilePath) {
  $checkScript = Join-Path $RepoRoot "scripts\dev\check-service-binary.ps1"
  if (-not (Test-Path $checkScript -PathType Leaf)) {
    throw "preflight script not found: $checkScript"
  }

  $failures = New-Object System.Collections.Generic.List[object]
  $services = Get-ProcfileServices $ProcfilePath

  foreach ($service in $services) {
    $raw = & powershell -NoProfile -ExecutionPolicy Bypass -File $checkScript -Service $service -RepoRoot $RepoRoot -AsJson -Quiet
    $exitCode = $LASTEXITCODE
    $parsed = $null

    if ($raw) {
      try {
        $parsed = $raw | ConvertFrom-Json
      }
      catch {
        $parsed = [pscustomobject]@{
          service = $service
          status = "error"
          message = ($raw -join [Environment]::NewLine)
        }
      }
    } else {
      $parsed = [pscustomobject]@{
        service = $service
        status = "error"
        message = "binary freshness check produced no output"
      }
    }

    if ($exitCode -ne 0) {
      [void]$failures.Add($parsed)
    }
  }

  if ($failures.Count -eq 0) {
    return
  }

  $details = $failures | ForEach-Object {
    $message = $_.message
    if ([string]::IsNullOrWhiteSpace($message)) {
      $message = "binary preflight failed"
    }
    " - $($_.service): $message"
  }

  throw @(
    "SkipBuild refused to start services with stale or missing binaries.",
    "Affected services:",
    ($details -join [Environment]::NewLine),
    "Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/build-services.ps1"
  ) -join [Environment]::NewLine
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repoRoot
$procfilePath = Join-Path $repoRoot "Procfile.dev"

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
else {
  Assert-ServiceBinariesFresh -RepoRoot $repoRoot -ProcfilePath $procfilePath
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

& $goremanPath -f $procfilePath check
& $goremanPath -f $procfilePath -set-ports=false -rpc-server=false start
