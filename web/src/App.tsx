import { Route, Routes } from 'react-router'
import { AuthGate } from '@/app/AuthGate'
import { Shell } from '@/app/Shell'
import { HomePage } from '@/pages/HomePage'
import { DesignerPage } from '@/pages/DesignerPage'
import { FillPage } from '@/pages/FillPage'
import { LoginPage } from '@/pages/LoginPage'
import { RegisterPage } from '@/pages/RegisterPage'

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        element={
          <AuthGate>
            <Shell />
          </AuthGate>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="designer" element={<DesignerPage />} />
        <Route path="designer/:id" element={<DesignerPage />} />
        <Route path="fill/:id" element={<FillPage />} />
      </Route>
    </Routes>
  )
}
