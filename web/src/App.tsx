import { Route, Routes } from 'react-router'
import { Shell } from '@/app/Shell'
import { HomePage } from '@/pages/HomePage'
import { DesignerPage } from '@/pages/DesignerPage'
import { LoginPage } from '@/pages/LoginPage'
import { RegisterPage } from '@/pages/RegisterPage'

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<Shell />}>
        <Route index element={<HomePage />} />
        <Route path="designer" element={<DesignerPage />} />
        <Route path="designer/:id" element={<DesignerPage />} />
      </Route>
    </Routes>
  )
}
