import { NavLink } from 'react-router-dom'

import { useAuth } from '../auth/AuthContext'
import { subsystemNav } from '../config/navigation'

export function DashboardPage() {
  const { canAccessSubsystem } = useAuth()

  return (
    <section>
      <header className="section-header">
        <p className="section-header__tag">Дашборд</p>
        <h2 className="section-header__title">Подсистемы KIS Nexus</h2>
      </header>

      <div className="cards-grid">
        <article className="system-card system-card--highlight">
          <h3>Дорожная карта 9/10</h3>
          <p>
            Подготовка к production и план post-MVP уже закрыты и отражены в ключевых артефактах.
          </p>
          <div className="system-card__meta">
            <span>Статус</span>
            <strong>Закрыто</strong>
          </div>
          <NavLink className="system-card__link" to="/readiness">
            Открыть раздел
          </NavLink>
        </article>
        {subsystemNav.filter((item) => canAccessSubsystem(item.slug)).map((item, index) => (
          <article
            key={item.slug}
            className="system-card"
            style={{ animationDelay: `${index * 80}ms` }}
          >
            <h3>{item.title}</h3>
            <p>{item.summary}</p>
            <div className="system-card__meta">
              <span>{item.metricLabel}</span>
              <strong>{item.metricValue}</strong>
            </div>
            <NavLink className="system-card__link" to={`/${item.slug}`}>
              Открыть раздел
            </NavLink>
          </article>
        ))}
      </div>
    </section>
  )
}
