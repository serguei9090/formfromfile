/**
 * Seed `FieldMeta` from hints already in the source — so a detected template
 * arrives with some validation already wired.
 *
 * Rule: within one element, an `editor="…"` attribute names how a sibling
 * value should be validated. Target sibling, by priority: the element text
 * (`#text`), then `@_value`, then `@_name`, then the first text leaf. This is
 * exactly the ILS `<field editor="IPv4-or-Hostname" name="IP Address"/>`
 * shape — the `name` value gets the `ipv4-or-hostname` preset.
 */
import type { FormFlowSchema, SchemaField } from '@/core/form_flow/schemaModel'
import { childPath, setMetaAt, type FieldMetaMap } from './fieldMeta'
import { presetForEditorAttr } from './presets'
import { ATTR_PREFIX, TEXT_KEY } from './xml/richXml'

const EDITOR_KEYS = [`${ATTR_PREFIX}editor`, 'editor']
const TARGET_PRIORITY = [TEXT_KEY, `${ATTR_PREFIX}value`, `${ATTR_PREFIX}name`]

export function autoMetaFromSchema(schema: FormFlowSchema): FieldMetaMap {
  return collect(schema.fields, '', {})
}

function collect(fields: SchemaField[], prefix: string, meta: FieldMetaMap): FieldMetaMap {
  let m = meta
  const editor = fields.find((f) => EDITOR_KEYS.includes(f.key))
  const preset = editor ? presetForEditorAttr(editor.defaultValue) : undefined
  if (preset) {
    const target = pickTarget(fields)
    if (target) m = setMetaAt(m, childPath(prefix, target.key), { preset })
  }
  for (const f of fields) {
    if (f.children.length > 0) m = collect(f.children, childPath(prefix, f.key), m)
  }
  return m
}

function pickTarget(fields: SchemaField[]): SchemaField | undefined {
  for (const key of TARGET_PRIORITY) {
    const hit = fields.find((f) => f.key === key)
    if (hit) return hit
  }
  return fields.find((f) => f.type === 'text' && !EDITOR_KEYS.includes(f.key))
}
