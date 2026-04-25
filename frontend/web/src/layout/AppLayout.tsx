import { useEffect, useRef, useState, type FormEvent } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../auth/AuthContext'
import { subsystemNav } from '../config/navigation'
import type { AccessRole } from '../domain/model'
import { accessRoleLabels } from '../domain/rbac'
import { getSubsystemBySlug } from '../domain/subsystems'

export function AppLayout() {
  const { signOut, role, setRole, canAccessSubsystem, getLandingPath } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [query, setQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const match = location.pathname.match(/^\/([^/]+)/)
    const subsystemSlug = match?.[1]
    if (!subsystemSlug || subsystemSlug === 'search') {
      return
    }

    const subsystem = getSubsystemBySlug(subsystemSlug)
    if (!subsystem || canAccessSubsystem(subsystem.slug)) {
      return
    }

    navigate(getLandingPath(), { replace: true })
  }, [canAccessSubsystem, getLandingPath, location.pathname, navigate])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleSignOut = () => {
    signOut()
    navigate('/login', { replace: true })
  }

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = query.trim()
    navigate(normalized ? `/search?q=${encodeURIComponent(normalized)}` : '/search')
  }

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="brand">
          <p className="brand__tag">KIS Nexus</p>
          <h1 className="brand__title">Корпоративная CRM</h1>
        </div>

        <nav className="menu" aria-label="main-navigation">
          {subsystemNav.filter((item) => canAccessSubsystem(item.slug)).map((item) => (
            <NavLink
              key={item.slug}
              to={`/${item.slug}`}
              className={({ isActive }) => `menu__item${isActive ? ' active' : ''}`}
            >
              {item.title}
            </NavLink>
          ))}
        </nav>

        <p className="side-nav__hint">
          Модель навигации: Раздел -&gt; Список сущностей -&gt; Карточка -&gt; Действия.
        </p>
      </aside>

      <div className="content-area">
        <header className="top-bar">
          <form className="search-form" onSubmit={handleSearchSubmit}>
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Глобальный поиск: VIN, телефон, номер документа"
            />
            <button type="submit" className="btn-secondary">
              Найти
            </button>
          </form>

          <div className="top-bar__actions">
            <p className="hotkey-hint">Ctrl+K: фокус глобального поиска</p>
            <label className="field field--inline">
              <span>Роль</span>
              <select value={role} onChange={(event) => setRole(event.target.value as AccessRole)}>
                {Object.entries(accessRoleLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <button className="btn-secondary" onClick={handleSignOut}>
              Выйти
            </button>
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
