/**
 * Structured conditions + cross-field rules. **No `eval`** — a `Cond` is a
 * small typed predicate the filler-side evaluates against the current values.
 *
 * `Cond` is either a leaf test (`{ path, op, value }`) or a combinator
 * (`{ all: Cond[] }` / `{ any: Cond[] }`). Paths are dotted field paths;
 * `getAt` resolves them against the rhf values tree (array items indexed).
 */
export type CondOp = 'eq' | 'ne' | 'in' | 'gt' | 'lt' | 'truthy' | 'empty'

export interface LeafCond {
  path: string
  op: CondOp
  value?: string | string[]
}
export type Cond = LeafCond | { all: Cond[] } | { any: Cond[] }

/** A named cross-field check surfaced as a form-level error when `when` holds. */
export interface Rule {
  id: string
  when: Cond
  message: string
}

type Values = Record<string, unknown>

export function getAt(values: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => {
    if (o == null) return undefined
    if (Array.isArray(o)) return o[Number(k)]
    return (o as Values)[k]
  }, values)
}

const str = (v: unknown): string => (v == null ? '' : String(v))

export function evalCond(cond: Cond | undefined, values: Values): boolean {
  if (!cond) return true
  if ('all' in cond) return cond.all.every((c) => evalCond(c, values))
  if ('any' in cond) return cond.any.some((c) => evalCond(c, values))

  const actual = getAt(values, cond.path)
  const a = str(actual)
  switch (cond.op) {
    case 'truthy':
      return actual === true || (a !== '' && a !== 'false' && a !== '0')
    case 'empty':
      return a.trim() === ''
    case 'eq':
      return a === str(cond.value)
    case 'ne':
      return a !== str(cond.value)
    case 'in':
      return Array.isArray(cond.value) ? cond.value.map(String).includes(a) : false
    case 'gt':
      return Number(a) > Number(cond.value)
    case 'lt':
      return Number(a) < Number(cond.value)
  }
}

/** Rules whose `when` currently holds — i.e. the checks that are failing. */
export function failingRules(rules: Rule[] | undefined, values: Values): Rule[] {
  if (!rules) return []
  return rules.filter((r) => evalCond(r.when, values))
}

const TOKEN = /\$\{([^}]+)\}/g

/** Evaluate a `computed` template like `"${host}:${port}"` against `values`. */
export function evalComputed(template: string, values: Values): string {
  return template.replace(TOKEN, (_, path: string) => str(getAt(values, path.trim())))
}

function setAt(target: Values, path: string, value: unknown): void {
  const parts = path.split('.')
  let node: Values = target
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]
    if (typeof node[k] !== 'object' || node[k] == null) node[k] = {}
    node = node[k] as Values
  }
  node[parts[parts.length - 1]] = value
}

/**
 * Return a copy of `values` with every `computed` field's meta path filled in
 * from its template — so the renderer emits the derived value, not a blank.
 */
export function withComputed(
  meta: Record<string, { computed?: string }>,
  values: Values,
): Values {
  const out = structuredClone(values)
  for (const [path, m] of Object.entries(meta)) {
    if (m.computed) setAt(out, path, evalComputed(m.computed, out))
  }
  return out
}
