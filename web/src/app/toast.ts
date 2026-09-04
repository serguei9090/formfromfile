export type ToastKind = 'error' | 'info' | 'success'
export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

type Listener = (toasts: Toast[]) => void

let toasts: Toast[] = []
const listeners = new Set<Listener>()
let seq = 0

function emit() {
  for (const l of listeners) l(toasts)
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function currentToasts(): Toast[] {
  return toasts
}

/** Show a transient toast. Errors linger longer. */
export function toast(message: string, kind: ToastKind = 'info') {
  const id = ++seq
  toasts = [...toasts, { id, kind, message }]
  emit()
  setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 4000)
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

/** Wire browser-level errors to a toast. Call once at app start. */
export function installGlobalErrorToasts() {
  window.addEventListener('error', (e) => {
    if (e.message) toast(`Something went wrong: ${e.message}`, 'error')
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string } | string | undefined
    const msg =
      typeof r === 'object' && r?.message
        ? r.message
        : typeof r === 'string'
          ? r
          : 'Unexpected error'
    toast(msg, 'error')
  })
}
