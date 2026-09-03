/**
 * Build a form directly from a JSON Schema — declared types, `enum`, `pattern`,
 * `required`, `minimum`/`maximum` all map straight onto `SchemaField` +
 * `FieldMeta`, so there's no lossy content-based inference (review finding #8).
 *
 * Supported: object/array/string/number/integer/boolean, nested, `properties`,
 * `items`, `required`, `enum`, `pattern`, `minimum`, `maximum`, `description`,
 * `title`, `default`. `$ref`, `allOf`/`oneOf`, tuple `items` are not resolved.
 */
import type { FieldType, FormFlowSchema, SchemaField } from '@/core/form_flow/schemaModel'
import { childPath, setMetaAt, type FieldMetaMap } from '../fieldMeta'

interface JsonSchemaNode {
  type?: string | string[]
  properties?: Record<string, JsonSchemaNode>
  items?: JsonSchemaNode
  required?: string[]
  enum?: unknown[]
  pattern?: string
  minimum?: number
  maximum?: number
  title?: string
  description?: string
  default?: unknown
  $schema?: string
}

export function looksLikeJsonSchema(raw: string): boolean {
  try {
    const o = JSON.parse(raw) as JsonSchemaNode
    if (!o || typeof o !== 'object') return false
    return (
      typeof o.$schema === 'string' ||
      (nodeType(o) === 'object' && !!o.properties)
    )
  } catch {
    return false
  }
}

export interface ImportedSchema {
  schema: FormFlowSchema
  meta: FieldMetaMap
}

export function importJsonSchema(raw: string): ImportedSchema {
  const root = JSON.parse(raw) as JsonSchemaNode
  if (nodeType(root) !== 'object' || !root.properties) {
    throw new Error('JSON Schema root must be an object with properties')
  }
  const built = objectFields(root, '', {})
  return {
    schema: { format: 'json', rootName: root.title ?? 'root', fields: built.fields },
    meta: built.meta,
  }
}

interface Built {
  fields: SchemaField[]
  meta: FieldMetaMap
}

function objectFields(node: JsonSchemaNode, prefix: string, meta: FieldMetaMap): Built {
  const required = new Set(node.required ?? [])
  const fields: SchemaField[] = []
  let m = meta

  for (const [key, child] of Object.entries(node.properties ?? {})) {
    const path = childPath(prefix, key)
    const t = nodeType(child)

    const patch: Record<string, unknown> = {}
    if (child.title) patch.label = child.title
    if (child.description) patch.help = child.description
    if (required.has(key)) patch.required = true
    if (Array.isArray(child.enum)) patch.enumValues = child.enum.map(String)
    if (child.pattern) patch.pattern = child.pattern
    if (typeof child.minimum === 'number') patch.min = child.minimum
    if (typeof child.maximum === 'number') patch.max = child.maximum
    if (t === 'integer') patch.numberFormat = 'integer'
    if (Object.keys(patch).length > 0) m = setMetaAt(m, path, patch)

    if (t === 'object') {
      const sub = objectFields(child, path, m)
      m = sub.meta
      fields.push({ key, type: 'object', children: sub.fields })
    } else if (t === 'array') {
      const items = child.items ?? {}
      if (nodeType(items) === 'object') {
        const sub = objectFields(items, path, m)
        m = sub.meta
        fields.push({ key, type: 'array', children: sub.fields })
      } else {
        fields.push({
          key,
          type: 'array',
          children: [
            { key: 'value', type: fieldType(nodeType(items)), defaultValue: '', children: [] },
          ],
        })
      }
    } else {
      fields.push({
        key,
        type: fieldType(t),
        defaultValue: child.default != null ? String(child.default) : '',
        children: [],
      })
    }
  }
  return { fields, meta: m }
}

function nodeType(n: JsonSchemaNode): string {
  const t = Array.isArray(n.type) ? n.type.find((x) => x !== 'null') : n.type
  if (t) return t
  if (n.properties) return 'object'
  if (n.items) return 'array'
  return 'string'
}

function fieldType(t: string): FieldType {
  if (t === 'number' || t === 'integer') return 'number'
  if (t === 'boolean') return 'boolean'
  return 'text'
}
