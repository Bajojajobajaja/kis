import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../auth/AuthContext'
import type { AccessRole, SubsystemSlug } from '../domain/model'
import { accessRoleLabels, canAccessSubsystem, getDefaultPath, isAccessRole } from '../domain/rbac'
import { getSubsystemBySlug } from '../domain/subsystems'

type LoginState = {
  from?: {
    pathname?: string
  }
}

export function LoginPage() {
  const { signIn, isAuthenticated, getLandingPath } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [selectedRole, setSelectedRole] = useState<AccessRole>('sales')

  const from = (location.state as LoginState | null)?.from?.pathname ?? getDefaultPath(selectedRole)

  if (isAuthenticated) {
    return <Navigate to={getLandingPath()} replace />
  }

  const handleSignIn = () => {
    signIn(selectedRole)
    const subsystemSlug = from.match(/^\/([^/]+)/)?.[1]
    const subsystem = subsystemSlug ? getSubsystemBySlug(subsystemSlug) : undefined
    const nextPath =
      subsystem && canAccessSubsystem(selectedRole, subsystem.slug as SubsystemSlug)
        ? from
        : getDefaultPath(selectedRole)
    navigate(nextPath, { replace: true })
  }

  return (
    <div className="login-wrap">
      <section className="login-card">
        <p className="brand__tag">KIS Nexus</p>
        <h1 className="login-card__title">Вход в корпоративную систему</h1>
        <p className="login-card__subtitle">
          Выберите системную роль, чтобы проверить доступ к подсистемам и ограничения действий.
        </p>

        <label className="field">
          <span>Профиль доступа</span>
          <select
            value={selectedRole}
            onChange={(event) => {
              const nextRole = event.target.value
              if (isAccessRole(nextRole)) {
                setSelectedRole(nextRole)
              }
            }}
          >
            {Object.entries(accessRoleLabels).map(([role, label]) => (
              <option key={role} value={role}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <button className="btn-primary" onClick={handleSignIn}>
          Войти в систему
        </button>
      </section>
    </div>
  )
}
