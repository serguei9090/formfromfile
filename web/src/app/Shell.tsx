import { Moon, Sun } from 'lucide-react'
import { Link, Outlet } from 'react-router'
import { Button } from '@/components/ui/button'
import { Leaf } from './Leaf'
import { useApplyTheme, useThemeStore } from '@/stores/themeStore'

export function Shell() {
  useApplyTheme()
  const theme = useThemeStore((s) => s.theme)
  const toggle = useThemeStore((s) => s.toggle)

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border/60 bg-background/80 px-5 backdrop-blur">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <Leaf className="size-6" />
          FormFromFile
        </Link>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 p-6">
        <Outlet />
      </main>
    </div>
  )
}
