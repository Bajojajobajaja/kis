import { Link, useSearchParams } from 'react-router-dom'

import { useEntityStore } from '../domain/EntityStoreContext'

function detectKind(query: string): string {
  const normalized = query.trim().toUpperCase()
  if (!normalized) return 'unknown'
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(normalized)) return 'vin'
  if (/^\+?\d[\d\s\-()]{6,}$/.test(query.trim())) return 'phone'
  if (/^[A-Z]{2,5}-\d{3,}$/i.test(normalized)) return 'document'
  return 'text'
}

const kindLabel: Record<string, string> = {
  unknown: 'не определен',
  vin: 'VIN',
  phone: 'Телефон',
  document: 'Номер документа',
  text: 'Текстовый запрос',
}

export function SearchPage() {
  const [params] = useSearchParams()
  const query = params.get('q')?.trim() ?? ''
  const kind = detectKind(query)
  const { getAllRecords } = useEntityStore()

  const results = query
    ? getAllRecords().filter(({ record }) => {
        const haystack = [
          record.id,
          record.title,
          record.subtitle,
          ...Object.values(record.values),
        ]
          .join(' ')
          .toLowerCase()
        return haystack.includes(query.toLowerCase())
      })
    : []

  return (
    <section>
      <header className="section-header">
        <p className="section-header__tag">Глобальный поиск</p>
        <h2 className="section-header__title">Поиск по сущностям</h2>
        <p className="section-header__subtitle">
          Поддерживаются форматы VIN, телефон, номер документа и произвольный текст.
        </p>
      </header>

      {!query ? (
        <article className="detail-card">
          <p>Введите запрос в верхней строке поиска: VIN, телефон или номер документа.</p>
        </article>
      ) : (
        <>
          <p className="search-meta">
            Запрос: <strong>{query}</strong> · Тип: <strong>{kindLabel[kind]}</strong> · Найдено:{' '}
            <strong>{results.length}</strong>
          </p>

          <div className="search-grid">
            {results.map(({ storeKey, record }) => {
              const [subsystemSlug, tabSlug] = storeKey.split('/')
              return (
                <article key={`${storeKey}-${record.id}`} className="search-card">
                  <h3>{record.title}</h3>
                  <p>{record.subtitle}</p>
                  <p className="search-card__meta">
                    {record.id} · {subsystemSlug} / {tabSlug}
                  </p>
                  <Link className="table-link" to={`/${subsystemSlug}/${tabSlug}/${record.id}`}>
                    Открыть карточку
                  </Link>
                </article>
              )
            })}
          </div>

          {results.length === 0 ? (
            <article className="detail-card">
              <p>По вашему запросу ничего не найдено. Уточните ключевые поля.</p>
            </article>
          ) : null}
        </>
      )}
    </section>
  )
}
