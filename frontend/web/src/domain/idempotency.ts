export function isIdempotencyConflictError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const message = error.message.trim().toLowerCase()
  return message.includes('idempotency conflict')
}

export function createIdempotencyKey(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now()}-${random}`
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms)
  })
}

export async function withIdempotencyRetry<T>(
  factory: () => Promise<T>,
  attempts = 9,
): Promise<T> {
  let waitMs = 250

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await factory()
    } catch (error) {
      if (!isIdempotencyConflictError(error) || attempt >= attempts) {
        throw error
      }

      await delay(waitMs)
      waitMs = Math.min(waitMs * 2, 4000)
    }
  }
}
