import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import { AuthGate } from '@/app/AuthGate'
import { Shell } from '@/app/Shell'
import { Leaf } from '@/app/Leaf'

// Route-level code-split: the auth pages stay tiny; the designer / fill / share
// screens (and the format libs they pull — yaml, papaparse, smol-toml) load
// only when their route is hit.
const HomePage = lazy(() => import('@/pages/HomePage').then((m) => ({ default: m.HomePage })))
const DesignerPage = lazy(() =>
  import('@/pages/DesignerPage').then((m) => ({ default: m.DesignerPage })),
)
const FillPage = lazy(() => import('@/pages/FillPage').then((m) => ({ default: m.FillPage })))
const PublicFillPage = lazy(() =>
  import('@/pages/PublicFillPage').then((m) => ({ default: m.PublicFillPage })),
)
const SubmissionsPage = lazy(() =>
  import('@/pages/SubmissionsPage').then((m) => ({ default: m.SubmissionsPage })),
)
const AdminPage = lazy(() => import('@/pages/AdminPage').then((m) => ({ default: m.AdminPage })))
const LoginPage = lazy(() => import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })))
const RegisterPage = lazy(() =>
  import('@/pages/RegisterPage').then((m) => ({ default: m.RegisterPage })),
)

function RouteFallback() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Leaf className="size-8 animate-pulse" />
    </div>
  )
}

export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/f/:slug" element={<PublicFillPage />} />
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
          <Route path="schemas/:id/submissions" element={<SubmissionsPage />} />
        <Route path="admin" element={<AdminPage />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
