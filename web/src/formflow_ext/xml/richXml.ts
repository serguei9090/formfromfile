/**
 * Attribute- and comment-preserving XML parse/render for FormFromFile.
 *
 * The verbatim core parser (`core/form_flow/formFlowParser.ts`) sets
 * `ignoreAttributes: true` and drops the `<?xml …?>` declaration — fine for
 * InfraKit's inputs, lossy for real config templates like the ILS tool files
 * where `<field editor="…" name="…"/>` *is* the data. This module runs a
 * parallel parse with attributes + comments on and feeds the result through a
 * walker aligned with the core's, so the rest of the app is unchanged.
 *
 * Representation:
 * - an attribute `x="y"` becomes a leaf field keyed `@_x` (label `x`).
 * - mixed element text becomes a leaf field keyed `#text`.
 * - comments become passthrough leaf fields keyed `#comment` — rendered back
 *   out verbatim, filtered from the author/filler UI. Position is not
 *   preserved (fast-xml-parser is not order-aware in this mode); comments
 *   re-emit at the top of their parent element.
 *
 * Known: attribute order within an element follows the parser; namespaced
 * elements and CDATA are passed through as text.
 */
import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser'
import type { FieldType, FormFlowSchema, SchemaField } from '@/core/form_flow/schemaModel'
import { smartScalar } from '../coerce'

export const ATTR_PREFIX = '@_'
export const TEXT_KEY = '#text'
export const COMMENT_KEY = '#comment'

/** Keys that carry structure rather than user-facing fields. */
export function isStructuralKey(key: string): boolean {
  return key === COMMENT_KEY
}

const BOOL_PATTERN = /^(true|false)$/i
const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/

const PARSE_OPTS = {
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  commentPropName: COMMENT_KEY,
} as const

const BUILD_OPTS = {
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  format: true,
  indentBy: '  ',
  suppressEmptyNode: true,
  suppressBooleanAttributes: false,
  commentPropName: COMMENT_KEY,
} as const

const DECL_RE = /^\s*<\?xml[^>]*\?>/i

export interface RichXml {
  schema: FormFlowSchema
  /** Values tree seeded from the source — array fields get one item per source occurrence. */
  seed: Record<string, unknown>
}

/** Returns `null` when the input isn't valid XML (caller falls back to the core parser). */
export function parseRichXml(raw: string): RichXml | null {
  if (XMLValidator.validate(raw) !== true) return null
  const decoded = new XMLParser(PARSE_OPTS).parse(raw) as Record<string, unknown>
  const entries = Object.entries(decoded).filter(([k]) => !k.startsWith('?') && k !== COMMENT_KEY)
  if (entries.length !== 1) return null
  const [rootName, rootValue] = entries[0]
  const rootMap = isObject(rootValue) ? rootValue : {}
  return {
    schema: { format: 'xml', rootName, fields: fieldsFromMap(rootMap) },
    seed: seedFromMap(fieldsFromMap(rootMap), rootMap),
  }
}

/** Serialize a values tree back to XML, preserving the source's declaration + header comments. */
export function renderRichXml(
  schema: FormFlowSchema,
  values: Record<string, unknown>,
  source: string,
): string {
  const map = mapFromFields(schema.fields, values)
  const body = new XMLBuilder(BUILD_OPTS).build({ [schema.rootName]: map }) as string
  const decl = DECL_RE.exec(source)?.[0]?.trim() ?? '<?xml version="1.0" encoding="UTF-8"?>'
  const header = leadingComments(source)
  return [decl, ...header, body.replace(/^\s*<\?xml[^>]*\?>\s*/i, '').replace(/^\n/, '')]
    .join('\n')
}

/** `<!-- … -->` blocks between the declaration and the root element. */
function leadingComments(source: string): string[] {
  const afterDecl = source.replace(DECL_RE, '')
  const head = afterDecl.slice(0, Math.max(0, afterDecl.search(/<[^!?]/)))
  return head.match(/<!--[\s\S]*?-->/g) ?? []
}

// --- walker: decoded map -> SchemaField[] (aligned with core semantics) -----

function fieldsFromMap(map: Record<string, unknown>): SchemaField[] {
  return Object.entries(map).map(([key, value]) => fieldFromKeyValue(key, value))
}

function fieldFromKeyValue(key: string, value: unknown): SchemaField {
  if (key === COMMENT_KEY) {
    // Passthrough: keep the comment text(s) so render can re-emit them.
    return Array.isArray(value)
      ? { key, type: 'array', label: 'comment', children: [leaf('value', String(value[0] ?? ''))] }
      : leaf(key, value, 'comment')
  }
  if (isObject(value)) return { key, type: 'object', label: attrLabel(key), children: fieldsFromMap(value) }
  if (Array.isArray(value)) return arrayField(key, value)
  return leaf(key, value, attrLabel(key))
}

function arrayField(key: string, list: unknown[]): SchemaField {
  if (list.length === 0) return { key, type: 'array', children: [] }
  const first = list[0]
  if (isObject(first)) return { key, type: 'array', children: fieldsFromMap(first) }
  return { key, type: 'array', children: [leaf('value', first)] }
}

function leaf(key: string, value: unknown, label?: string): SchemaField {
  const f: SchemaField = { key, type: inferType(value), defaultValue: str(value), children: [] }
  if (label && label !== key) f.label = label
  return f
}

function attrLabel(key: string): string {
  if (key === TEXT_KEY) return 'text'
  return key.startsWith(ATTR_PREFIX) ? key.slice(ATTR_PREFIX.length) : key
}

function inferType(raw: unknown): FieldType {
  if (typeof raw === 'boolean') return 'boolean'
  if (typeof raw === 'number') return 'number'
  const t = raw == null ? '' : String(raw)
  if (BOOL_PATTERN.test(t)) return 'boolean'
  if (NUMBER_PATTERN.test(t)) return 'number'
  return 'text'
}

// --- seed: one array item per source occurrence (fixes single-item seeding) --

function seedFromMap(fields: SchemaField[], map: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) out[f.key] = seedForField(f, map[f.key])
  return out
}

function seedForField(field: SchemaField, raw: unknown): unknown {
  switch (field.type) {
    case 'object':
      return seedFromMap(field.children, isObject(raw) ? raw : {})
    case 'array': {
      const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
      const scalar = field.children.length === 1 && field.children[0].key === 'value'
      if (list.length === 0) return field.children.length === 0 ? [] : [seedFromMap(field.children, {})]
      return list.map((item) =>
        scalar
          ? { value: str(item) }
          : seedFromMap(field.children, isObject(item) ? item : {}),
      )
    }
    case 'boolean': {
      const t = raw != null ? String(raw) : (field.defaultValue ?? '')
      return t.toLowerCase() === 'true'
    }
    default:
      return raw != null ? String(raw) : (field.defaultValue ?? '')
  }
}

// --- render: SchemaField[] + values -> decoded map -------------------------

function mapFromFields(fields: SchemaField[], values: Record<string, unknown>): Record<string, unknown> {
  const map: Record<string, unknown> = {}
  for (const f of fields) map[f.key] = valueForField(f, values[f.key])
  return map
}

function valueForField(field: SchemaField, raw: unknown): unknown {
  switch (field.type) {
    case 'object':
      return mapFromFields(field.children, isObject(raw) ? raw : {})
    case 'array': {
      const items = Array.isArray(raw) ? raw : []
      const scalar = field.children.length === 1 && field.children[0].key === 'value'
      if (scalar) {
        return items.map((it) => (isObject(it) ? str(it.value) : str(it)))
      }
      return items.map((it) => mapFromFields(field.children, isObject(it) ? it : {}))
    }
    case 'boolean':
      return coerceBool(raw, field.defaultValue)
    case 'number':
      return smartScalar(raw ?? field.defaultValue ?? '')
    default:
      return raw?.toString() ?? field.defaultValue ?? ''
  }
}

function coerceBool(raw: unknown, fallback?: string): boolean {
  if (typeof raw === 'boolean') return raw
  return (raw?.toString() ?? fallback ?? 'false').toLowerCase() === 'true'
}

function str(raw: unknown): string {
  return raw == null ? '' : String(raw)
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
