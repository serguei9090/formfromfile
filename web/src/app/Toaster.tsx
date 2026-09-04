import { useEffect, useState } from 'react'
import { currentToasts, dismiss, subscribe, type Toast } from './toast'

/** Mount once (main.tsx). Renders the toast stack bottom-right. */
export function Toaster() {
  const [items, setItems] = useState<Toast[]>(currentToasts())
  useEffect(() => subscribe(setItems), [])

  if (items.length === 0) return null
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[90vw] flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto flex items-start gap-2 rounded-md border p-3 text-sm shadow-lg ${
            t.kind === 'error'
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : t.kind === 'success'
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border bg-card text-foreground'
          }`}
        >
          <span className="min-w-0 flex-1 break-words">{t.message}</span>
          <button
            className="shrink-0 opacity-60 hover:opacity-100"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
