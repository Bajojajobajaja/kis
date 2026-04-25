const FINANCE_REPORTING_API_BASE = '/svc/finance-reporting'

type FinanceReportExportSummaryResponse = {
  incoming_issued_total: number
  incoming_paid_total: number
  outgoing_issued_total: number
  outgoing_paid_total: number
  open_invoice_total: number
  reconciled_payments_total: number
  invoice_count: number
  payment_count: number
}

type FinanceReportExportResponseRaw = {
  id: string
  report: string
  format: string
  status: string
  schedule_id?: string
  owner?: string
  period?: string
  period_from?: string
  period_to?: string
  file_name?: string
  content_type?: string
  download_url?: string
  summary?: FinanceReportExportSummaryResponse
  generated_at?: string
  created_at: string
}

export type FinanceReportExportRequest = {
  report: string
  format: string
  owner?: string
  period: string
}

export type FinanceReportExportSummary = {
  incomingIssuedTotal: number
  incomingPaidTotal: number
  outgoingIssuedTotal: number
  outgoingPaidTotal: number
  openInvoiceTotal: number
  reconciledPaymentsTotal: number
  invoiceCount: number
  paymentCount: number
}

export type FinanceReportExportResponse = {
  id: string
  report: string
  format: string
  status: string
  scheduleId?: string
  owner?: string
  period?: string
  periodFrom?: string
  periodTo?: string
  fileName?: string
  contentType?: string
  downloadUrl?: string
  summary?: FinanceReportExportSummary
  generatedAt?: string
  createdAt: string
}

async function requestJSON<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(input, init)
  if (!response.ok) {
    let errorMessage = `${response.status} ${response.statusText}`
    try {
      const payload = (await response.json()) as { error?: string }
      if (payload.error) {
        errorMessage = payload.error
      }
    } catch {
      // ignore non-json error payloads
    }
    throw new Error(errorMessage)
  }
  return (await response.json()) as T
}

function mapFinanceReportSummary(
  summary: FinanceReportExportSummaryResponse | undefined,
): FinanceReportExportSummary | undefined {
  if (!summary) {
    return undefined
  }

  return {
    incomingIssuedTotal: summary.incoming_issued_total,
    incomingPaidTotal: summary.incoming_paid_total,
    outgoingIssuedTotal: summary.outgoing_issued_total,
    outgoingPaidTotal: summary.outgoing_paid_total,
    openInvoiceTotal: summary.open_invoice_total,
    reconciledPaymentsTotal: summary.reconciled_payments_total,
    invoiceCount: summary.invoice_count,
    paymentCount: summary.payment_count,
  }
}

function mapFinanceReportExportResponse(
  response: FinanceReportExportResponseRaw,
): FinanceReportExportResponse {
  return {
    id: response.id,
    report: response.report,
    format: response.format,
    status: response.status,
    scheduleId: response.schedule_id,
    owner: response.owner,
    period: response.period,
    periodFrom: response.period_from,
    periodTo: response.period_to,
    fileName: response.file_name,
    contentType: response.content_type,
    downloadUrl: response.download_url,
    summary: mapFinanceReportSummary(response.summary),
    generatedAt: response.generated_at,
    createdAt: response.created_at,
  }
}

function resolveFinanceReportingURL(pathOrURL: string): string {
  const trimmedValue = pathOrURL.trim()
  if (/^https?:\/\//i.test(trimmedValue)) {
    return trimmedValue
  }
  if (trimmedValue.startsWith('/')) {
    return `${FINANCE_REPORTING_API_BASE}${trimmedValue}`
  }
  return `${FINANCE_REPORTING_API_BASE}/${trimmedValue.replace(/^\/+/, '')}`
}

function resolveDownloadFileName(
  contentDisposition: string | null,
  fallbackFileName?: string,
): string {
  const encodedMatch = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i)
  if (encodedMatch?.[1]) {
    return decodeURIComponent(encodedMatch[1])
  }

  const plainMatch = contentDisposition?.match(/filename="?([^";]+)"?/i)
  if (plainMatch?.[1]) {
    return plainMatch[1]
  }

  return (fallbackFileName ?? '').trim() || 'finance-report.pdf'
}

export async function exportFinanceReport(
  request: FinanceReportExportRequest,
): Promise<FinanceReportExportResponse> {
  const response = await requestJSON<FinanceReportExportResponseRaw>(
    `${FINANCE_REPORTING_API_BASE}/reports/export`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(request),
    },
  )
  return mapFinanceReportExportResponse(response)
}

export async function downloadFinanceReport(
  downloadUrl: string,
  fallbackFileName?: string,
): Promise<void> {
  const response = await fetch(resolveFinanceReportingURL(downloadUrl), {
    method: 'GET',
    headers: {
      Accept: 'application/pdf',
    },
  })
  if (!response.ok) {
    let errorMessage = `${response.status} ${response.statusText}`
    try {
      const payload = (await response.json()) as { error?: string }
      if (payload.error) {
        errorMessage = payload.error
      }
    } catch {
      // ignore non-json error payloads
    }
    throw new Error(errorMessage)
  }

  const blob = await response.blob()
  const objectUrl = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = resolveDownloadFileName(
    response.headers.get('Content-Disposition'),
    fallbackFileName,
  )
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 0)
}
