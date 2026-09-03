/**
 * Structural value-tree diff — "what changed between the original and what you
 * filled in". Walks two values trees in parallel, scalars compared by their
 * string form. Arrays compared by index (add/remove at the tail is the common
 * case; a reordered array shows as several changes — acceptable).
 */
type Values = Record<string, unknown>

export interface Change {
  /** dotted path, array items indexed (`Services.hosts.1`). */
  path: string
  /** last path segment, for display. */
  label: string
  before: string | null
  after: string | null
  kind: 'added' | 'removed' | 'changed'
}

const str = (v: unknown): string => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const isObj = (v: unknown): v is Values => typeof v === 'object' && v !== null && !Array.isArray(v)

export function diffValues(before: unknown, after: unknown, path = ''): Change[] {
  const out: Change[] = []
  walk(before, after, path, out)
  return out
}

function walk(a: unknown, b: unknown, path: string, out: Change[]): void {
  if (isObj(a) || isObj(b)) {
    const ao = isObj(a) ? a : {}
    const bo = isObj(b) ? b : {}
    for (const key of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
      walk(ao[key], bo[key], path ? `${path}.${key}` : key, out)
    }
    return
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    const aa = Array.isArray(a) ? a : []
    const ba = Array.isArray(b) ? b : []
    for (let i = 0; i < Math.max(aa.length, ba.length); i++) {
      walk(aa[i], ba[i], `${path}.${i}`, out)
    }
    return
  }
  // scalars
  const sa = a === undefined ? null : str(a)
  const sb = b === undefined ? null : str(b)
  if (sa === sb) return
  out.push({
    path,
    label: path.split('.').pop() ?? path,
    before: sa,
    after: sb,
    kind: sa == null ? 'added' : sb == null ? 'removed' : 'changed',
  })
}

export function summarize(changes: Change[]): string {
  const c = changes.filter((x) => x.kind === 'changed').length
  const a = changes.filter((x) => x.kind === 'added').length
  const r = changes.filter((x) => x.kind === 'removed').length
  return [c && `${c} changed`, a && `${a} added`, r && `${r} removed`].filter(Boolean).join(' · ') || 'no changes'
}
