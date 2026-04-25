const SERVICE_PARTS_USAGE_API_BASE = '/svc/service-parts-usage'

export type ServicePartsUsageRecord = {
  id: string
  workorder_id: string
  part_code: string
  quantity: number
  action: string
  created_at: string
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

export async function fetchPartsUsages(action?: string): Promise<ServicePartsUsageRecord[]> {
  const query = action ? `?action=${encodeURIComponent(action)}` : ''
  return requestJSON<ServicePartsUsageRecord[]>(
    `${SERVICE_PARTS_USAGE_API_BASE}/usages${query}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    },
  )
}
