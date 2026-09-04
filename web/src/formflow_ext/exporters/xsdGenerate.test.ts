import { describe, expect, it } from 'vitest'
import type { FormFlowSchema } from '@/core/form_flow/schemaModel'
import { parseRichXml } from '../xml/richXml'
import { importXsdSchema } from '../importers/xsdSchema'
import { generateXsd } from './xsdGenerate'

const xml = `<?xml version="1.0"?>
<Config>
  <Name>demo</Name>
  <Port>2121</Port>
  <Passive>true</Passive>
  <Ftp active="yes">
    <Host>10.0.0.1</Host>
  </Ftp>
  <Tag>a</Tag>
  <Tag>b</Tag>
</Config>`

describe('generateXsd', () => {
  it('emits elements for scalars, objects and arrays, and attributes as xs:attribute', () => {
    const parsed = parseRichXml(xml)!
    const xsd = generateXsd(parsed.schema)

    expect(xsd).toContain('<xs:element name="Config">')
    expect(xsd).toContain('<xs:element name="Name" type="xs:string"/>')
    expect(xsd).toContain('<xs:element name="Port" type="xs:integer"/>')
    expect(xsd).toContain('<xs:element name="Passive" type="xs:boolean"/>')
    expect(xsd).toContain('<xs:element name="Ftp">')
    expect(xsd).toContain('<xs:attribute name="active" type="xs:string"/>')
    expect(xsd).toContain('<xs:element name="Tag" type="xs:string" minOccurs="0" maxOccurs="unbounded"/>')
    // structural passthrough keys never leak into the generated schema
    expect(xsd).not.toContain('#text')
    expect(xsd).not.toContain('#comment')
  })

  it('round-trips through importXsdSchema with the same field shape', () => {
    const parsed = parseRichXml(xml)!
    const xsd = generateXsd(parsed.schema)
    const reimported = importXsdSchema(xsd)

    const keys = (s: FormFlowSchema) => s.fields.map((f) => f.key).sort()
    expect(keys(reimported.schema)).toEqual(keys(parsed.schema))
    expect(reimported.schema.rootName).toBe('Config')

    const ftp = reimported.schema.fields.find((f) => f.key === 'Ftp')!
    expect(ftp.type).toBe('object')
    expect(ftp.children.map((c) => c.key)).toContain('Host')

    const tag = reimported.schema.fields.find((f) => f.key === 'Tag')!
    expect(tag.type).toBe('array')
  })

  it('handles an empty array with no sample item', () => {
    const schema: FormFlowSchema = {
      format: 'xml',
      rootName: 'Root',
      fields: [{ key: 'Items', type: 'array', children: [] }],
    }
    expect(generateXsd(schema)).toContain(
      '<xs:element name="Items" type="xs:string" minOccurs="0" maxOccurs="unbounded"/>',
    )
  })
})
