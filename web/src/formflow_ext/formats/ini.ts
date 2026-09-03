import type { FormatPlugin, ParsedFormat, Values } from './types'
import { fieldsFromValue, isObject, valueFromFields } from './tree'

const SECTION = /^\s*\[([^\]]+)\]\s*$/
const PAIR = /^\s*([^=:]+?)\s*[=:]\s*(.*?)\s*$/
const COMMENT = /^\s*[#;]/

/**
 * INI (with `[sections]` → nested objects) and `.properties` (no sections,
 * dotted keys kept literal). One plugin, section-aware.
 */
export const iniPlugin: FormatPlugin = {
  id: 'ini',
  label: 'INI / .properties',
  extensions: ['.ini', '.properties', '.cfg', '.conf'],
  detect: (raw) => {
    const lines = raw.split(/\r?\n/).filter((l) => l.trim() && !COMMENT.test(l))
    return lines.length > 0 && lines.every((l) => SECTION.test(l) || PAIR.test(l))
  },

  parse: (raw): ParsedFormat => {
    const root: Record<string, unknown> = {}
    let target = root
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim() || COMMENT.test(line)) continue
      const sec = SECTION.exec(line)
      if (sec) {
        const obj: Record<string, unknown> = {}
        root[sec[1].trim()] = obj
        target = obj
        continue
      }
      const kv = PAIR.exec(line)
      if (kv) target[kv[1].trim()] = kv[2]
    }
    return { schema: { format: 'json', rootName: 'config', fields: fieldsFromValue(root) }, decoded: root }
  },

  render: (schema, values: Values): string => {
    const map = valueFromFields(schema.fields, values)
    const rootPairs: string[] = []
    const sections: string[] = []
    for (const [k, v] of Object.entries(map)) {
      if (isObject(v)) {
        sections.push(
          `[${k}]\n` +
            Object.entries(v)
              .map(([sk, sv]) => `${sk} = ${scalar(sv)}`)
              .join('\n'),
        )
      } else {
        rootPairs.push(`${k} = ${scalar(v)}`)
      }
    }
    return [rootPairs.join('\n'), ...sections].filter(Boolean).join('\n\n') + '\n'
  },
}

function scalar(v: unknown): string {
  return v == null ? '' : String(v)
}
