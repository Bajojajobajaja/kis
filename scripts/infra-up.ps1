param(
  [switch]$WithEdge,
  [switch]$WithSecurity,
  [switch]$WithObservability
)

$ErrorActionPreference = "Stop"
$composeArgs = @("compose")

if ($WithEdge) { $composeArgs += @("--profile", "edge") }
if ($WithSecurity) { $composeArgs += @("--profile", "security") }
if ($WithObservability) { $composeArgs += @("--profile", "observability") }

$composeArgs += @("up", "-d")

Push-Location "infra/docker"
try {
  docker @composeArgs
}
finally {
  Pop-Location
}