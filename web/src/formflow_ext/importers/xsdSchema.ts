/**
 * Build a form directly from an XML Schema (.xsd) — element names, declared
 * types, `minOccurs`/`maxOccurs`, and `xs:restriction` facets (`enumeration`,
 * `pattern`, `minInclusive`/`maxInclusive`) map straight onto `SchemaField` +
 * `FieldMeta`, the same trick `importers/jsonSchema.ts` uses for JSON Schema.
 *
 * The resulting schema is `format: 'xml'` — export renders through the normal
 * `renderRichXml` path.
 *
 * Supported: a single top-level `<xs:element>`, inline or named
 * `<xs:complexType>`, `<xs:sequence>`/`<xs:all>`/`<xs:choice>` element lists,
 * inline or named `<xs:simpleType>` restrictions (`enumeration`, `pattern`,
 * `minInclusive`, `maxInclusive`), `minOccurs`/`maxOccurs` (→ required /
 * array), and the common built-in XSD scalar types. Namespace prefixes on
 * tags/types are stripped and ignored — `xs:element`, `xsd:element`, and an
 * unprefixed `element` (default-namespace schemas) are all read the same way.
 *
 * Not supported (skipped rather than erroring): `xs:element ref="…"`,
 * `xs:group`/`xs:attributeGroup` indirection, `xs:extension`/`xs:restriction`
 * of complex types (inheritance), `xs:any`, imported/included schemas.
 */
import { XMLParser } from 'fast-xml-parser'
import type { FieldType, FormFlowSchema, SchemaField } from '@/core/form_flow/schemaModel'
import { childPath, setMetaAt, type FieldMetaMap } from '../fieldMeta'

const PARSE_OPTS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
} as const

export function looksLikeXsdSchema(raw: string): boolean {
  const t = raw.trimStart()
  if (!t.startsWith('<')) return false
  return (
    /xmlns(:\w+)?\s*=\s*["']http:\/\/www\.w3\.org\/2001\/XMLSchema["']/.test(t) &&
    /<[\w.-]*:?schema[\s>]/.test(t)
  )
}

export interface ImportedXsd {
  schema: FormFlowSchema
  meta: FieldMetaMap
}

type Node = Record<string, unknown>

/** One tag under a parsed node, namespace prefix stripped. */
interface Child {
  tag: string
  node: Node
}

function localName(key: string): string {
  const i = key.indexOf(':')
  return i < 0 ? key : key.slice(i + 1)
}

/** Every child element of a decoded node — flattens fast-xml-parser's
 *  single-object-vs-array inconsistency so callers don't have to care. */
function childrenOf(node: unknown): Child[] {
  if (!node || typeof node !== 'object') return []
  const out: Child[] = []
  for (const [k, v] of Object.entries(node as Node)) {
    if (k.startsWith('@_') || k === '#text') continue
    const tag = localName(k)
    if (Array.isArray(v)) {
      for (const item of v) if (item && typeof item === 'object') out.push({ tag, node: item as Node })
    } else if (v && typeof v === 'object') {
      out.push({ tag, node: v as Node })
    }
  }
  return out
}

function attr(node: Node, name: string): string | undefined {
  const v = node['@_' + name]
  return typeof v === 'string' ? v : undefined
}

const NUMBER_TYPES = new Set([
  'int', 'integer', 'long', 'short', 'byte', 'decimal', 'float', 'double',
  'nonNegativeInteger', 'positiveInteger', 'negativeInteger', 'nonPositiveInteger',
  'unsignedInt', 'unsignedLong', 'unsignedShort', 'unsignedByte',
])

function builtinFieldType(local: string): FieldType {
  if (local === 'boolean') return 'boolean'
  if (NUMBER_TYPES.has(local)) return 'number'
  return 'text'
}

interface Restriction {
  fieldType: FieldType
  enumValues?: string[]
  pattern?: string
  min?: number
  max?: number
}

function resolveSimpleType(stNode: Node): Restriction {
  const restriction = childrenOf(stNode).find((c) => c.tag === 'restriction')
  if (!restriction) return { fieldType: 'text' }
  const base = attr(restriction.node, 'base') ?? 'xs:string'
  const fieldType = builtinFieldType(localName(base))
  const kids = childrenOf(restriction.node)
  const enumValues = kids
    .filter((c) => c.tag === 'enumeration')
    .map((c) => attr(c.node, 'value'))
    .filter((v): v is string => v !== undefined)
  const pattern = kids.find((c) => c.tag === 'pattern')
  const minNode = kids.find((c) => c.tag === 'minInclusive')
  const maxNode = kids.find((c) => c.tag === 'maxInclusive')
  const min = minNode ? Number(attr(minNode.node, 'value')) : undefined
  const max = maxNode ? Number(attr(maxNode.node, 'value')) : undefined
  return {
    fieldType,
    enumValues: enumValues.length ? enumValues : undefined,
    pattern: pattern ? attr(pattern.node, 'value') : undefined,
    min: Number.isFinite(min) ? min : undefined,
    max: Number.isFinite(max) ? max : undefined,
  }
}

interface Ctx {
  complexTypes: Map<string, Node>
  simpleTypes: Map<string, Node>
}

/** What one `<xs:element>` resolves to: a nested object, or a scalar shape. */
type Shape = { kind: 'object'; complexTypeNode: Node } | ({ kind: 'scalar' } & Restriction)

function classifyElement(elNode: Node, ctx: Ctx): Shape {
  const inlineComplex = childrenOf(elNode).find((c) => c.tag === 'complexType')
  if (inlineComplex) return { kind: 'object', complexTypeNode: inlineComplex.node }

  const inlineSimple = childrenOf(elNode).find((c) => c.tag === 'simpleType')
  if (inlineSimple) return { kind: 'scalar', ...resolveSimpleType(inlineSimple.node) }

  const typeAttr = attr(elNode, 'type')
  if (typeAttr) {
    const local = localName(typeAttr)
    const ct = ctx.complexTypes.get(local)
    if (ct) return { kind: 'object', complexTypeNode: ct }
    const st = ctx.simpleTypes.get(local)
    if (st) return { kind: 'scalar', ...resolveSimpleType(st) }
    return { kind: 'scalar', fieldType: builtinFieldType(local) }
  }

  return { kind: 'scalar', fieldType: 'text' }
}

interface Built {
  fields: SchemaField[]
  meta: FieldMetaMap
}

/** `<xs:sequence>` / `<xs:all>` / `<xs:choice>` — a choice is treated like a
 *  sequence (every branch offered; the filler picks by leaving fields blank). */
function complexTypeFields(ctNode: Node, prefix: string, meta: FieldMetaMap, ctx: Ctx): Built {
  const container = childrenOf(ctNode).find((c) => c.tag === 'sequence' || c.tag === 'all' || c.tag === 'choice')
  const elements = container ? childrenOf(container.node).filter((c) => c.tag === 'element') : []

  const fields: SchemaField[] = []
  let m = meta

  for (const { node: elNode } of elements) {
    const key = attr(elNode, 'name')
    if (!key) continue // `ref="…"` indirection — not resolved, skip

    const path = childPath(prefix, key)
    const minOccurs = attr(elNode, 'minOccurs')
    const maxOccurs = attr(elNode, 'maxOccurs')
    const required = minOccurs === undefined || Number(minOccurs) > 0
    const isArray = maxOccurs === 'unbounded' || (maxOccurs !== undefined && Number(maxOccurs) > 1)

    const shape = classifyElement(elNode, ctx)

    if (shape.kind === 'object') {
      const sub = complexTypeFields(shape.complexTypeNode, path, m, ctx)
      m = sub.meta
      if (required) m = setMetaAt(m, path, { required: true })
      fields.push({ key, type: isArray ? 'array' : 'object', children: sub.fields })
      continue
    }

    const patch: Record<string, unknown> = {}
    if (required) patch.required = true
    if (shape.enumValues) patch.enumValues = shape.enumValues
    if (shape.pattern) patch.pattern = shape.pattern
    if (typeof shape.min === 'number') patch.min = shape.min
    if (typeof shape.max === 'number') patch.max = shape.max
    if (Object.keys(patch).length > 0) m = setMetaAt(m, path, patch)

    if (isArray) {
      fields.push({
        key,
        type: 'array',
        children: [{ key: 'value', type: shape.fieldType, defaultValue: '', children: [] }],
      })
    } else {
      fields.push({ key, type: shape.fieldType, defaultValue: '', children: [] })
    }
  }
  return { fields, meta: m }
}

export function importXsdSchema(raw: string): ImportedXsd {
  const doc = new XMLParser(PARSE_OPTS).parse(raw) as Node
  const schemaEntry = childrenOf(doc).find((c) => c.tag === 'schema')
  if (!schemaEntry) throw new Error('Not a valid XML Schema (no <xs:schema> root found)')
  const schemaNode = schemaEntry.node

  const ctx: Ctx = { complexTypes: new Map(), simpleTypes: new Map() }
  for (const { tag, node } of childrenOf(schemaNode)) {
    const name = attr(node, 'name')
    if (!name) continue
    if (tag === 'complexType') ctx.complexTypes.set(name, node)
    if (tag === 'simpleType') ctx.simpleTypes.set(name, node)
  }

  const topElement = childrenOf(schemaNode).find((c) => c.tag === 'element')
  if (!topElement) throw new Error('No top-level <xs:element> found — nothing to build a form from')

  const rootName = attr(topElement.node, 'name') ?? 'root'
  const shape = classifyElement(topElement.node, ctx)
  const built: Built =
    shape.kind === 'object'
      ? complexTypeFields(shape.complexTypeNode, '', {}, ctx)
      : { fields: [], meta: {} }

  return { schema: { format: 'xml', rootName, fields: built.fields }, meta: built.meta }
}
