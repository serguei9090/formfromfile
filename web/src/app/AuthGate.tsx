import { useEffect } from 'react'
import { Navigate, useLocation } from 'react-router'
import { setUnauthorizedHandler } from '@/api/client'
import { useAuthStore } from '@/stores/authStore'
import { Leaf } from './Leaf'

/** Loads the session once, then either renders `children` or bounces to /login. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const loading = useAuthStore((s) => s.loading)
  const refresh = useAuthStore((s) => s.refresh)
  const location = useLocation()

  useEffect(() => {
    setUnauthorizedHandler(() => useAuthStore.setState({ user: null }))
    void refresh()
  }, [refresh])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Leaf className="size-8 animate-pulse" />
      </div>
    )
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}
