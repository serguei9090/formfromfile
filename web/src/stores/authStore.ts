import { create } from 'zustand'
import { api, ApiError } from '@/api/client'
import type { FirebaseWebConfig, User } from '@/api/types'

interface AuthState {
  user: User | null
  loading: boolean
  allowRegister: boolean
  /** true when AI-assist endpoints are configured (FFF_ANTHROPIC_API_KEY set). */
  aiEnabled: boolean
  /** non-null when Firebase sign-in (Google) is configured server-side. */
  firebaseConfig: FirebaseWebConfig | null
  /** true when the last refresh failed for a non-auth reason (backend down). */
  offline: boolean
  refresh: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  loginWithFirebaseIdToken: (idToken: string) => Promise<void>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  allowRegister: true,
  aiEnabled: false,
  firebaseConfig: null,
  offline: false,

  refresh: async () => {
    try {
      const [me, cfg] = await Promise.all([
        api.get<{ user: User | null }>('/auth/me'),
        api.get<{ allowRegister: boolean; firebase?: FirebaseWebConfig }>('/config'),
      ])
      set({
        user: me.user,
        allowRegister: cfg.allowRegister,
        firebaseConfig: cfg.firebase ?? null,
        loading: false,
        offline: false,
      })
      if (me.user) {
        api
          .get<{ enabled: boolean }>('/ai/status')
          .then((s) => set({ aiEnabled: s.enabled }))
          .catch(() => {})
      }
    } catch (e) {
      // an ApiError means the server answered (e.g. 401) — that's not "offline";
      // a bare fetch failure (no status) means it's unreachable.
      set({ user: null, loading: false, offline: !(e instanceof ApiError) })
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

  loginWithFirebaseIdToken: async (idToken) => {
    const { user } = await api.post<{ user: User }>('/auth/firebase', { idToken })
    set({ user })
  },

  logout: async () => {
    await api.post('/auth/logout')
    set({ user: null })
  },
}))
