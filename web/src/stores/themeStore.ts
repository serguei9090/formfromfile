import { useEffect } from 'react'
import { create } from 'zustand'

type Theme = 'light' | 'dark'

function initial(): Theme {
  try {
    const s = localStorage.getItem('fff:theme')
    if (s === 'light' || s === 'dark') return s
  } catch {
    /* private mode */
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

interface ThemeState {
  theme: Theme
  toggle: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initial(),
  toggle: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark'
    try {
      localStorage.setItem('fff:theme', next)
    } catch {
      /* ignore */
    }
    set({ theme: next })
  },
}))

/** Apply the `.dark` class to <html>. Call once near the root. */
export function useApplyTheme() {
  const theme = useThemeStore((s) => s.theme)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])
}
