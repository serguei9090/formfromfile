/**
 * Generic value-tree <-> `SchemaField[]` walker, mirroring the core parser's
 * semantics (content-based type inference, first-occurrence array templates,
 * `{value:…}` scalar-array wrapper). Shared by the non-core format plugins so
 * each only has to turn its text into / out of a plain JS object.
 */
import {
  SCALAR_ARRAY_ITEM_KEY,
  isScalarArrayTemplate,
  type FieldType,
  type SchemaField,
} from '@/core/form_flow/schemaModel'
import { smartScalar } from '../coerce'

const BOOL = /^(true|false)$/i
const NUM = /^-?\d+(\.\d+)?$/

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function fieldsFromValue(map: Record<string, unknown>): SchemaField[] {
  return Object.entries(map).map(([k, v]) => fieldFrom(k, v))
}

function fieldFrom(key: string, value: unknown): SchemaField {
  if (isObject(value)) return { key, type: 'object', children: fieldsFromValue(value) }
  if (Array.isArray(value)) {
    if (value.length === 0) return { key, type: 'array', children: [] }
    const first = value[0]
    return isObject(first)
      ? { key, type: 'array', children: fieldsFromValue(first) }
      : { key, type: 'array', children: [leaf(SCALAR_ARRAY_ITEM_KEY, first)] }
  }
  return leaf(key, value)
}

function leaf(key: string, value: unknown): SchemaField {
  return { key, type: inferType(value), defaultValue: str(value), children: [] }
}

function inferType(raw: unknown): FieldType {
  if (typeof raw === 'boolean') return 'boolean'
  if (typeof raw === 'number') return 'number'
  const t = str(raw)
  if (BOOL.test(t)) return 'boolean'
  if (NUM.test(t)) return 'number'
  return 'text'
}

function str(raw: unknown): string {
  return raw == null ? '' : String(raw)
}

export function valueFromFields(
  fields: SchemaField[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) out[f.key] = valueFor(f, values[f.key])
  return out
}

function valueFor(field: SchemaField, raw: unknown): unknown {
  switch (field.type) {
    case 'object':
      return valueFromFields(field.children, isObject(raw) ? raw : {})
    case 'array': {
      const items = Array.isArray(raw) ? raw : []
      if (isScalarArrayTemplate(field.children)) {
        return items.map((it) => (isObject(it) ? it[SCALAR_ARRAY_ITEM_KEY] : it))
      }
      return items.map((it) => valueFromFields(field.children, isObject(it) ? it : {}))
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw
      return (str(raw) || field.defaultValue || 'false').toLowerCase() === 'true'
    }
    case 'number':
      return smartScalar(raw ?? field.defaultValue ?? '')
    default:
      return raw != null ? String(raw) : (field.defaultValue ?? '')
  }
}

/** Seed a values tree from a decoded source — one array item per occurrence. */
export function seedFromValue(
  fields: SchemaField[],
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) out[f.key] = seedFor(f, source[f.key])
  return out
}

function seedFor(field: SchemaField, raw: unknown): unknown {
  switch (field.type) {
    case 'object':
      return seedFromValue(field.children, isObject(raw) ? raw : {})
    case 'array': {
      if (field.children.length === 0) return []
      const scalar = isScalarArrayTemplate(field.children)
      const list = Array.isArray(raw) ? raw : []
      if (list.length === 0) return [scalar ? { value: '' } : seedFromValue(field.children, {})]
      return list.map((it) =>
        scalar
          ? { value: isObject(it) ? String(it.value ?? '') : String(it ?? '') }
          : seedFromValue(field.children, isObject(it) ? it : {}),
      )
    }
    case 'boolean':
      return raw != null ? String(raw).toLowerCase() === 'true' : field.defaultValue?.toLowerCase() === 'true'
    default:
      return raw != null ? String(raw) : (field.defaultValue ?? '')
  }
}
