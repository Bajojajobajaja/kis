git config core.hooksPath .githooks
if ($LASTEXITCODE -ne 0) {
  throw "Failed to configure core.hooksPath"
}

Write-Host "Git hooks path configured to .githooks"
Write-Host "Configured hooks:"
Get-ChildItem -Path .githooks -File | Select-Object -ExpandProperty Name | ForEach-Object { Write-Host " - $_" }
