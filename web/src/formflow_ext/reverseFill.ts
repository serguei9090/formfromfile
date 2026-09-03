/**
 * Reverse fill — pull form values out of an *already-filled* file so the user
 * edits an existing config instead of starting blank.
 *
 * `parseSource` turns the uploaded text into a values tree shaped by its own
 * detected schema; `alignValues` then re-shapes that onto the *current
 * template's* schema (by dotted key path, arrays by index), keeping template
 * defaults where the filled file has nothing. It's `seedFromValue` pointed at a
 * values tree instead of a freshly decoded object — same walk, same
 * one-item-per-occurrence array handling.
 */
import type { FormFlowSchema } from '@/core/form_flow/schemaModel'
import { parseSource } from './formats'
import { seedFromValue } from './formats/tree'

type Values = Record<string, unknown>

/** Re-shape `filledValues` onto `schema` (template defaults fill any gaps). */
export function alignValues(schema: FormFlowSchema, filledValues: Values): Values {
  return seedFromValue(schema.fields, filledValues)
}

/**
 * Parse an uploaded filled file and align it onto `schema`. Returns `null` if
 * the text doesn't parse in any supported format.
 */
export function valuesFromFilledFile(schema: FormFlowSchema, text: string): Values | null {
  try {
    const parsed = parseSource(text)
    return alignValues(schema, parsed.seed)
  } catch {
    return null
  }
}
