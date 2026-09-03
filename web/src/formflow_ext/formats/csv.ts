import Papa from 'papaparse'
import type { SchemaField } from '@/core/form_flow/schemaModel'
import { valueFromFields } from './tree'
import type { FormatPlugin, ParsedFormat, Values } from './types'

const ROWS_KEY = 'rows'

/**
 * CSV with a header row → an `array` field `rows` whose item template is one
 * object per column. Every cell is text (CSV has no types).
 */
export const csvPlugin: FormatPlugin = {
  id: 'csv',
  label: 'CSV',
  extensions: ['.csv', '.tsv'],
  detect: (raw) => {
    const r = Papa.parse<string[]>(raw.trim(), { skipEmptyLines: true })
    if (r.errors.length > 0 || r.data.length < 1) return false
    const width = r.data[0].length
    return width >= 2 && r.data.every((row) => row.length === width)
  },

  parse: (raw): ParsedFormat => {
    const r = Papa.parse<Record<string, string>>(raw.trim(), {
      header: true,
      skipEmptyLines: true,
    })
    const headers = r.meta.fields ?? []
    const template: SchemaField[] = headers.map((h) => ({
      key: h,
      type: 'text',
      defaultValue: '',
      children: [],
    }))
    const rowsField: SchemaField = { key: ROWS_KEY, type: 'array', children: template }
    return {
      schema: { format: 'json', rootName: 'csv', fields: [rowsField] },
      decoded: { [ROWS_KEY]: r.data },
    }
  },

  render: (schema, values: Values): string => {
    const map = valueFromFields(schema.fields, values)
    const rows = Array.isArray(map[ROWS_KEY]) ? (map[ROWS_KEY] as Record<string, unknown>[]) : []
    const rowsField = schema.fields.find((f) => f.key === ROWS_KEY)
    const headers = rowsField?.children.map((c) => c.key) ?? Object.keys(rows[0] ?? {})
    return Papa.unparse(
      rows.map((row) => Object.fromEntries(headers.map((h) => [h, row[h] ?? '']))),
      { columns: headers },
    )
  },
}
