import './App.css'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'

import { AuthGuard } from './auth/AuthGuard'
import { AuthProvider } from './auth/AuthContext'
import { EntityStoreProvider } from './domain/EntityStoreContext'
import { getSubsystemBySlug } from './domain/subsystems'
import { AppLayout } from './layout/AppLayout'
import { SubsystemLayout } from './layout/SubsystemLayout'
import { EntityCardPage } from './pages/EntityCardPage'
import { EntityListPage } from './pages/EntityListPage'
import { LoginPage } from './pages/LoginPage'
import { SearchPage } from './pages/SearchPage'

function SubsystemIndexRedirect() {
  const { subsystemSlug } = useParams()
  const subsystem = subsystemSlug ? getSubsystemBySlug(subsystemSlug) : undefined

  if (!subsystem) {
    return <Navigate to="/crm-sales" replace />
  }

  return <Navigate to={`/${subsystem.slug}/${subsystem.tabs[0].slug}`} replace />
}

function App() {
  return (
    <AuthProvider>
      <EntityStoreProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AuthGuard />}>
            <Route element={<AppLayout />}>
              <Route index element={<Navigate to="/crm-sales" replace />} />
              <Route path="/search" element={<SearchPage />} />

              <Route path="/:subsystemSlug" element={<SubsystemLayout />}>
                <Route index element={<SubsystemIndexRedirect />} />
                <Route path=":tabSlug" element={<EntityListPage />} />
                <Route path=":tabSlug/:recordId" element={<EntityCardPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/crm-sales" replace />} />
        </Routes>
      </EntityStoreProvider>
    </AuthProvider>
  )
}

export default App
