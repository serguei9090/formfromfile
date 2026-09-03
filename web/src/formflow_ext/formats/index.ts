/**
 * Format registry. `parseSource` tries the core parser first (JSON → XML →
 * YAML), then each plugin's `detect`. `renderTemplate` dispatches on the
 * resolved `formatId`. `schema.format` from the core stays `'json'` for plugin
 * formats — `formatId` is the source of truth for round-tripping.
 */
import { FormFlowParser } from '@/core/form_flow/formFlowParser'
import { defaultValuesFromFields, type FormFlowSchema } from '@/core/form_flow/schemaModel'
import { parseRichXml, renderRichXml } from '../xml/richXml'
import { parseRichYaml, renderRichYaml } from '../yaml/richYaml'
import { seedFromValue } from './tree'
import { csvPlugin } from './csv'
import { dotenvPlugin } from './dotenv'
import { iniPlugin } from './ini'
import { tomlPlugin } from './toml'
import type { FormatPlugin, Values } from './types'

const core = new FormFlowParser()

// Order matters: stricter detectors first. dotenv (`KEY=val` only) before ini
// (accepts `k: v` and `[sections]` too); csv before both.
export const FORMAT_PLUGINS: FormatPlugin[] = [tomlPlugin, csvPlugin, dotenvPlugin, iniPlugin]

export type FormatId = 'xml' | 'yaml' | 'json' | 'toml' | 'ini' | 'csv' | 'dotenv'

export const FORMAT_ACCEPT = [
  '.xml',
  '.yaml',
  '.yml',
  '.json',
  '.toml',
  '.ini',
  '.properties',
  '.cfg',
  '.conf',
  '.csv',
  '.tsv',
  '.env',
  '.schema.json',
].join(',')

const EXT: Record<string, string> = {
  xml: 'xml',
  yaml: 'yaml',
  json: 'json',
  toml: 'toml',
  ini: 'ini',
  csv: 'csv',
  dotenv: 'env',
}

export function extensionFor(formatId: string): string {
  return EXT[formatId] ?? 'txt'
}

export interface ParsedSource {
  formatId: FormatId
  schema: FormFlowSchema
  seed: Values
}

export function parseSource(raw: string): ParsedSource {
  // core first — JSON / XML / YAML
  try {
    const schema = core.parse(raw)
    if (schema.format === 'xml') {
      const rich = parseRichXml(raw)
      if (rich) return { formatId: 'xml', schema: rich.schema, seed: rich.seed }
    }
    if (schema.format === 'yaml') {
      const rich = parseRichYaml(raw)
      if (rich) return { formatId: 'yaml', schema: rich.schema, seed: rich.seed }
    }
    return {
      formatId: schema.format as FormatId,
      schema,
      seed: defaultValuesFromFields(schema.fields),
    }
  } catch {
    /* fall through to plugins */
  }

  for (const plugin of FORMAT_PLUGINS) {
    if (!plugin.detect(raw)) continue
    const { schema, decoded } = plugin.parse(raw)
    return { formatId: plugin.id as FormatId, schema, seed: seedFromValue(schema.fields, decoded) }
  }

  throw new Error('Could not detect a supported format (JSON, XML, YAML, TOML, INI, CSV, .env)')
}

export function renderTemplate(
  formatId: string,
  schema: FormFlowSchema,
  values: Values,
  source: string,
): string {
  if (formatId === 'xml') return renderRichXml(schema, values, source)
  if (formatId === 'yaml') return renderRichYaml(schema, values, source)
  if (formatId === 'json') return core.render(schema, values)
  const plugin = FORMAT_PLUGINS.find((p) => p.id === formatId)
  if (!plugin) throw new Error(`No renderer for format "${formatId}"`)
  return plugin.render(schema, values, source)
}
