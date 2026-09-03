import type { FormatPlugin, ParsedFormat, Values } from './types'
import { fieldsFromValue, valueFromFields } from './tree'

const LINE = /^\s*([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)\s*$/

function unquote(v: string): string {
  const t = v.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }
  return t
}

function needsQuote(v: string): boolean {
  return /[\s#'"]/.test(v) || v === ''
}

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
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith('#')) continue
      const m = LINE.exec(line)
      if (m) map[m[1]] = unquote(m[2])
    }
    return { schema: { format: 'json', rootName: 'env', fields: fieldsFromValue(map) }, decoded: map }
  },

  render: (schema, values: Values): string => {
    const map = valueFromFields(schema.fields, values)
    return (
      Object.entries(map)
        .map(([k, v]) => {
          const s = v == null ? '' : String(v)
          return `${k}=${needsQuote(s) ? JSON.stringify(s) : s}`
        })
        .join('\n') + '\n'
    )
  },
}
