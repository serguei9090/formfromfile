/**
 * FormFromFile-only authoring metadata for a detected schema.
 *
 * The parser core (`web/src/core/form_flow/**`) is a verbatim copy from
 * InfraKit Studio and must stay untouched (see CLAUDE.md → "Keep the core in
 * sync"). Everything an author adds on top — labels, help, validation, which
 * nodes are locked boilerplate — lives here, keyed by the field's dotted path
 * so the core `SchemaField` shape never changes.
 *
 * Path form: `"Services.FTP.FTPPort"`. Array items use the *template* path with
 * no index (`"newToolUI.fields.field"`), because one `FieldMeta` describes
 * every item.
 */
import type { SchemaField } from '@/core/form_flow/schemaModel'

export type FieldPath = string

/**
 * How a `number`-typed leaf is serialized on export.
 * - `integer` / `decimal` — coerce to a JS number (current core behaviour).
 * - `string` — keep the raw text verbatim, so `"1.0"` or `"007"` survive a
 *   round trip instead of collapsing to `1` / `7`.
 */
export type NumberFormat = 'integer' | 'decimal' | 'string'

import type { Cond } from './rules'

export interface FieldMeta {
  /** Display label; falls back to the field key. */
  label?: string
  /** Author help text, shown as a `?` tooltip to the filler. */
  help?: string
  /** Show this field only when the condition holds (else hidden + skipped). */
  visibleWhen?: Cond
  /** Require this field only when the condition holds. */
  requiredWhen?: Cond
  /** `"${host}:${port}"` — read-only, evaluated from other fields at export. */
  computed?: string
  /** Async check: POST `{ value }` here on blur; expect `{ ok, message? }`. */
  checkUrl?: string
  /**
   * `false` = locked boilerplate: hidden from the filler, value still emitted
   * on export. Absent / `true` = the filler edits it.
   */
  editable?: boolean
  required?: boolean
  /** Raw regex source — the escape hatch. `preset` is the friendly surface. */
  pattern?: string
  patternMessage?: string
  /** Named validator id from `presets.ts` (F9). Wins over `pattern` in the UI. */
  preset?: string
  /** Non-empty → the field renders as a `<select>`. */
  enumValues?: string[]
  min?: number
  max?: number
  step?: number
  numberFormat?: NumberFormat
  multiline?: boolean
}

export type FieldMetaMap = Record<FieldPath, FieldMeta>

const SEP = '.'

export function childPath(parent: FieldPath, key: string): FieldPath {
  return parent ? `${parent}${SEP}${key}` : key
}

/** Every field path in a schema, document order, parents before children. */
export function walkPaths(fields: SchemaField[], parent: FieldPath = ''): FieldPath[] {
  const out: FieldPath[] = []
  for (const f of fields) {
    const p = childPath(parent, f.key)
    out.push(p)
    if (f.children.length > 0) out.push(...walkPaths(f.children, p))
  }
  return out
}

export function metaAt(map: FieldMetaMap, path: FieldPath): FieldMeta {
  return map[path] ?? {}
}

/** Immutable merge: returns a new map with `patch` applied at `path`. */
export function setMetaAt(
  map: FieldMetaMap,
  path: FieldPath,
  patch: Partial<FieldMeta>,
): FieldMetaMap {
  const next = { ...map }
  const merged = pruneMeta({ ...next[path], ...patch })
  if (Object.keys(merged).length === 0) delete next[path]
  else next[path] = merged
  return next
}

/** Drop meta for paths that no longer exist in the schema (after a retype). */
export function pruneMetaMap(map: FieldMetaMap, fields: SchemaField[]): FieldMetaMap {
  const valid = new Set(walkPaths(fields))
  const next: FieldMetaMap = {}
  for (const [p, m] of Object.entries(map)) {
    if (valid.has(p)) next[p] = m
  }
  return next
}

function pruneMeta(m: FieldMeta): FieldMeta {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(m)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = v
  }
  return out as FieldMeta
}
