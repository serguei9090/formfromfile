/**
 * Comment- and order-preserving YAML for FormFromFile.
 *
 * The verbatim core parser renders YAML with js-yaml's `dump`, which throws
 * away comments and can reorder keys — fine for InfraKit's generated files,
 * lossy for a hand-written `docker-compose.yml` or CI config. This layer edits
 * the source document in place (via the `yaml` package's `Document` API), so
 * comments, key order and formatting survive; only the scalar leaves the form
 * controls are rewritten.
 *
 * Array handling: a sequence the form changed is replaced wholesale (per-item
 * comments inside a list are rare and not worth the complexity). Keys present
 * in the source but not in the schema are left untouched — the form only owns
 * what it detected.
 */
import { parseDocument, type Document } from 'yaml'
import type { FormFlowSchema, SchemaField } from '@/core/form_flow/schemaModel'
import { isScalarArrayTemplate } from '@/core/form_flow/schemaModel'
import { fieldsFromValue, isObject, seedFromValue } from '../formats/tree'
import { smartScalar } from '../coerce'

export interface RichYaml {
  schema: FormFlowSchema
  seed: Record<string, unknown>
}

/** Returns `null` when `raw` isn't a YAML mapping (caller falls back). */
export function parseRichYaml(raw: string): RichYaml | null {
  let js: unknown
  try {
    js = parseDocument(raw, { prettyErrors: true }).toJS()
  } catch {
    return null
  }
  if (!isObject(js)) return null
  const fields = fieldsFromValue(js)
  return { schema: { format: 'yaml', rootName: 'root', fields }, seed: seedFromValue(fields, js) }
}

export function renderRichYaml(
  schema: FormFlowSchema,
  values: Record<string, unknown>,
  source: string,
): string {
  const doc = source.trim() ? parseDocument(source) : parseDocument('{}')
  applyFields(doc, [], schema.fields, isObject(values) ? values : {})
  return String(doc)
}

function applyFields(
  doc: Document,
  path: (string | number)[],
  fields: SchemaField[],
  values: Record<string, unknown>,
): void {
  for (const f of fields) {
    const here = [...path, f.key]
    const raw = values[f.key]

    if (f.type === 'object') {
      if (doc.getIn(here) == null) doc.setIn(here, {})
      applyFields(doc, here, f.children, isObject(raw) ? raw : {})
      continue
    }

    if (f.type === 'array') {
      const items = Array.isArray(raw) ? raw : []
      const scalar = isScalarArrayTemplate(f.children)
      const out = scalar
        ? items.map((it) => (isObject(it) ? smartScalar(it.value) : smartScalar(it)))
        : items.map((it) => plainFromFields(f.children, isObject(it) ? it : {}))
      doc.setIn(here, out)
      continue
    }

    // scalar leaf
    doc.setIn(here, leafValue(f, raw))
  }
}

function leafValue(field: SchemaField, raw: unknown): unknown {
  if (field.type === 'boolean') {
    if (typeof raw === 'boolean') return raw
    return String(raw ?? field.defaultValue ?? 'false').toLowerCase() === 'true'
  }
  if (field.type === 'number') return smartScalar(raw ?? field.defaultValue ?? '')
  return raw != null ? String(raw) : (field.defaultValue ?? '')
}

/** Plain JS object for an array item (no Document editing — the seq is replaced). */
function plainFromFields(
  fields: SchemaField[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    const raw = values[f.key]
    if (f.type === 'object') {
      out[f.key] = plainFromFields(f.children, isObject(raw) ? raw : {})
    } else if (f.type === 'array') {
      const items = Array.isArray(raw) ? raw : []
      const scalar = isScalarArrayTemplate(f.children)
      out[f.key] = scalar
        ? items.map((it) => (isObject(it) ? smartScalar(it.value) : smartScalar(it)))
        : items.map((it) => plainFromFields(f.children, isObject(it) ? it : {}))
    } else {
      out[f.key] = leafValue(f, raw)
    }
  }
  return out
}
