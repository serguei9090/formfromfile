/**
 * Build a form directly from a JSON Schema — declared types, `enum`, `pattern`,
 * `required`, `minimum`/`maximum` all map straight onto `SchemaField` +
 * `FieldMeta`, so there's no lossy content-based inference (review finding #8).
 *
 * Supported: object/array/string/number/integer/boolean, nested, `properties`,
 * `items`, `required`, `enum`, `pattern`, `minimum`, `maximum`, `description`,
 * `title`, `default`; local `$ref` (`#/$defs/…`, `#/definitions/…`), `allOf`
 * (merged), `oneOf`/`anyOf` of `const`s (→ enum). Tuple `items` and remote
 * `$ref` are not resolved.
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
  $ref?: string
  $defs?: Record<string, JsonSchemaNode>
  definitions?: Record<string, JsonSchemaNode>
  allOf?: JsonSchemaNode[]
  oneOf?: JsonSchemaNode[]
  anyOf?: JsonSchemaNode[]
  const?: unknown
}

/** Resolve local `$ref` / merge `allOf` / collapse `oneOf|anyOf` of consts. */
function resolve(node: JsonSchemaNode, root: JsonSchemaNode, seen = new Set<string>()): JsonSchemaNode {
  if (node.$ref && node.$ref.startsWith('#/') && !seen.has(node.$ref)) {
    seen.add(node.$ref)
    const parts = node.$ref.slice(2).split('/')
    let target: unknown = root
    for (const p of parts) target = (target as Record<string, unknown>)?.[p]
    if (target && typeof target === 'object') return resolve(target as JsonSchemaNode, root, seen)
  }
  if (node.allOf) {
    const merged: JsonSchemaNode = { type: 'object', properties: {}, required: [] }
    for (const sub of node.allOf) {
      const r = resolve(sub, root, seen)
      Object.assign(merged.properties!, r.properties)
      merged.required!.push(...(r.required ?? []))
      merged.title ??= r.title
      merged.description ??= r.description
    }
    return merged
  }
  const choice = node.oneOf ?? node.anyOf
  if (choice && choice.every((c) => 'const' in c)) {
    return { ...node, enum: choice.map((c) => c.const) }
  }
  return node
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
  const rawRoot = JSON.parse(raw) as JsonSchemaNode
  const root = resolve(rawRoot, rawRoot)
  if (nodeType(root) !== 'object' || !root.properties) {
    throw new Error('JSON Schema root must be an object with properties')
  }
  const built = objectFields(root, '', {}, rawRoot)
  return {
    schema: { format: 'json', rootName: root.title ?? 'root', fields: built.fields },
    meta: built.meta,
  }
}

interface Built {
  fields: SchemaField[]
  meta: FieldMetaMap
}

function objectFields(
  node: JsonSchemaNode,
  prefix: string,
  meta: FieldMetaMap,
  docRoot: JsonSchemaNode,
): Built {
  const required = new Set(node.required ?? [])
  const fields: SchemaField[] = []
  let m = meta

  for (const [key, rawChild] of Object.entries(node.properties ?? {})) {
    const child = resolve(rawChild, docRoot)
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
      const sub = objectFields(child, path, m, docRoot)
      m = sub.meta
      fields.push({ key, type: 'object', children: sub.fields })
    } else if (t === 'array') {
      const items = resolve(child.items ?? {}, docRoot)
      if (nodeType(items) === 'object') {
        const sub = objectFields(items, path, m, docRoot)
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
