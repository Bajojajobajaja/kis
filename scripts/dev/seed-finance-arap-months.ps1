param(
  [string[]]$Months = @("01.2026", "02.2026", "03.2026"),
  [int]$InvoicesPerMonth = 24,
  [int]$PaymentsPerMonth = 36,
  [int]$StartingInvoiceNumber = 100079,
  [ValidateSet("reset", "append")]
  [string]$Mode = "reset",
  [string]$FinanceInvoicingBaseUrl = "http://127.0.0.1:19086",
  [string]$FinanceReportingBaseUrl = "http://127.0.0.1:19088"
)

$ErrorActionPreference = "Stop"

function Round2 {
  param([double]$Value)
  return [math]::Round($Value, 2, [MidpointRounding]::AwayFromZero)
}

function New-IsoDate {
  param(
    [int]$Year,
    [int]$Month,
    [int]$Day,
    [int]$Hour,
    [int]$Minute
  )
  return [DateTimeOffset]::new($Year, $Month, $Day, $Hour, $Minute, 0, [TimeSpan]::Zero).ToString("o")
}

function Split-Amount {
  param(
    [double]$Total,
    [double[]]$Weights
  )
  if ($Weights.Count -eq 0) {
    return @()
  }

  $parts = @()
  $sum = 0.0
  for ($i = 0; $i -lt ($Weights.Count - 1); $i++) {
    $piece = Round2 ($Total * $Weights[$i])
    $parts += $piece
    $sum += $piece
  }
  $parts += Round2 ($Total - $sum)
  return ,$parts
}

function Assert-Health {
  param([string]$BaseUrl)
  $healthUrl = ($BaseUrl.TrimEnd("/") + "/healthz")
  $null = Invoke-RestMethod -Method Get -Uri $healthUrl
}

function Build-IdempotencyKey {
  param([string]$Prefix)
  $script:requestSeq++
  return "$Prefix-$($script:runID)-$([string]::Format('{0:D5}', $script:requestSeq))"
}

function Invoke-JsonPost {
  param(
    [string]$Url,
    [hashtable]$Payload,
    [string]$IdempotencyPrefix
  )
  $idempotencyKey = Build-IdempotencyKey -Prefix $IdempotencyPrefix
  $json = $Payload | ConvertTo-Json -Depth 12 -Compress
  try {
    return Invoke-RestMethod -Method Post -Uri $Url -ContentType "application/json" -Headers @{
      "Accept" = "application/json"
      "Idempotency-Key" = $idempotencyKey
    } -Body $json
  }
  catch {
    $details = ""
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      $details = " :: $($_.ErrorDetails.Message)"
    }
    throw "POST $Url failed: $($_.Exception.Message)$details"
  }
}

if ($InvoicesPerMonth -ne 24 -or $PaymentsPerMonth -ne 36) {
  throw "This seed profile currently supports only InvoicesPerMonth=24 and PaymentsPerMonth=36."
}
if ($InvoicesPerMonth % 2 -ne 0) {
  throw "InvoicesPerMonth must be even."
}
if ($StartingInvoiceNumber -le 0) {
  throw "StartingInvoiceNumber must be positive."
}

$script:runID = Get-Date -Format "yyyyMMddHHmmssfff"
$script:requestSeq = 0

$monthsNormalized = @()
foreach ($monthRaw in $Months) {
  $rawValue = ""
  if ($null -ne $monthRaw) {
    $rawValue = [string]$monthRaw
  }
  $token = $rawValue.Trim()
  if ($token -eq "") {
    continue
  }
  try {
    $monthStart = [DateTime]::ParseExact($token, "MM.yyyy", [System.Globalization.CultureInfo]::InvariantCulture)
  }
  catch {
    throw "Invalid month token '$token'. Expected MM.YYYY."
  }
  $monthsNormalized += [pscustomobject]@{
    Token = $token
    Year = $monthStart.Year
    Month = $monthStart.Month
  }
}
if ($monthsNormalized.Count -eq 0) {
  throw "No valid months supplied."
}

Assert-Health -BaseUrl $FinanceInvoicingBaseUrl
Assert-Health -BaseUrl $FinanceReportingBaseUrl

if ($Mode -eq "reset") {
  $invoicingResetUrl = $FinanceInvoicingBaseUrl.TrimEnd("/") + "/dev/reset"
  $null = Invoke-JsonPost -Url $invoicingResetUrl -Payload @{} -IdempotencyPrefix "seed-reset-invoicing"
  $reportingResetUrl = $FinanceReportingBaseUrl.TrimEnd("/") + "/dev/reset"
  $null = Invoke-JsonPost -Url $reportingResetUrl -Payload @{} -IdempotencyPrefix "seed-reset-reporting"
}

$invoicesByMonth = @{}
$createdInvoicesTotal = 0
$createdPaymentsTotal = 0

for ($monthIndex = 0; $monthIndex -lt $monthsNormalized.Count; $monthIndex++) {
  $monthMeta = $monthsNormalized[$monthIndex]
  $monthInvoices = New-Object System.Collections.Generic.List[object]
  $half = [int]($InvoicesPerMonth / 2)

  for ($i = 1; $i -le $InvoicesPerMonth; $i++) {
    $kind = if ($i -le $half) { "ar" } else { "ap" }
    $localIndex = if ($i -le $half) { $i } else { $i - $half }
    $partyPrefix = if ($kind -eq "ar") { "client" } else { "vendor" }
    $partyLabel = if ($kind -eq "ar") { "Client" } else { "Vendor" }

    $invoiceDay = 1 + (($i - 1) % 20)
    $createdAt = New-IsoDate -Year $monthMeta.Year -Month $monthMeta.Month -Day $invoiceDay -Hour 10 -Minute ($i % 50)
    $lastDay = [DateTime]::DaysInMonth($monthMeta.Year, $monthMeta.Month)
    $dueDay = [Math]::Min($invoiceDay + 14, $lastDay)
    $dueDate = [string]::Format("{0:D4}-{1:D2}-{2:D2}", $monthMeta.Year, $monthMeta.Month, $dueDay)

    $amountBase = if ($kind -eq "ar") { 1200 } else { 900 }
    $amount = Round2 ($amountBase + ($localIndex * 53) + (($monthIndex + 1) * 87))
    $globalInvoiceOffset = ($monthIndex * $InvoicesPerMonth) + ($i - 1)
    $invoiceNumber = "INV-$([string]::Format('{0:D6}', ($StartingInvoiceNumber + $globalInvoiceOffset)))"

    $invoicePayload = @{
      number = $invoiceNumber
      subject = "Seed invoice $($monthMeta.Token) #$([string]::Format('{0:D2}', $i))"
      party_id = "seed-$partyPrefix-$([string]::Format('{0:D2}', $localIndex))"
      party_name = "Seed $partyLabel $([string]::Format('{0:D2}', $localIndex))"
      amount = $amount
      kind = $kind
      currency = "USD"
      due_date = $dueDate
      external_ref = "seed-$($monthMeta.Token)-$([string]::Format('{0:D2}', $i))"
      created_at = $createdAt
    }

    $invoiceUrl = $FinanceInvoicingBaseUrl.TrimEnd("/") + "/invoices"
    $created = Invoke-JsonPost -Url $invoiceUrl -Payload $invoicePayload -IdempotencyPrefix "seed-inv-$($monthMeta.Token)-$i"
    $monthInvoices.Add($created) | Out-Null
    $createdInvoicesTotal++
  }

  if ($monthInvoices.Count -ne $InvoicesPerMonth) {
    throw "Expected $InvoicesPerMonth invoices for $($monthMeta.Token), got $($monthInvoices.Count)."
  }

  $paymentsInMonth = 0
  for ($invoiceIndex = 1; $invoiceIndex -le $monthInvoices.Count; $invoiceIndex++) {
    $invoice = $monthInvoices[$invoiceIndex - 1]
    $weights = @()
    if ($invoiceIndex -le 6) {
      $weights = @(0.40, 0.35, 0.25)
    } elseif ($invoiceIndex -le 8) {
      $weights = @(0.60, 0.40)
    } elseif ($invoiceIndex -le 16) {
      $weights = @(0.60)
    } elseif ($invoiceIndex -le 22) {
      $weights = @(0.30)
    }
    if ($weights.Count -eq 0) {
      continue
    }

    $splits = Split-Amount -Total ([double]$invoice.amount) -Weights $weights
    foreach ($split in $splits) {
      $paymentsInMonth++
      $paidDay = 2 + (($paymentsInMonth - 1) % 24)
      $paidAt = New-IsoDate -Year $monthMeta.Year -Month $monthMeta.Month -Day $paidDay -Hour 12 -Minute ($paymentsInMonth % 50)
      $method = if ($paymentsInMonth % 2 -eq 0) { "wire" } else { "bank_transfer" }

      $paymentPayload = @{
        invoice_id = [string]$invoice.id
        amount = Round2 ([double]$split)
        method = $method
        note = "seed payment $($monthMeta.Token)"
        paid_at = $paidAt
      }
      $paymentUrl = $FinanceInvoicingBaseUrl.TrimEnd("/") + "/payments"
      $null = Invoke-JsonPost -Url $paymentUrl -Payload $paymentPayload -IdempotencyPrefix "seed-pay-$($monthMeta.Token)-$paymentsInMonth"
      $createdPaymentsTotal++
    }
  }

  if ($paymentsInMonth -ne $PaymentsPerMonth) {
    throw "Expected $PaymentsPerMonth payments for $($monthMeta.Token), got $paymentsInMonth."
  }

  $invoicesByMonth[$monthMeta.Token] = $monthInvoices
}

$verification = New-Object System.Collections.Generic.List[object]
foreach ($monthMeta in $monthsNormalized) {
  $exportPayload = @{
    report = "ar-ap"
    format = "pdf"
    owner = "dev-seed"
    period = $monthMeta.Token
  }
  $exportUrl = $FinanceReportingBaseUrl.TrimEnd("/") + "/reports/export"
  $export = Invoke-JsonPost -Url $exportUrl -Payload $exportPayload -IdempotencyPrefix "seed-export-$($monthMeta.Token)"

  if ($null -eq $export.summary) {
    throw "Report export for $($monthMeta.Token) has no summary."
  }
  if ([int]$export.summary.invoice_count -le 0 -or [int]$export.summary.payment_count -le 0) {
    throw "Report export for $($monthMeta.Token) has empty counters."
  }
  if ([double]$export.summary.incoming_issued_total -le 0 -or [double]$export.summary.outgoing_issued_total -le 0) {
    throw "Report export for $($monthMeta.Token) has zero issued totals."
  }

  $verification.Add([pscustomobject]@{
    month = $monthMeta.Token
    export_id = $export.id
    invoice_count = [int]$export.summary.invoice_count
    payment_count = [int]$export.summary.payment_count
    incoming_issued_total = [double]$export.summary.incoming_issued_total
    outgoing_issued_total = [double]$export.summary.outgoing_issued_total
    reconciled_payments_total = [double]$export.summary.reconciled_payments_total
    open_invoice_total = [double]$export.summary.open_invoice_total
    download_url = [string]$export.download_url
  }) | Out-Null
}

Write-Host ""
Write-Host "Seed completed."
Write-Host "Invoices created: $createdInvoicesTotal"
Write-Host "Payments created: $createdPaymentsTotal"
Write-Host ""
$verification | Sort-Object month | Format-Table -AutoSize
Write-Host ""
$verification | Sort-Object month | ConvertTo-Json -Depth 6
