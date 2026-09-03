import { describe, expect, it } from 'vitest'
import ils from './__fixtures__/ils.simple.default.xml?raw'
import { parseRichXml, renderRichXml } from './richXml'

describe('parseRichXml', () => {
  it('keeps attribute-only elements as editable fields (core drops them)', () => {
    const rich = parseRichXml(ils)!
    expect(rich).not.toBeNull()

    const newToolUI = rich.schema.fields.find((f) => f.key === 'newToolUI')!
    const fields = newToolUI.children.find((f) => f.key === 'fields')!
    const field = fields.children.find((f) => f.key === 'field')!
    expect(field.type).toBe('array')
    // the per-item template carries the three attributes
    expect(field.children.map((c) => c.key).sort()).toEqual(['@_editor', '@_isRequired', '@_name'])
    // friendly labels, prefix stripped
    expect(field.children.find((c) => c.key === '@_editor')!.label).toBe('editor')
  })

  it('seeds one array item per source occurrence', () => {
    const rich = parseRichXml(ils)!
    const field = (
      rich.seed.newToolUI as Record<string, Record<string, unknown[]>>
    ).fields.field as unknown[]
    expect(field).toHaveLength(2)
    expect(field[0]).toMatchObject({ '@_editor': 'Toolname', '@_name': 'Name' })
    expect(field[1]).toMatchObject({ '@_editor': 'IPv4-or-Hostname', '@_name': 'IP Address' })
  })

  it('returns null for non-XML', () => {
    expect(parseRichXml('key: value')).toBeNull()
    expect(parseRichXml('{"a":1}')).toBeNull()
  })
})

describe('renderRichXml round trip', () => {
  const rich = parseRichXml(ils)!
  const out = renderRichXml(rich.schema, rich.seed, ils)

  it('preserves the XML declaration', () => {
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
  })

  it('preserves both <field> elements with all attributes and values', () => {
    expect(out).toContain('<field editor="Toolname" isRequired="true" name="Name"/>')
    expect(out).toContain('<field editor="IPv4-or-Hostname" isRequired="true" name="IP Address"/>')
  })

  it('preserves element text and %tokens%', () => {
    expect(out).toContain('<FTPPassword>password</FTPPassword>')
    expect(out).toContain('<ChatConfiguration>%IP Address%:9000</ChatConfiguration>')
  })

  it('preserves the header comment', () => {
    expect(out).toContain('This is the Simple template for tool frameworks')
  })

  it('is stable across a second round trip', () => {
    const rich2 = parseRichXml(out)!
    const out2 = renderRichXml(rich2.schema, rich2.seed, out)
    expect(out2).toBe(out)
  })
})
