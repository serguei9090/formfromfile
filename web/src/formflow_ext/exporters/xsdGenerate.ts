/**
 * Best-effort `.xsd` generation from a detected schema — the reverse of
 * `importers/xsdSchema.ts`. Useful when a team has example config files but no
 * formal schema doc yet: detect from a sample, generate a starting `.xsd`,
 * hand-refine it (tighten enums, add patterns), then re-import for validation
 * that isn't guessed from a single example.
 *
 * Because it's derived from one sample, every field is emitted as optional
 * scalar/element shape — there's no way to know from a single instance
 * whether a field is required or what its full value range is. Attribute
 * fields (`@_x`, from the attribute-preserving XML parse) become
 * `<xs:attribute>`; `#text` and `#comment` passthrough fields are dropped.
 */
import type { FormFlowSchema, SchemaField } from '@/core/form_flow/schemaModel'
import { isScalarArrayTemplate } from '@/core/form_flow/schemaModel'
import { ATTR_PREFIX, COMMENT_KEY, TEXT_KEY } from '../xml/richXml'

const IND = '  '
function ind(level: number): string {
  return IND.repeat(level)
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function inferXsdType(field: SchemaField): string {
  if (field.type === 'boolean') return 'xs:boolean'
  if (field.type === 'number') {
    return /^-?\d+$/.test((field.defaultValue ?? '').trim()) ? 'xs:integer' : 'xs:decimal'
  }
  return 'xs:string'
}

function splitChildren(children: SchemaField[]): { attrs: SchemaField[]; elements: SchemaField[] } {
  const attrs: SchemaField[] = []
  const elements: SchemaField[] = []
  for (const c of children) {
    if (c.key === COMMENT_KEY || c.key === TEXT_KEY) continue
    if (c.key.startsWith(ATTR_PREFIX)) attrs.push(c)
    else elements.push(c)
  }
  return { attrs, elements }
}

function complexTypeBodyXml(children: SchemaField[], level: number): string {
  const { attrs, elements } = splitChildren(children)
  const lines: string[] = []
  if (elements.length > 0) {
    lines.push(`${ind(level)}<xs:sequence>`)
    for (const el of elements) lines.push(elementXml(el, level + 1))
    lines.push(`${ind(level)}</xs:sequence>`)
  }
  for (const a of attrs) {
    lines.push(
      `${ind(level)}<xs:attribute name="${escapeAttr(a.key.slice(ATTR_PREFIX.length))}" type="${inferXsdType(a)}"/>`,
    )
  }
  return lines.join('\n')
}

function elementXml(field: SchemaField, level: number): string {
  const name = escapeAttr(field.key)

  if (field.type === 'object') {
    return [
      `${ind(level)}<xs:element name="${name}">`,
      `${ind(level + 1)}<xs:complexType>`,
      complexTypeBodyXml(field.children, level + 2),
      `${ind(level + 1)}</xs:complexType>`,
      `${ind(level)}</xs:element>`,
    ].join('\n')
  }

  if (field.type === 'array') {
    const item = field.children[0]
    if (!item) {
      return `${ind(level)}<xs:element name="${name}" type="xs:string" minOccurs="0" maxOccurs="unbounded"/>`
    }
    if (isScalarArrayTemplate(field.children)) {
      return `${ind(level)}<xs:element name="${name}" type="${inferXsdType(item)}" minOccurs="0" maxOccurs="unbounded"/>`
    }
    return [
      `${ind(level)}<xs:element name="${name}" minOccurs="0" maxOccurs="unbounded">`,
      `${ind(level + 1)}<xs:complexType>`,
      complexTypeBodyXml(item.children, level + 2),
      `${ind(level + 1)}</xs:complexType>`,
      `${ind(level)}</xs:element>`,
    ].join('\n')
  }

  return `${ind(level)}<xs:element name="${name}" type="${inferXsdType(field)}"/>`
}

/** Generates a `.xsd` document describing `schema`'s shape. */
export function generateXsd(schema: FormFlowSchema): string {
  const rootName = escapeAttr(schema.rootName)
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">',
    `${ind(1)}<xs:element name="${rootName}">`,
    `${ind(2)}<xs:complexType>`,
    complexTypeBodyXml(schema.fields, 3),
    `${ind(2)}</xs:complexType>`,
    `${ind(1)}</xs:element>`,
    '</xs:schema>',
    '',
  ].join('\n')
}
