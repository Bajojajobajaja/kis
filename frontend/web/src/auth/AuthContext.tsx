import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

import type { ActionKey, Role } from '../domain/model'
import { canRolePerform } from '../domain/rbac'

type AuthContextValue = {
  isAuthenticated: boolean
  role: Role
  signIn: (role?: Role) => void
  signOut: () => void
  setRole: (role: Role) => void
  can: (action: ActionKey) => boolean
}

const STORAGE_KEY = 'kis.web.auth'
const ROLE_STORAGE_KEY = 'kis.web.role'

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(
    localStorage.getItem(STORAGE_KEY) === '1',
  )
  const [role, setRoleState] = useState<Role>(
    (localStorage.getItem(ROLE_STORAGE_KEY) as Role | null) ?? 'manager',
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated,
      role,
      signIn: (nextRole?: Role) => {
        localStorage.setItem(STORAGE_KEY, '1')
        if (nextRole) {
          localStorage.setItem(ROLE_STORAGE_KEY, nextRole)
          setRoleState(nextRole)
        }
        setIsAuthenticated(true)
      },
      signOut: () => {
        localStorage.removeItem(STORAGE_KEY)
        setIsAuthenticated(false)
      },
      setRole: (nextRole: Role) => {
        localStorage.setItem(ROLE_STORAGE_KEY, nextRole)
        setRoleState(nextRole)
      },
      can: (action: ActionKey) => canRolePerform(role, action),
    }),
    [isAuthenticated, role],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
