import type { FormFlowSchema } from '@/core/form_flow/schemaModel'

export type Values = Record<string, unknown>

export interface ParsedFormat {
  schema: FormFlowSchema
  /** The decoded plain object — used to seed the form (one array item per row). */
  decoded: Values
}

/** A format the core parser (JSON/XML/YAML) doesn't handle. */
export interface FormatPlugin {
  id: string
  label: string
  /** File extensions (with dot) that hint this format. */
  extensions: string[]
  /** Cheap check — is `raw` plausibly this format? */
  detect: (raw: string) => boolean
  parse: (raw: string) => ParsedFormat
  /** `source` is the original file text — plugins that preserve comments /
   * ordering (e.g. `.env`) re-read it; others ignore it. */
  render: (schema: FormFlowSchema, values: Values, source: string) => string
}
