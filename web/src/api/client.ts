/** Typed fetch wrapper for the FormFromFile backend. */
import { toast } from '@/app/toast'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    toast("Can't reach the server — check your connection.", 'error')
    throw new ApiError(0, 'network error')
  }

  let payload: unknown = null
  const text = await res.text()
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }

  if (res.status === 401 && onUnauthorized) onUnauthorized()

  if (!res.ok) {
    const msg =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `${res.status} ${res.statusText}`
    // 5xx is a server fault the user can't fix — surface it; 4xx is usually
    // handled by the calling component (validation, not-found, …).
    if (res.status >= 500) toast(`Server error: ${msg}`, 'error')
    throw new ApiError(res.status, msg)
  }
  return payload as T
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, body?: unknown) => request<T>('POST', p, body ?? {}),
  put: <T>(p: string, body?: unknown) => request<T>('PUT', p, body ?? {}),
  del: <T>(p: string) => request<T>('DELETE', p),
}
