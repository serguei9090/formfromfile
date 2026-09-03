/**
 * Order-preserving XML render (opt-in per template).
 *
 * `richXml.ts` re-emits comments at the top of their parent element because
 * fast-xml-parser's default mode isn't order-aware. This module renders through
 * `preserveOrder: true`, so a comment that sits *between* two elements stays
 * there. It's opt-in (`FormTemplate.xmlPreserveOrder`) because the ordered tree
 * is clumsier to mutate — arrays whose length changed are rebuilt from values
 * (any comment *inside* a repeated block is dropped; rare).
 *
 * Editing model: parse the source into the ordered node list, walk it in
 * parallel with `schema.fields` + `values`, overwrite only the scalars the form
 * owns, then rebuild.
 */
import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser'
import type { FormFlowSchema, SchemaField } from '@/core/form_flow/schemaModel'
import { isScalarArrayTemplate } from '@/core/form_flow/schemaModel'
import { smartScalar } from '../coerce'
import { ATTR_PREFIX, COMMENT_KEY, TEXT_KEY } from './richXml'

/** One node in fast-xml-parser's preserveOrder list. */
type Node = Record<string, unknown> & { ':@'?: Record<string, unknown> }
type Values = Record<string, unknown>

const PARSE_OPTS = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  commentPropName: COMMENT_KEY,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
} as const

const BUILD_OPTS = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  commentPropName: COMMENT_KEY,
  format: true,
  indentBy: '  ',
  suppressEmptyNode: true,
  suppressBooleanAttributes: false,
} as const

/** Heuristic: is there a comment sitting between two elements? */
export function xmlHasInterspersedComments(source: string): boolean {
  return /<[^!?][^>]*>\s*<!--[\s\S]*?-->\s*<[^!/?]/.test(source)
}

export function renderRichXmlOrdered(
  schema: FormFlowSchema,
  values: Values,
  source: string,
): string | null {
  if (XMLValidator.validate(source) !== true) return null
  const tree = new XMLParser(PARSE_OPTS).parse(source) as Node[]
  const root = tree.find((n) => {
    const k = tagOf(n)
    return k != null && !k.startsWith('?')
  })
  if (!root) return null

  applyElement(root, schema.fields, isObject(values) ? values : {})

  return new XMLBuilder(BUILD_OPTS).build(tree) as string
}

/** Apply `fields`/`values` to one element node (its attrs + its child list). */
function applyElement(node: Node, fields: SchemaField[], values: Values): void {
  const children = (node[tagOf(node)!] as Node[]) ?? []

  for (const f of fields) {
    if (f.key === COMMENT_KEY) continue
    const raw = values[f.key]

    if (f.key.startsWith(ATTR_PREFIX)) {
      node[':@'] = { ...(node[':@'] ?? {}), [f.key.slice(ATTR_PREFIX.length)]: stringLeaf(f, raw) }
      continue
    }
    if (f.key === TEXT_KEY) {
      setText(children, stringLeaf(f, raw))
      continue
    }
    if (f.type === 'object') {
      const child = firstTag(children, f.key)
      if (child) applyElement(child, f.children, isObject(raw) ? raw : {})
      continue
    }
    if (f.type === 'array') {
      rebuildArray(children, f, Array.isArray(raw) ? raw : [])
      continue
    }
    const child = firstTag(children, f.key)
    if (child) setText(child[f.key] as Node[], leafValue(f, raw))
  }
}

function rebuildArray(children: Node[], field: SchemaField, items: unknown[]): void {
  const scalar = isScalarArrayTemplate(field.children)
  let at = children.findIndex((n) => tagOf(n) === field.key)
  if (at < 0) at = children.length
  for (let i = children.length - 1; i >= 0; i--) {
    if (tagOf(children[i]) === field.key) children.splice(i, 1)
  }
  const built = items.map((item) => {
    const node: Node = { [field.key]: [] as Node[] }
    if (scalar) {
      ;(node[field.key] as Node[]).push({ [TEXT_KEY]: String(smartScalar(unwrap(item))) })
    } else {
      applyElement(node, field.children, isObject(item) ? item : {})
    }
    return node
  })
  children.splice(at, 0, ...built)
}

// --- helpers -----------------------------------------------------------------

function tagOf(node: Node): string | undefined {
  return Object.keys(node).find((k) => k !== ':@')
}

function firstTag(children: Node[], tag: string): Node | undefined {
  return children.find((n) => tagOf(n) === tag)
}

function setText(children: Node[], text: string): void {
  const t = children.find((n) => TEXT_KEY in n)
  if (t) t[TEXT_KEY] = text
  else children.push({ [TEXT_KEY]: text })
}

function leafValue(field: SchemaField, raw: unknown): string {
  if (field.type === 'boolean') {
    const b =
      typeof raw === 'boolean'
        ? raw
        : String(raw ?? field.defaultValue ?? 'false').toLowerCase() === 'true'
    return String(b)
  }
  if (field.type === 'number') return String(smartScalar(raw ?? field.defaultValue ?? ''))
  return raw != null ? String(raw) : (field.defaultValue ?? '')
}

function stringLeaf(field: SchemaField, raw: unknown): string {
  return raw != null ? String(raw) : (field.defaultValue ?? '')
}

function unwrap(item: unknown): unknown {
  return isObject(item) ? item.value : item
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
