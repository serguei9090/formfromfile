/**
 * `FormTemplate` — a detected `FormFlowSchema` plus the FormFromFile-only
 * authoring layer (`FieldMetaMap`) and token specs. This is what a saved form's
 * `formJson` column serializes.
 *
 * Backward compatible: an F4b-era `formJson` (`{ schema, values }` only) loads
 * with an empty `meta` / `tokens`, so old saved forms keep working unchanged.
 */
import type { FormFlowSchema } from '@/core/form_flow/schemaModel'
import type { FieldMetaMap, FieldPath } from './fieldMeta'

/** A `%X%` / `${x}` / `{{x}}` placeholder found in the source values (F8). */
export interface TokenSpec {
  /** The literal placeholder, e.g. `"%IP Address%"`. */
  token: string
  /** The inner name, e.g. `"IP Address"`. */
  name: string
  /** Field paths whose value contains this token. */
  occurrences: FieldPath[]
}

export interface FormTemplate {
  schema: FormFlowSchema
  meta: FieldMetaMap
  tokens: TokenSpec[]
  /** Round-trip format: 'xml' | 'yaml' | 'json' | 'toml' | 'ini' | 'csv' | 'dotenv'. */
  formatId: string
}

type Values = Record<string, unknown>

/** The full decoded shape of a saved form's `formJson`. */
export interface StoredForm {
  schema: FormFlowSchema
  values: Values
  meta: FieldMetaMap
  tokens: TokenSpec[]
  /** Filled token values, keyed by the literal placeholder (`"%Name%"`). */
  tokenValues: Record<string, string>
  /** Round-trip format id. Falls back to `schema.format` for pre-F12 saves. */
  formatId: string
}

/** Tolerant decoder. Returns `null` when there's no usable `schema`. */
export function parseStoredForm(raw: string): StoredForm | null {
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const rec = obj as Record<string, unknown>
  if (!rec.schema || typeof rec.schema !== 'object') return null
  const schema = rec.schema as FormFlowSchema
  return {
    schema,
    values: isObject(rec.values) ? (rec.values as Values) : {},
    meta: isObject(rec.meta) ? (rec.meta as FieldMetaMap) : {},
    tokens: Array.isArray(rec.tokens) ? (rec.tokens as TokenSpec[]) : [],
    tokenValues: isObject(rec.tokenValues) ? (rec.tokenValues as Record<string, string>) : {},
    formatId: typeof rec.formatId === 'string' ? rec.formatId : schema.format,
  }
}

export function serializeStoredForm(f: StoredForm): string {
  return JSON.stringify({
    schema: f.schema,
    values: f.values,
    meta: f.meta,
    tokens: f.tokens,
    tokenValues: f.tokenValues,
    formatId: f.formatId,
  })
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
