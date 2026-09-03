import { diffValues, summarize, type Change } from '@/formflow_ext/diff'

const KIND_STYLE: Record<Change['kind'], string> = {
  changed: 'text-amber-600 dark:text-amber-400',
  added: 'text-primary',
  removed: 'text-destructive',
}

/** Value-level diff of two form value trees. */
export function DiffView({
  before,
  after,
  title = 'Changes',
  emptyText = 'No changes from the original.',
}: {
  before: unknown
  after: unknown
  title?: string
  emptyText?: string
}) {
  const changes = diffValues(before, after)
  if (changes.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyText}</p>
  }
  return (
    <div className="space-y-1 text-xs">
      <div className="font-semibold text-muted-foreground">
        {title} — {summarize(changes)}
      </div>
      <ul className="divide-y divide-border/50 rounded-md border border-border/60">
        {changes.map((c) => (
          <li key={c.path} className="flex flex-wrap items-baseline gap-x-2 px-2 py-1">
            <span className="font-mono text-[11px] text-muted-foreground">{c.path}</span>
            <span className={KIND_STYLE[c.kind]}>
              {c.kind === 'added' ? (
                <>+ {c.after}</>
              ) : c.kind === 'removed' ? (
                <>− {c.before}</>
              ) : (
                <>
                  <span className="line-through opacity-60">{c.before}</span> → {c.after}
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
