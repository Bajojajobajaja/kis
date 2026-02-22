import { Navigate, NavLink, Outlet, useParams } from 'react-router-dom'

import { getSubsystemBySlug } from '../domain/subsystems'

export function SubsystemLayout() {
  const { subsystemSlug } = useParams()
  const subsystem = subsystemSlug ? getSubsystemBySlug(subsystemSlug) : undefined

  if (!subsystem) {
    return <Navigate to="/crm-sales" replace />
  }

  return (
    <section className="subsystem-layout">
      <header className="section-header section-header--compact">
        <p className="section-header__tag">Подсистема</p>
        <h2 className="section-header__title">{subsystem.title}</h2>
        <p className="section-header__subtitle">{subsystem.summary}</p>
      </header>

      <nav className="subsystem-tabs" aria-label="secondary-navigation">
        {subsystem.tabs.map((tab) => (
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
