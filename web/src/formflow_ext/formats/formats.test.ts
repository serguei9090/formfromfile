import { describe, expect, it } from 'vitest'
import { parseSource, renderTemplate } from './index'
import { seedFromValue } from './tree'

/** Detect → parse → seed → render, then re-detect and expect a stable result. */
function roundTrip(raw: string, expectedFormat: string) {
  const p = parseSource(raw)
  expect(p.formatId).toBe(expectedFormat)
  const out = renderTemplate(p.formatId, p.schema, p.seed, raw)
  const p2 = parseSource(out)
  const out2 = renderTemplate(p2.formatId, p2.schema, seedFromValue(p2.schema.fields, p.seed), out)
  return { out, out2 }
}

describe('format plugins', () => {
  it('.env round-trips', () => {
    const { out } = roundTrip('# db\nHOST=localhost\nPORT=5432\nDEBUG=true\n', 'dotenv')
    expect(out).toContain('HOST=localhost')
    expect(out).toContain('PORT=5432')
  })

  it('INI with sections round-trips', () => {
    const raw = '[server]\nhost = 0.0.0.0\nport = 8080\n\n[log]\nlevel = info\n'
    const { out } = roundTrip(raw, 'ini')
    expect(out).toContain('[server]')
    expect(out).toContain('host = 0.0.0.0')
    expect(out).toContain('[log]')
  })

  it('TOML round-trips nested tables', () => {
    const raw = 'title = "app"\n\n[owner]\nname = "Ada"\n\n[db]\nport = 5432\n'
    const { out } = roundTrip(raw, 'toml')
    expect(out).toContain('title = "app"')
    expect(out).toMatch(/\[owner\]/)
    expect(out).toContain('name = "Ada"')
  })

  it('CSV round-trips rows', () => {
    const raw = 'name,role\nAda,eng\nBob,ops'
    const p = parseSource(raw)
    expect(p.formatId).toBe('csv')
    const rows = (p.seed.rows as unknown[]) ?? []
    expect(rows).toHaveLength(2)
    const out = renderTemplate('csv', p.schema, p.seed, raw)
    expect(out.replace(/\r\n/g, '\n').trim()).toBe('name,role\nAda,eng\nBob,ops')
  })

  it('still detects core formats', () => {
    expect(parseSource('{"a":1}').formatId).toBe('json')
    expect(parseSource('<c><a>1</a></c>').formatId).toBe('xml')
    expect(parseSource('a: 1\nb: two\n').formatId).toBe('yaml')
  })

  it('throws on an undetectable blob', () => {
    expect(() => parseSource('\x00\x01 not anything')).toThrow(/detect/i)
  })
})
