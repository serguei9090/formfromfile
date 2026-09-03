/**
 * Turns a schema + its `FieldMetaMap` into per-field validation, keyed by the
 * same dotted names `react-hook-form` registers (`Services.FTP.FTPPort`,
 * array items indexed: `newToolUI.fields.field.0.@_name`).
 *
 * `collectErrors` is the pure core (easy to test); `makeResolver` adapts it to
 * the rhf `Resolver` contract for the fill screen (F10). No zod — the rules are
 * small and the preset library already owns the regexes.
 */
import {
  isScalarArrayTemplate,
  type FormFlowSchema,
  type SchemaField,
} from '@/core/form_flow/schemaModel'
import { childPath, metaAt, type FieldMeta, type FieldMetaMap } from './fieldMeta'
import { isStructuralKey } from './xml/richXml'
import { presetById } from './presets'

export interface FieldError {
  /** rhf field name (dotted, array items indexed). */
  name: string
  message: string
}

type Values = Record<string, unknown>

export function collectErrors(
  schema: FormFlowSchema,
  meta: FieldMetaMap,
  values: Values,
): FieldError[] {
  const errors: FieldError[] = []
  walk(schema.fields, '', '', values, meta, errors)
  return errors
}

function walk(
  fields: SchemaField[],
  namePrefix: string,
  metaPrefix: string,
  value: unknown,
  meta: FieldMetaMap,
  out: FieldError[],
): void {
  const obj = isObject(value) ? value : {}
  for (const f of fields) {
    if (isStructuralKey(f.key)) continue
    const name = namePrefix ? `${namePrefix}.${f.key}` : f.key
    const mPath = childPath(metaPrefix, f.key)
    const fm = metaAt(meta, mPath)
    const v = obj[f.key]

    if (f.type === 'object') {
      walk(f.children, name, mPath, v, meta, out)
      continue
    }
    if (f.type === 'array') {
      const items = Array.isArray(v) ? v : []
      const scalar = isScalarArrayTemplate(f.children)
      items.forEach((item, i) => {
        if (scalar) {
          checkLeaf(`${name}.${i}.value`, f.children[0], metaAt(meta, childPath(mPath, 'value')), unwrapScalar(item), out)
        } else {
          walk(f.children, `${name}.${i}`, mPath, item, meta, out)
        }
      })
      continue
    }
    checkLeaf(name, f, fm, v, out)
  }
}

function checkLeaf(name: string, field: SchemaField, m: FieldMeta, raw: unknown, out: FieldError[]): void {
  if (m.editable === false) return
  const text = raw == null ? '' : String(raw)
  const empty = text.trim() === ''

  if (m.required && empty) {
    out.push({ name, message: `${m.label ?? field.key} is required` })
    return
  }
  if (empty) return // optional + empty → nothing else to check

  if (m.enumValues && m.enumValues.length > 0 && !m.enumValues.includes(text)) {
    out.push({ name, message: `Must be one of: ${m.enumValues.join(', ')}` })
  }

  const preset = presetById(m.preset)
  if (preset && !preset.test(text)) {
    out.push({ name, message: preset.message })
  }

  if (m.pattern) {
    let re: RegExp | null = null
    try {
      re = new RegExp(m.pattern)
    } catch {
      re = null
    }
    if (re && !re.test(text)) {
      out.push({ name, message: m.patternMessage || 'Invalid format' })
    }
  }

  if (field.type === 'number' || m.numberFormat === 'integer' || m.numberFormat === 'decimal') {
    const n = Number(text)
    if (!Number.isFinite(n)) {
      out.push({ name, message: 'Must be a number' })
    } else {
      if (m.numberFormat === 'integer' && !Number.isInteger(n)) {
        out.push({ name, message: 'Must be a whole number' })
      }
      if (m.min != null && n < m.min) out.push({ name, message: `Must be at least ${m.min}` })
      if (m.max != null && n > m.max) out.push({ name, message: `Must be at most ${m.max}` })
    }
  }
}

/** Read a message out of rhf's nested `formState.errors` by dotted field name. */
export function errorMessageAt(errors: unknown, name: string): string | undefined {
  let node: unknown = errors
  for (const part of name.split('.')) {
    if (!node || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  if (node && typeof node === 'object' && 'message' in node) {
    const m = (node as { message?: unknown }).message
    return typeof m === 'string' ? m : undefined
  }
  return undefined
}

export interface ResolverResult {
  values: Values
  errors: Record<string, unknown>
}

/**
 * rhf-compatible resolver: `{ values, errors }` with `errors` in the nested rhf
 * shape. Cast to `Resolver` at the `useForm` call site.
 */
export function makeResolver(schema: FormFlowSchema, meta: FieldMetaMap) {
  return async (values: Values): Promise<ResolverResult> => {
    const flat = collectErrors(schema, meta, values)
    if (flat.length === 0) return { values, errors: {} }
    const errors: Record<string, unknown> = {}
    for (const e of flat) {
      setNested(errors, e.name, { type: 'validate', message: e.message })
    }
    return { values: {}, errors }
  }
}

function setNested(target: Record<string, unknown>, dotted: string, leaf: unknown): void {
  const parts = dotted.split('.')
  let node = target
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]
    if (!isObject(node[k])) node[k] = {}
    node = node[k] as Record<string, unknown>
  }
  const last = parts[parts.length - 1]
  if (node[last] === undefined) node[last] = leaf
}

function unwrapScalar(item: unknown): unknown {
  return isObject(item) ? item.value : item
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
