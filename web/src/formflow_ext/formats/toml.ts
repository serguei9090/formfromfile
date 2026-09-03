import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { fieldsFromValue, isObject, valueFromFields } from './tree'
import type { FormatPlugin, ParsedFormat, Values } from './types'

export const tomlPlugin: FormatPlugin = {
  id: 'toml',
  label: 'TOML',
  extensions: ['.toml'],
  detect: (raw) => {
    try {
      const v = parseToml(raw)
      // A bare string / number parses in YAML but not TOML; require a table.
      return isObject(v) && Object.keys(v).length > 0
    } catch {
      return false
    }
  },

  parse: (raw): ParsedFormat => {
    const decoded = parseToml(raw)
    if (!isObject(decoded)) throw new Error('TOML root must be a table')
    const safe = jsonSafe(decoded)
    return { schema: { format: 'json', rootName: 'root', fields: fieldsFromValue(safe) }, decoded: safe }
  },

  render: (schema, values: Values): string => {
    const map = valueFromFields(schema.fields, values)
    return stringifyToml(map as Record<string, unknown>)
  },
}

/** smol-toml returns Date / bigint for some values — flatten to JSON-ish. */
function jsonSafe(v: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === 'bigint' ? Number(val) : val)))
}
