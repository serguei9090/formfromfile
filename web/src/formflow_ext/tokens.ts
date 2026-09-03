/**
 * Placeholder tokens — `%Name%`, `${host}`, `{{port}}` — found inside the
 * *values* of a parsed file. The ILS `instanceXML` block is exactly this
 * shape: a fixed skeleton with a few blanks the filler substitutes.
 *
 * `scanTokens` walks a values tree and returns one `TokenSpec` per unique
 * placeholder (with the paths it appears at). `applyTokens` does the literal
 * substitution on the rendered output, after the format's own renderer has
 * run, so it is format-agnostic.
 */
import type { TokenSpec } from './templateModel'

/** Supported placeholder styles. Each capture group 1 is the inner name. */
const TOKEN_PATTERNS: RegExp[] = [
  /%([^%\n]+)%/g,
  /\$\{([^}\n]+)\}/g,
  /\{\{([^}\n]+)\}\}/g,
]

export function scanTokens(values: unknown): TokenSpec[] {
  const found = new Map<string, TokenSpec>()
  walkStrings(values, '', (path, text) => {
    for (const re of TOKEN_PATTERNS) {
      for (const m of text.matchAll(re)) {
        const token = m[0]
        const spec = found.get(token) ?? { token, name: m[1].trim(), occurrences: [] }
        if (!spec.occurrences.includes(path)) spec.occurrences.push(path)
        found.set(token, spec)
      }
    }
  })
  return [...found.values()]
}

/** Replace every known token literally. Empty values are left as-is. */
export function applyTokens(rendered: string, tokenValues: Record<string, string>): string {
  let out = rendered
  for (const [token, value] of Object.entries(tokenValues)) {
    if (value === '' || value == null) continue
    out = out.split(token).join(value)
  }
  return out
}

/** Drop filled values whose token is no longer present (re-detect / retype). */
export function pruneTokenValues(
  tokenValues: Record<string, string>,
  tokens: TokenSpec[],
): Record<string, string> {
  const live = new Set(tokens.map((t) => t.token))
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(tokenValues)) if (live.has(k)) next[k] = v
  return next
}

function walkStrings(
  value: unknown,
  path: string,
  cb: (path: string, text: string) => void,
): void {
  if (typeof value === 'string') {
    cb(path, value)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => walkStrings(item, `${path}[${i}]`, cb))
    return
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      walkStrings(v, path ? `${path}.${k}` : k, cb)
    }
  }
}
