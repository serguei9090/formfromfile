import { describe, expect, it } from 'vitest'
import { importXsdSchema, looksLikeXsdSchema } from './xsdSchema'

const xsd = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:simpleType name="ModeType">
    <xs:restriction base="xs:string">
      <xs:enumeration value="passive"/>
      <xs:enumeration value="active"/>
    </xs:restriction>
  </xs:simpleType>
  <xs:complexType name="FtpType">
    <xs:sequence>
      <xs:element name="Host" type="xs:string"/>
      <xs:element name="Port" type="xs:int" minOccurs="1">
        <xs:annotation><xs:documentation>ignored</xs:documentation></xs:annotation>
      </xs:element>
    </xs:sequence>
  </xs:complexType>
  <xs:element name="Config">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Name">
          <xs:simpleType>
            <xs:restriction base="xs:string">
              <xs:pattern value="[A-Z]+"/>
            </xs:restriction>
          </xs:simpleType>
        </xs:element>
        <xs:element name="Mode" type="ModeType" minOccurs="0"/>
        <xs:element name="Retries">
          <xs:simpleType>
            <xs:restriction base="xs:int">
              <xs:minInclusive value="0"/>
              <xs:maxInclusive value="10"/>
            </xs:restriction>
          </xs:simpleType>
        </xs:element>
        <xs:element name="Ftp" type="FtpType"/>
        <xs:element name="Tag" type="xs:string" minOccurs="0" maxOccurs="unbounded"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`

describe('looksLikeXsdSchema', () => {
  it('recognises an XML Schema document', () => {
    expect(looksLikeXsdSchema(xsd)).toBe(true)
  })
  it('rejects plain XML and non-XML', () => {
    expect(looksLikeXsdSchema('<config><a>1</a></config>')).toBe(false)
    expect(looksLikeXsdSchema('{"a":1}')).toBe(false)
  })
})

describe('importXsdSchema', () => {
  const { schema, meta } = importXsdSchema(xsd)

  it('uses the top-level element as the XML root', () => {
    expect(schema.format).toBe('xml')
    expect(schema.rootName).toBe('Config')
  })

  it('maps declared element types onto SchemaField', () => {
    const byKey = Object.fromEntries(schema.fields.map((f) => [f.key, f]))
    expect(byKey.Name.type).toBe('text')
    expect(byKey.Retries.type).toBe('number')
    expect(byKey.Ftp.type).toBe('object')
    expect(byKey.Ftp.children.map((c) => c.key)).toEqual(['Host', 'Port'])
    expect(byKey.Tag.type).toBe('array')
    expect(byKey.Tag.children[0].key).toBe('value')
  })

  it('resolves a named simpleType enum by reference', () => {
    expect(meta.Mode).toMatchObject({ enumValues: ['passive', 'active'] })
  })

  it('carries inline restriction facets (pattern, min/max) into FieldMeta', () => {
    expect(meta.Name).toMatchObject({ pattern: '[A-Z]+', required: true })
    expect(meta.Retries).toMatchObject({ min: 0, max: 10, required: true })
  })

  it('minOccurs=0 is not required; unset minOccurs defaults to required', () => {
    expect(meta.Mode?.required).toBeUndefined()
    expect(meta['Ftp.Port']).toMatchObject({ required: true })
  })
})
