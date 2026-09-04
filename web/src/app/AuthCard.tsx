import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/stores/authStore'
import { signInWithGoogle } from './firebase'
import { Leaf } from './Leaf'

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="size-4" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.85.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.94v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.94A9 9 0 0 0 0 9c0 1.45.35 2.83.94 4.05l3.03-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .94 4.95l3.03 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  )
}

export function AuthCard({ mode }: { mode: 'login' | 'register' }) {
  const isLogin = mode === 'login'
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const register = useAuthStore((s) => s.register)
  const loginWithFirebaseIdToken = useAuthStore((s) => s.loginWithFirebaseIdToken)
  const refresh = useAuthStore((s) => s.refresh)
  const allowRegister = useAuthStore((s) => s.allowRegister)
  const firebaseConfig = useAuthStore((s) => s.firebaseConfig)
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
  const [googleBusy, setGoogleBusy] = useState(false)
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

  async function googleSignIn() {
    if (!firebaseConfig) return
    setGoogleBusy(true)
    setError('')
    try {
      const idToken = await signInWithGoogle(firebaseConfig)
      await loginWithFirebaseIdToken(idToken)
      navigate('/', { replace: true })
    } catch (err) {
      const code = (err as { code?: string })?.code
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        // silent — the user just closed the popup, not an error worth surfacing
      } else if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError('Google sign-in failed — try again.')
      }
    } finally {
      setGoogleBusy(false)
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

          {firebaseConfig ? (
            <>
              <div className="my-4 flex items-center gap-2 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                or
                <div className="h-px flex-1 bg-border" />
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                disabled={googleBusy}
                onClick={() => void googleSignIn()}
              >
                <GoogleMark /> {googleBusy ? 'Opening Google…' : 'Continue with Google'}
              </Button>
            </>
          ) : null}

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
