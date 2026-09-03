import { describe, expect, it } from 'vitest'
import type { SchemaField } from '@/core/form_flow/schemaModel'
import { metaAt, pruneMetaMap, setMetaAt, walkPaths, type FieldMetaMap } from './fieldMeta'
import { parseStoredForm, serializeStoredForm } from './templateModel'

const fields: SchemaField[] = [
  { key: 'Name', type: 'text', children: [] },
  {
    key: 'Services',
    type: 'object',
    children: [
      {
        key: 'FTP',
        type: 'object',
        children: [{ key: 'FTPPort', type: 'number', children: [] }],
      },
    ],
  },
  {
    key: 'fields',
    type: 'array',
    children: [{ key: 'value', type: 'text', children: [] }],
  },
]

describe('walkPaths', () => {
  it('yields dotted paths, parents before children, array items un-indexed', () => {
    expect(walkPaths(fields)).toEqual([
      'Name',
      'Services',
      'Services.FTP',
      'Services.FTP.FTPPort',
      'fields',
      'fields.value',
    ])
  })
})

describe('setMetaAt / metaAt', () => {
  it('is immutable and merges patches', () => {
    const a: FieldMetaMap = {}
    const b = setMetaAt(a, 'Services.FTP.FTPPort', { label: 'FTP port', required: true })
    const c = setMetaAt(b, 'Services.FTP.FTPPort', { preset: 'port' })
    expect(a).toEqual({})
    expect(b['Services.FTP.FTPPort']).toEqual({ label: 'FTP port', required: true })
    expect(metaAt(c, 'Services.FTP.FTPPort')).toEqual({
      label: 'FTP port',
      required: true,
      preset: 'port',
    })
  })

  it('prunes empty values and drops a path that goes fully empty', () => {
    const b = setMetaAt({}, 'Name', { label: 'Name', help: '' })
    expect(b.Name).toEqual({ label: 'Name' })
    const c = setMetaAt(b, 'Name', { label: '' })
    expect(c.Name).toBeUndefined()
  })

  it('metaAt returns an empty object for an unknown path', () => {
    expect(metaAt({}, 'nope')).toEqual({})
  })
})

describe('pruneMetaMap', () => {
  it('keeps only paths still present in the schema', () => {
    const map: FieldMetaMap = {
      Name: { label: 'N' },
      'Services.FTP.FTPPort': { required: true },
      'gone.path': { label: 'stale' },
    }
    expect(pruneMetaMap(map, fields)).toEqual({
      Name: { label: 'N' },
      'Services.FTP.FTPPort': { required: true },
    })
  })
})

describe('parseStoredForm', () => {
  it('reads the full v2 shape', () => {
    const raw = serializeStoredForm({
      schema: { format: 'xml', rootName: 'Tool', fields },
      values: { Name: 'x' },
      meta: { Name: { label: 'N' } },
      tokens: [{ token: '%N%', name: 'N', occurrences: ['Name'] }],
      tokenValues: { '%N%': 'x' },
      formatId: 'xml',
    })
    const got = parseStoredForm(raw)
    expect(got?.meta).toEqual({ Name: { label: 'N' } })
    expect(got?.tokens).toHaveLength(1)
  })

  it('tolerates an F4b-era { schema, values } payload', () => {
    const raw = JSON.stringify({
      schema: { format: 'yaml', rootName: 'root', fields: [] },
      values: { a: 1 },
    })
    const got = parseStoredForm(raw)
    expect(got).not.toBeNull()
    expect(got?.meta).toEqual({})
    expect(got?.tokens).toEqual([])
  })

  it('returns null for junk or a schema-less object', () => {
    expect(parseStoredForm('not json')).toBeNull()
    expect(parseStoredForm('{}')).toBeNull()
    expect(parseStoredForm('123')).toBeNull()
  })
})
