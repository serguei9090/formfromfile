import type { FormatPlugin, ParsedFormat, Values } from './types'
import { fieldsFromValue, valueFromFields } from './tree'

const LINE = /^\s*(export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*?)\s*$/

function unquote(v: string): string {
  const t = v.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }
  return t
}

function quoteIfNeeded(v: string): string {
  return /[\s#'"=]|^$/.test(v) ? JSON.stringify(v) : v
}

interface EnvLine {
  kind: 'pair' | 'other'
  raw: string
  export?: string
  key?: string
}

function scanLines(raw: string): EnvLine[] {
  return raw.split(/\r?\n/).map((line) => {
    if (line.trim() === '' || line.trim().startsWith('#')) return { kind: 'other', raw: line }
    const m = LINE.exec(line)
    return m ? { kind: 'pair', raw: line, export: m[1] ?? '', key: m[2] } : { kind: 'other', raw: line }
  })
}

/** `.env` — flat `KEY=value`. Comments, blank lines and key order are kept on
 * export; only the values change. */
export const dotenvPlugin: FormatPlugin = {
  id: 'dotenv',
  label: '.env',
  extensions: ['.env'],
  detect: (raw) => {
    const lines = raw.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'))
    return lines.length > 0 && lines.every((l) => LINE.test(l))
  },

  parse: (raw): ParsedFormat => {
    const map: Record<string, string> = {}
    for (const line of scanLines(raw)) {
      if (line.kind !== 'pair') continue
      const m = LINE.exec(line.raw)
      if (m) map[m[2]] = unquote(m[3])
    }
    return { schema: { format: 'json', rootName: 'env', fields: fieldsFromValue(map) }, decoded: map }
  },

  render: (schema, values: Values, source: string): string => {
    const map = valueFromFields(schema.fields, values)
    const emitted = new Set<string>()
    const out: string[] = []

    for (const line of scanLines(source)) {
      if (line.kind === 'pair' && line.key != null && line.key in map) {
        out.push(`${line.export ?? ''}${line.key}=${quoteIfNeeded(str(map[line.key]))}`)
        emitted.add(line.key)
      } else {
        out.push(line.raw)
      }
    }
    // keys the form added that weren't in the source
    for (const [k, v] of Object.entries(map)) {
      if (!emitted.has(k)) out.push(`${k}=${quoteIfNeeded(str(v))}`)
    }

    let text = out.join('\n')
    if (!text.endsWith('\n')) text += '\n'
    return text
  },
}

function str(v: unknown): string {
  return v == null ? '' : String(v)
}
