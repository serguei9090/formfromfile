import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/stores/authStore'
import { Leaf } from './Leaf'

export function AuthCard({ mode }: { mode: 'login' | 'register' }) {
  const isLogin = mode === 'login'
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const register = useAuthStore((s) => s.register)
  const refresh = useAuthStore((s) => s.refresh)
  const allowRegister = useAuthStore((s) => s.allowRegister)
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    void refresh()
  }, [refresh])
  useEffect(() => {
    if (user) navigate('/', { replace: true })
  }, [user, navigate])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (isLogin) await login(email, password)
      else await register(email, password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <div className="mb-6 flex items-center gap-2 text-lg font-semibold">
        <Leaf className="size-7" /> FormFromFile
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{isLogin ? 'Sign in' : 'Create an account'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <Input
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              type="password"
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              placeholder={isLogin ? 'Password' : 'Password (min 10 chars)'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={isLogin ? undefined : 10}
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Working…' : isLogin ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          {isLogin ? (
            allowRegister ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Need an account?{' '}
                <Link className="text-primary underline" to="/register">
                  Register
                </Link>
              </p>
            ) : null
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link className="text-primary underline" to="/login">
                Sign in
              </Link>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
