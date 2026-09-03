import type { FieldType, SchemaField } from '@/core/form_flow/schemaModel'

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
