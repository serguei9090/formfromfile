import { LogOut, Moon, Sun, WifiOff } from 'lucide-react'
import { Link, Outlet, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/authStore'
import { Leaf } from './Leaf'
import { useApplyTheme, useThemeStore } from '@/stores/themeStore'

export function Shell() {
  useApplyTheme()
  const theme = useThemeStore((s) => s.theme)
  const toggle = useThemeStore((s) => s.toggle)
  const user = useAuthStore((s) => s.user)
  const offline = useAuthStore((s) => s.offline)
  const refresh = useAuthStore((s) => s.refresh)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  async function signOut() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border/60 bg-background/80 px-5 backdrop-blur">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <Leaf className="size-6" />
          FormFromFile
        </Link>
        <div className="flex-1" />
        {user ? <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span> : null}
        {user?.role === 'admin' ? (
          <Link to="/admin" className="text-sm text-muted-foreground hover:text-foreground">
            Users
          </Link>
        ) : null}
        <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
        <Button variant="ghost" size="sm" onClick={signOut}>
          <LogOut className="size-4" /> Sign out
        </Button>
      </header>
      {offline ? (
        <div
          role="alert"
          className="flex items-center justify-center gap-2 bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          <WifiOff className="size-4" />
          Can&apos;t reach the server.
          <button className="underline" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      ) : null}
      <main className="mx-auto w-full max-w-5xl flex-1 p-6">
        <Outlet />
      </main>
      <footer className="border-t border-border/60 px-5 py-3 text-center text-xs text-muted-foreground">
        FormFromFile · MIT · spun out of InfraKit Studio's FormFlow ·{' '}
        <a
          href="https://github.com/serguei9090/formfromfile"
          className="underline"
          target="_blank"
          rel="noreferrer"
        >
          source
        </a>
      </footer>
    </div>
  )
}
