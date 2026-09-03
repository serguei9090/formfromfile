import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Plus, X } from 'lucide-react'
import type { CondOp, LeafCond, Rule } from '@/formflow_ext/rules'

const OPS: CondOp[] = ['eq', 'ne', 'in', 'gt', 'lt', 'truthy', 'empty']

/** Authoring for form-level cross-field checks. Each rule fails (shows its
 * message, blocks export) when its single condition holds. */
export function RulesEditor({
  rules,
  paths,
  onChange,
}: {
  rules: Rule[]
  paths: string[]
  onChange: (rules: Rule[]) => void
}) {
  function set(i: number, patch: Partial<Rule>) {
    onChange(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function setCond(i: number, patch: Partial<LeafCond>) {
    const cur = (rules[i].when as LeafCond) ?? { path: paths[0] ?? '', op: 'eq' }
    set(i, { when: { ...cur, ...patch } })
  }

  return (
    <div className="space-y-2">
      {rules.map((r, i) => {
        const c = r.when as LeafCond
        return (
          <div key={r.id} className="space-y-1 rounded-md border border-border/60 p-2 text-xs">
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">fail when</span>
              <Select value={c?.path ?? ''} onChange={(e) => setCond(i, { path: e.target.value })}>
                {paths.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
              <Select
                value={c?.op ?? 'eq'}
                onChange={(e) => setCond(i, { op: e.target.value as CondOp })}
              >
                {OPS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
              {c?.op !== 'truthy' && c?.op !== 'empty' ? (
                <Input
                  className="h-8 w-24"
                  value={typeof c?.value === 'string' ? c.value : ''}
                  placeholder="value"
                  onChange={(e) => setCond(i, { value: e.target.value })}
                />
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove rule"
                onClick={() => onChange(rules.filter((_, idx) => idx !== i))}
              >
                <X className="size-3.5" />
              </Button>
            </div>
            <Input
              className="h-8"
              value={r.message}
              placeholder="Message shown to the filler"
              onChange={(e) => set(i, { message: e.target.value })}
            />
          </div>
        )
      })}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([
            ...rules,
            {
              id: `r${Date.now().toString(36)}`,
              when: { path: paths[0] ?? '', op: 'eq', value: '' },
              message: '',
            },
          ])
        }
      >
        <Plus className="size-4" /> Add rule
      </Button>
    </div>
  )
}
