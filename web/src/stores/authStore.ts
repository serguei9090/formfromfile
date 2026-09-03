import { create } from 'zustand'
import { api } from '@/api/client'
import type { User } from '@/api/types'

interface AuthState {
  user: User | null
  loading: boolean
  allowRegister: boolean
  refresh: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  allowRegister: true,

  refresh: async () => {
    try {
      const [me, cfg] = await Promise.all([
        api.get<{ user: User | null }>('/auth/me'),
        api.get<{ allowRegister: boolean }>('/config'),
      ])
      set({ user: me.user, allowRegister: cfg.allowRegister, loading: false })
    } catch {
      set({ user: null, loading: false })
    }
  },

  login: async (email, password) => {
    const { user } = await api.post<{ user: User }>('/auth/login', { email, password })
    set({ user })
  },

  register: async (email, password) => {
    const { user } = await api.post<{ user: User }>('/auth/register', { email, password })
    set({ user })
  },

  logout: async () => {
    await api.post('/auth/logout')
    set({ user: null })
  },
}))
