export type SearchKind = 'client' | 'phone' | 'vin' | 'wo' | 'deal' | 'invoice' | 'unknown'

export type SearchRecord = {
  id: string
  kind: Exclude<SearchKind, 'unknown'>
  title: string
  subtitle: string
  reference: string
  route: string
}

const records: SearchRecord[] = [
  {
    id: 'ops-9001',
    kind: 'client',
    title: 'Дорожная карта 9/10',
    subtitle: 'Подготовка к production и план post-MVP',
    reference: 'RM-9-10',
    route: '/readiness',
  },
  {
    id: 'c-1001',
    kind: 'client',
    title: 'Иван Петров',
    subtitle: 'Клиент CRM',
    reference: '+7 (926) 441-22-10',
    route: '/crm-sales',
  },
  {
    id: 'c-1002',
    kind: 'client',
    title: 'ООО Автологистика',
    subtitle: 'Корпоративный клиент',
    reference: '+7 (495) 778-90-11',
    route: '/crm-sales',
  },
  {
    id: 'v-2001',
    kind: 'vin',
    title: 'Toyota Camry 2.5',
    subtitle: 'VIN карточка автомобиля',
    reference: 'XW7BF4FK30S123456',
    route: '/inventory',
  },
  {
    id: 'wo-3001',
    kind: 'wo',
    title: 'Заказ-наряд WO-10387',
    subtitle: 'Диагностика и обслуживание',
    reference: 'WO-10387',
    route: '/service',
  },
  {
    id: 'd-4001',
    kind: 'deal',
    title: 'Сделка DEAL-7782',
    subtitle: 'Продажа авто и доп. услуги',
    reference: 'DEAL-7782',
    route: '/crm-sales',
  },
  {
    id: 'i-5001',
    kind: 'invoice',
    title: 'Счет INV-99231',
    subtitle: 'Оплата сервисных работ',
    reference: 'INV-99231',
    route: '/finance',
  },
]

export function detectSearchKind(query: string): SearchKind {
  const normalized = query.trim().toUpperCase()
  if (!normalized) return 'unknown'

  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(normalized)) return 'vin'
  if (/^(WO[-\s]?\d{3,})$/.test(normalized)) return 'wo'
  if (/^(DEAL[-\s]?\d{2,})$/.test(normalized)) return 'deal'
  if (/^(INV[-\s]?\d{2,})$/.test(normalized)) return 'invoice'

  const digits = normalized.replace(/\D/g, '')
  if (digits.length >= 7) return 'phone'
  if (normalized.length >= 2) return 'client'

  return 'unknown'
}

export function globalSearch(query: string): { kind: SearchKind; results: SearchRecord[] } {
  const kind = detectSearchKind(query)
  const normalized = query.trim().toUpperCase()
  const digits = query.replace(/\D/g, '')

  if (!normalized) return { kind, results: [] }

  const filtered = records.filter((record) => {
    const ref = record.reference.toUpperCase()
    const title = record.title.toUpperCase()
    const subtitle = record.subtitle.toUpperCase()
    const refDigits = record.reference.replace(/\D/g, '')

    if (kind === 'phone') {
      return refDigits.includes(digits)
    }
    if (kind !== 'unknown' && kind !== 'client') {
      return record.kind === kind && (ref.includes(normalized) || title.includes(normalized))
    }
    return (
      title.includes(normalized) ||
      subtitle.includes(normalized) ||
      ref.includes(normalized) ||
      refDigits.includes(digits)
    )
  })

  return { kind, results: filtered }
}
