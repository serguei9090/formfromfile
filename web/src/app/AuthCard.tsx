import { Link } from 'react-router'
import { Leaf } from './Leaf'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/** Placeholder auth screen — wired to the Go backend in F2 / F4. */
export function AuthCard({ mode }: { mode: 'login' | 'register' }) {
  const isLogin = mode === 'login'
  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <div className="mb-6 flex items-center gap-2 text-lg font-semibold">
        <Leaf className="size-7" /> FormFromFile
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{isLogin ? 'Sign in' : 'Create an account'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>The multi-user auth flow (argon2id, sessions) is built in F2 and wired here in F4.</p>
          <p>
            {isLogin ? 'Need an account? ' : 'Already have an account? '}
            <Link className="text-primary underline" to={isLogin ? '/register' : '/login'}>
              {isLogin ? 'Register' : 'Sign in'}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
