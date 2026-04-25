const SALES_DOCUMENTS_API_BASE = '/svc/sales-documents'

type SalesDocumentResponseRaw = {
  id: string
  template_id: string
  type: string
  deal_id: string
  client_id?: string
  source_document_id?: string
  number: string
  total: number
  status: string
  file_name?: string
  content_type?: string
  download_url?: string
  generated_at?: string
  created_at: string
}

export type SalesDocumentGenerateRequest = {
  templateId: string
  dealId: string
  clientId?: string
  sourceDocumentId?: string
  documentNumber?: string
  documentDate?: string
  responsible?: string
  buyerName?: string
  vehicleTitle?: string
  vehicleVin?: string
  vehicleBrand?: string
  vehicleModel?: string
  vehicleYear?: string
  vehicleColor?: string
  vehiclePrice?: string
  total?: number
}

export type SalesDocumentResponse = {
  id: string
  templateId: string
  type: string
  dealId: string
  clientId?: string
  sourceDocumentId?: string
  number: string
  total: number
  status: string
  fileName?: string
  contentType?: string
  downloadUrl?: string
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

function mapSalesDocumentResponse(response: SalesDocumentResponseRaw): SalesDocumentResponse {
  return {
    id: response.id,
    templateId: response.template_id,
    type: response.type,
    dealId: response.deal_id,
    clientId: response.client_id,
    sourceDocumentId: response.source_document_id,
    number: response.number,
    total: response.total,
    status: response.status,
    fileName: response.file_name,
    contentType: response.content_type,
    downloadUrl: response.download_url,
    generatedAt: response.generated_at,
    createdAt: response.created_at,
  }
}

function resolveSalesDocumentsURL(pathOrURL: string): string {
  const trimmedValue = pathOrURL.trim()
  if (/^https?:\/\//i.test(trimmedValue)) {
    return trimmedValue
  }
  if (trimmedValue.startsWith('/')) {
    return `${SALES_DOCUMENTS_API_BASE}${trimmedValue}`
  }
  return `${SALES_DOCUMENTS_API_BASE}/${trimmedValue.replace(/^\/+/, '')}`
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

  return (fallbackFileName ?? '').trim() || 'sales-contract.pdf'
}

export async function generateSalesDocument(
  request: SalesDocumentGenerateRequest,
): Promise<SalesDocumentResponse> {
  const response = await requestJSON<SalesDocumentResponseRaw>(
    `${SALES_DOCUMENTS_API_BASE}/documents/generate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        template_id: request.templateId,
        deal_id: request.dealId,
        client_id: request.clientId,
        source_document_id: request.sourceDocumentId,
        document_number: request.documentNumber,
        document_date: request.documentDate,
        responsible: request.responsible,
        buyer_name: request.buyerName,
        vehicle_title: request.vehicleTitle,
        vehicle_vin: request.vehicleVin,
        vehicle_brand: request.vehicleBrand,
        vehicle_model: request.vehicleModel,
        vehicle_year: request.vehicleYear,
        vehicle_color: request.vehicleColor,
        vehicle_price: request.vehiclePrice,
        total: request.total,
      }),
    },
  )

  return mapSalesDocumentResponse(response)
}

export async function downloadSalesDocument(
  downloadUrl: string,
  fallbackFileName?: string,
): Promise<void> {
  const response = await fetch(resolveSalesDocumentsURL(downloadUrl), {
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
