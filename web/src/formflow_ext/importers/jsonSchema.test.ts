import { describe, expect, it } from 'vitest'
import { importJsonSchema, looksLikeJsonSchema } from './jsonSchema'

const schema = JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Tool',
  type: 'object',
  required: ['name', 'port'],
  properties: {
    name: { type: 'string', title: 'Tool name', pattern: '^[A-Z]+$' },
    port: { type: 'integer', minimum: 1, maximum: 65535 },
    mode: { type: 'string', enum: ['passive', 'active'] },
    tags: { type: 'array', items: { type: 'string' } },
    ftp: {
      type: 'object',
      properties: { host: { type: 'string', description: 'FTP host' } },
    },
  },
})

describe('looksLikeJsonSchema', () => {
  it('recognises a $schema doc and an object-with-properties doc', () => {
    expect(looksLikeJsonSchema(schema)).toBe(true)
    expect(looksLikeJsonSchema('{"type":"object","properties":{"a":{"type":"string"}}}')).toBe(true)
  })
  it('rejects plain data', () => {
    expect(looksLikeJsonSchema('{"a":1,"b":2}')).toBe(false)
    expect(looksLikeJsonSchema('not json')).toBe(false)
  })
})

describe('importJsonSchema', () => {
  const { schema: s, meta } = importJsonSchema(schema)

  it('maps declared types onto SchemaField', () => {
    const byKey = Object.fromEntries(s.fields.map((f) => [f.key, f]))
    expect(byKey.name.type).toBe('text')
    expect(byKey.port.type).toBe('number')
    expect(byKey.tags.type).toBe('array')
    expect(byKey.ftp.type).toBe('object')
    expect(byKey.ftp.children[0].key).toBe('host')
  })

  it('carries required / pattern / min-max / enum / integer into FieldMeta', () => {
    expect(meta.name).toMatchObject({ label: 'Tool name', required: true, pattern: '^[A-Z]+$' })
    expect(meta.port).toMatchObject({ required: true, min: 1, max: 65535, numberFormat: 'integer' })
    expect(meta.mode).toMatchObject({ enumValues: ['passive', 'active'] })
    expect(meta['ftp.host']).toMatchObject({ help: 'FTP host' })
  })
})
