param(
  [Parameter(Mandatory = $true)]
  [string]$Service,
  [string]$RepoRoot,
  [switch]$Quiet,
  [switch]$AsJson
)

$ErrorActionPreference = "Stop"

function Format-RepoPath([string]$Root, [string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) {
    return ""
  }

  $normalizedRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd("\")
  $normalizedPath = [System.IO.Path]::GetFullPath($Path)

  if ($normalizedPath.StartsWith($normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    $relative = $normalizedPath.Substring($normalizedRoot.Length).TrimStart("\")
    if (-not [string]::IsNullOrWhiteSpace($relative)) {
      return $relative
    }
  }

  return $normalizedPath
}

function Write-Result([hashtable]$Result) {
  if ($AsJson) {
    Write-Output ($Result | ConvertTo-Json -Compress)
    return
  }

  if (-not $Quiet) {
    Write-Output $Result.Message
  }
}

try {
  $serviceName = $Service.Trim()
  if ([string]::IsNullOrWhiteSpace($serviceName)) {
    throw "service name is required"
  }

  if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
  } else {
    $RepoRoot = (Resolve-Path $RepoRoot).Path
  }

  $serviceDir = Join-Path $RepoRoot ("services\" + $serviceName)
  $binaryPath = Join-Path $RepoRoot ("bin\" + $serviceName + ".exe")

  $result = @{
    service = $serviceName
    status = "ok"
    binary_path = $binaryPath
    binary_mtime_utc = $null
    latest_source_path = $null
    latest_source_mtime_utc = $null
    message = ""
  }

  if (-not (Test-Path $serviceDir -PathType Container)) {
    $result.status = "error"
    $result.message = "service directory not found: $(Format-RepoPath $RepoRoot $serviceDir)"
    Write-Result $result
    exit 1
  }

  if (-not (Test-Path $binaryPath -PathType Leaf)) {
    $result.status = "missing"
    $result.message = "binary is missing: $(Format-RepoPath $RepoRoot $binaryPath). Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/build-services.ps1"
    Write-Result $result
    exit 1
  }

  $sourceFiles = New-Object System.Collections.Generic.List[System.IO.FileInfo]
  $sourceRoots = @(
    (Join-Path $serviceDir "cmd"),
    (Join-Path $serviceDir "internal"),
    (Join-Path $serviceDir "pkg")
  )

  foreach ($root in $sourceRoots) {
    if (-not (Test-Path $root -PathType Container)) {
      continue
    }

    Get-ChildItem -Path $root -File -Recurse |
      Where-Object {
        $_.Extension -eq ".go" -and
        $_.BaseName -notlike "*_test" -and
        $_.FullName -notlike "*\.tmp\*"
      } |
      ForEach-Object { [void]$sourceFiles.Add($_) }
  }

  foreach ($rootFile in @("go.mod", "go.sum")) {
    $candidate = Join-Path $serviceDir $rootFile
    if (Test-Path $candidate -PathType Leaf) {
      [void]$sourceFiles.Add((Get-Item $candidate))
    }
  }

  foreach ($workspaceFile in @("go.work", "go.work.sum")) {
    $candidate = Join-Path $RepoRoot $workspaceFile
    if (Test-Path $candidate -PathType Leaf) {
      [void]$sourceFiles.Add((Get-Item $candidate))
    }
  }

  if ($sourceFiles.Count -eq 0) {
    $result.status = "error"
    $result.message = "no Go build inputs found for service: $(Format-RepoPath $RepoRoot $serviceDir)"
    Write-Result $result
    exit 1
  }

  $binaryItem = Get-Item $binaryPath
  $latestSource = $sourceFiles | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1

  $result.binary_mtime_utc = $binaryItem.LastWriteTimeUtc.ToString("o")
  $result.latest_source_path = Format-RepoPath $RepoRoot $latestSource.FullName
  $result.latest_source_mtime_utc = $latestSource.LastWriteTimeUtc.ToString("o")

  if ($binaryItem.LastWriteTimeUtc -lt $latestSource.LastWriteTimeUtc) {
    $result.status = "stale"
    $result.message = "binary is stale: $(Format-RepoPath $RepoRoot $binaryPath) ($($binaryItem.LastWriteTimeUtc.ToString("o"))) is older than $($result.latest_source_path) ($($latestSource.LastWriteTimeUtc.ToString("o"))). Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/build-services.ps1"
    Write-Result $result
    exit 1
  }

  $result.message = "binary is fresh: $(Format-RepoPath $RepoRoot $binaryPath)"
  Write-Result $result
  exit 0
}
catch {
  $failure = @{
    service = $Service
    status = "error"
    binary_path = ""
    binary_mtime_utc = $null
    latest_source_path = $null
    latest_source_mtime_utc = $null
    message = $_.Exception.Message
  }
  Write-Result $failure
  exit 1
}
