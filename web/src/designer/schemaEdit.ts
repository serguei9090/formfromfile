import { isScalarArrayTemplate, type FieldType, type SchemaField } from '@/core/form_flow/schemaModel'

type Values = Record<string, unknown>

/**
 * Re-seed a values tree for `fields`, keeping any current value that still fits
 * its field's type. Used after a retype so only the branch that changed shape
 * loses its entered data (the rest is preserved).
 */
export function reseedPreserving(fields: SchemaField[], current: unknown): Values {
  const cur = isObject(current) ? current : {}
  const out: Values = {}
  for (const f of fields) out[f.key] = valueFor(f, cur[f.key])
  return out
}

function valueFor(f: SchemaField, v: unknown): unknown {
  switch (f.type) {
    case 'object':
      return reseedPreserving(f.children, v)
    case 'array': {
      if (f.children.length === 0) return []
      const scalar = isScalarArrayTemplate(f.children)
      const arr = Array.isArray(v) ? v : []
      if (arr.length === 0) return [scalar ? { value: '' } : reseedPreserving(f.children, {})]
      return arr.map((it) =>
        scalar
          ? { value: isObject(it) ? String(it.value ?? '') : String(it ?? '') }
          : reseedPreserving(f.children, it),
      )
    }
    case 'boolean':
      if (typeof v === 'boolean') return v
      if (typeof v === 'string') return v.toLowerCase() === 'true'
      return String(f.defaultValue).toLowerCase() === 'true'
    case 'number': {
      if (typeof v === 'number') return v
      const n = Number(v)
      if (v != null && v !== '' && Number.isFinite(n)) return n
      return f.defaultValue ? Number(f.defaultValue) || 0 : 0
    }
    default:
      return v != null && typeof v !== 'object' ? String(v) : (f.defaultValue ?? '')
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Immutably set the type of the field at `path` (indices into nested children). */
export function setFieldTypeAt(fields: SchemaField[], path: number[], type: FieldType): SchemaField[] {
  if (path.length === 0) return fields
  const [i, ...rest] = path
  return fields.map((f, idx) => {
    if (idx !== i) return f
    if (rest.length > 0) return { ...f, children: setFieldTypeAt(f.children, rest, type) }
    return retypeField(f, type)
  })
}

function retypeField(f: SchemaField, type: FieldType): SchemaField {
  if (f.type === type) return f
  const base: SchemaField = { ...f, type }
  switch (type) {
    case 'object':
      return { ...base, children: f.children, defaultValue: undefined }
    case 'array':
      return {
        ...base,
        defaultValue: undefined,
        children:
          f.children.length > 0
            ? f.children
            : [{ key: 'value', type: f.type === 'object' ? 'text' : f.type, children: [] }],
      }
    default:
      // becoming a scalar leaf
      return { ...base, children: [] }
  }
}
