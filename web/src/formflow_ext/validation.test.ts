import { describe, expect, it } from 'vitest'
import type { FormFlowSchema } from '@/core/form_flow/schemaModel'
import type { FieldMetaMap } from './fieldMeta'
import { collectErrors, makeResolver } from './validation'

const schema: FormFlowSchema = {
  format: 'xml',
  rootName: 'Tool',
  fields: [
    { key: 'Name', type: 'text', children: [] },
    { key: 'Port', type: 'number', children: [] },
    {
      key: 'Services',
      type: 'object',
      children: [{ key: 'Host', type: 'text', children: [] }],
    },
    {
      key: 'ips',
      type: 'array',
      children: [{ key: 'value', type: 'text', children: [] }],
    },
  ],
}

const meta: FieldMetaMap = {
  Name: { required: true, preset: 'toolname' },
  Port: { preset: 'port' },
  'Services.Host': { preset: 'ipv4-or-hostname' },
  'ips.value': { preset: 'ipv4' },
}

describe('collectErrors', () => {
  it('flags a missing required field', () => {
    const errs = collectErrors(schema, meta, { Name: '', Port: '', Services: {}, ips: [] })
    expect(errs.find((e) => e.name === 'Name')?.message).toMatch(/required/i)
  })

  it('runs presets on nested + array-item fields', () => {
    const errs = collectErrors(schema, meta, {
      Name: 'bad name!',
      Port: '99999',
      Services: { Host: 'not a host!!' },
      ips: [{ value: '10.0.0.5' }, { value: 'nope' }],
    })
    const names = errs.map((e) => e.name)
    expect(names).toContain('Name')
    expect(names).toContain('Port')
    expect(names).toContain('Services.Host')
    expect(names).toContain('ips.1.value')
    expect(names).not.toContain('ips.0.value')
  })

  it('passes clean data', () => {
    const errs = collectErrors(schema, meta, {
      Name: 'PRESS-04',
      Port: '9000',
      Services: { Host: 'tool-01.local' },
      ips: [{ value: '10.0.0.5' }],
    })
    expect(errs).toEqual([])
  })

  it('skips locked (non-editable) fields', () => {
    const errs = collectErrors(schema, { Name: { required: true, editable: false } }, {
      Name: '',
      Services: {},
      ips: [],
    })
    expect(errs).toEqual([])
  })
})

describe('makeResolver', () => {
  it('returns nested rhf errors and empty values on failure', async () => {
    const r = makeResolver(schema, meta)
    const out = await r({ Name: '', Port: '', Services: { Host: '' }, ips: [] })
    expect((out.errors as Record<string, { message: string }>).Name.message).toMatch(/required/i)
  })

  it('passes values through on success', async () => {
    const r = makeResolver(schema, {})
    const values = { Name: 'x', Port: '1', Services: { Host: 'h' }, ips: [] }
    const out = await r(values)
    expect(out.errors).toEqual({})
    expect(out.values).toBe(values)
  })
})
