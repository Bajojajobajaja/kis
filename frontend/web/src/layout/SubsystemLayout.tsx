import { Navigate, NavLink, Outlet, useParams } from 'react-router-dom'

import { useAuth } from '../auth/AuthContext'
import { getSubsystemBySlug } from '../domain/subsystems'

export function SubsystemLayout() {
  const { subsystemSlug } = useParams()
  const { canAccessSubsystem, getLandingPath } = useAuth()
  const subsystem = subsystemSlug ? getSubsystemBySlug(subsystemSlug) : undefined

  if (!subsystem) {
    return <Navigate to={getLandingPath()} replace />
  }

  if (!canAccessSubsystem(subsystem.slug)) {
    return <Navigate to={getLandingPath()} replace />
  }

  const visibleTabs: Array<{ slug: string; title: string }> = subsystem.tabs.map((tab) => ({
    slug: tab.slug,
    title: tab.title,
  }))

  if (subsystem.slug === 'finance') {
    visibleTabs.push({ slug: 'analytics', title: 'Аналитика' })
  }

  return (
    <section className="subsystem-layout">
      <header className="section-header section-header--compact">
        <p className="section-header__tag">Подсистема</p>
        <h2 className="section-header__title">{subsystem.title}</h2>
        <p className="section-header__subtitle">{subsystem.summary}</p>
      </header>

      <nav className="subsystem-tabs" aria-label="secondary-navigation">
        {visibleTabs.map((tab) => (
          <NavLink
            key={tab.slug}
            to={`/${subsystem.slug}/${tab.slug}`}
            className={({ isActive }) => `subsystem-tab${isActive ? ' active' : ''}`}
          >
            {tab.title}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </section>
  )
}
