import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

import type { AccessRole, ActionKey, EntityStoreKey, SubsystemSlug } from '../domain/model'
import {
  canAccessStore,
  canAccessSubsystem,
  canRolePerform,
  getDefaultPath,
  getDefaultPathForSubsystem,
  isAccessRole,
} from '../domain/rbac'

type AuthContextValue = {
  isAuthenticated: boolean
  role: AccessRole
  signIn: (role?: AccessRole) => void
  signOut: () => void
  setRole: (role: AccessRole) => void
  can: (action: ActionKey, storeKey: EntityStoreKey) => boolean
  canAccessSubsystem: (subsystemSlug: SubsystemSlug) => boolean
  canAccessStore: (storeKey: string) => boolean
  getLandingPath: (subsystemSlug?: SubsystemSlug) => string
}

const STORAGE_KEY = 'kis.web.auth'
const ROLE_STORAGE_KEY = 'kis.web.role'

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const storedRole = localStorage.getItem(ROLE_STORAGE_KEY)
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(
    localStorage.getItem(STORAGE_KEY) === '1',
  )
  const [role, setRoleState] = useState<AccessRole>(
    storedRole && isAccessRole(storedRole) ? storedRole : 'sales',
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated,
      role,
      signIn: (nextRole?: AccessRole) => {
        localStorage.setItem(STORAGE_KEY, '1')
        if (nextRole && isAccessRole(nextRole)) {
          localStorage.setItem(ROLE_STORAGE_KEY, nextRole)
          setRoleState(nextRole)
        }
        setIsAuthenticated(true)
      },
      signOut: () => {
        localStorage.removeItem(STORAGE_KEY)
        setIsAuthenticated(false)
      },
      setRole: (nextRole: AccessRole) => {
        if (!isAccessRole(nextRole)) {
          return
        }
        localStorage.setItem(ROLE_STORAGE_KEY, nextRole)
        setRoleState(nextRole)
      },
      can: (action: ActionKey, storeKey: EntityStoreKey) =>
        canRolePerform(role, action, storeKey),
      canAccessSubsystem: (subsystemSlug: SubsystemSlug) =>
        canAccessSubsystem(role, subsystemSlug),
      canAccessStore: (storeKey: string) => canAccessStore(role, storeKey),
      getLandingPath: (subsystemSlug?: SubsystemSlug) =>
        subsystemSlug
          ? getDefaultPathForSubsystem(role, subsystemSlug)
          : getDefaultPath(role),
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
