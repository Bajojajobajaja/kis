import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../auth/AuthContext'
import type { Role } from '../domain/model'
import { roleLabels } from '../domain/rbac'

type LoginState = {
  from?: {
    pathname?: string
  }
}

export function LoginPage() {
  const { signIn, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [selectedRole, setSelectedRole] = useState<Role>('manager')

  const from = (location.state as LoginState | null)?.from?.pathname ?? '/crm-sales'

  if (isAuthenticated) {
    return <Navigate to="/crm-sales" replace />
  }

  const handleSignIn = () => {
    signIn(selectedRole)
    navigate(from, { replace: true })
  }

  return (
    <div className="login-wrap">
      <section className="login-card">
        <p className="brand__tag">KIS Nexus</p>
        <h1 className="login-card__title">Вход в корпоративную систему</h1>
        <p className="login-card__subtitle">
          Выберите профиль доступа, чтобы проверить RBAC и скрытие действий в интерфейсе.
        </p>

        <label className="field">
          <span>Профиль доступа</span>
          <select
            value={selectedRole}
            onChange={(event) => setSelectedRole(event.target.value as Role)}
          >
            {Object.entries(roleLabels).map(([role, label]) => (
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
