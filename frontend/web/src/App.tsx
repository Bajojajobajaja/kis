import './App.css'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'

import { AuthGuard } from './auth/AuthGuard'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { EntityStoreProvider } from './domain/EntityStoreContext'
import { getSubsystemBySlug } from './domain/subsystems'
import { AppLayout } from './layout/AppLayout'
import { SubsystemLayout } from './layout/SubsystemLayout'
import { EntityCardPage } from './pages/EntityCardPage'
import { EntityListPage } from './pages/EntityListPage'
import { FinanceAnalyticsPage } from './pages/FinanceAnalyticsPage'
import { LoginPage } from './pages/LoginPage'
import { SearchPage } from './pages/SearchPage'

function SubsystemIndexRedirect() {
  const { subsystemSlug } = useParams()
  const { getLandingPath } = useAuth()
  const subsystem = subsystemSlug ? getSubsystemBySlug(subsystemSlug) : undefined

  if (!subsystem) {
    return <Navigate to={getLandingPath()} replace />
  }

  return <Navigate to={getLandingPath(subsystem.slug)} replace />
}

function HomeRedirect() {
  const { getLandingPath } = useAuth()
  return <Navigate to={getLandingPath()} replace />
}

function AppFallbackRedirect() {
  const { isAuthenticated, getLandingPath } = useAuth()
  return <Navigate to={isAuthenticated ? getLandingPath() : '/login'} replace />
}

function App() {
  return (
    <AuthProvider>
      <EntityStoreProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AuthGuard />}>
            <Route element={<AppLayout />}>
              <Route index element={<HomeRedirect />} />
              <Route path="/search" element={<SearchPage />} />

              <Route path="/:subsystemSlug" element={<SubsystemLayout />}>
                <Route index element={<SubsystemIndexRedirect />} />
                <Route path="analytics" element={<FinanceAnalyticsPage />} />
                <Route path=":tabSlug" element={<EntityListPage />} />
                <Route path=":tabSlug/:recordId" element={<EntityCardPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<AppFallbackRedirect />} />
        </Routes>
      </EntityStoreProvider>
    </AuthProvider>
  )
}

export default App
