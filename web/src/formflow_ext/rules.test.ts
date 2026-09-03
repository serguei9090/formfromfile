import { describe, expect, it } from 'vitest'
import { evalComputed, evalCond, failingRules, getAt, withComputed } from './rules'

const values = { mode: 'passive', server: { host: '10.0.0.5', port: '21' }, list: ['a', 'b'] }

describe('getAt / evalCond', () => {
  it('resolves dotted + indexed paths', () => {
    expect(getAt(values, 'server.host')).toBe('10.0.0.5')
    expect(getAt(values, 'list.1')).toBe('b')
  })

  it('evaluates leaf ops', () => {
    expect(evalCond({ path: 'mode', op: 'eq', value: 'passive' }, values)).toBe(true)
    expect(evalCond({ path: 'mode', op: 'ne', value: 'passive' }, values)).toBe(false)
    expect(evalCond({ path: 'server.port', op: 'lt', value: '100' }, values)).toBe(true)
    expect(evalCond({ path: 'server.host', op: 'truthy' }, values)).toBe(true)
    expect(evalCond({ path: 'missing', op: 'empty' }, values)).toBe(true)
    expect(evalCond({ path: 'mode', op: 'in', value: ['active', 'passive'] }, values)).toBe(true)
  })

  it('combines with all / any', () => {
    expect(
      evalCond(
        { all: [{ path: 'mode', op: 'eq', value: 'passive' }, { path: 'server.port', op: 'eq', value: '21' }] },
        values,
      ),
    ).toBe(true)
    expect(
      evalCond({ any: [{ path: 'mode', op: 'eq', value: 'x' }, { path: 'mode', op: 'eq', value: 'passive' }] }, values),
    ).toBe(true)
  })
})

describe('failingRules', () => {
  it('returns rules whose condition holds', () => {
    const rules = [
      { id: 'a', when: { path: 'mode', op: 'eq' as const, value: 'passive' }, message: 'no passive' },
      { id: 'b', when: { path: 'mode', op: 'eq' as const, value: 'active' }, message: 'no active' },
    ]
    expect(failingRules(rules, values).map((r) => r.id)).toEqual(['a'])
  })
})

describe('computed', () => {
  it('evalComputed substitutes field paths', () => {
    expect(evalComputed('${server.host}:${server.port}', values)).toBe('10.0.0.5:21')
  })
  it('withComputed writes derived values into the tree', () => {
    const out = withComputed({ 'server.url': { computed: '${server.host}:${server.port}' } }, values)
    expect((out.server as Record<string, unknown>).url).toBe('10.0.0.5:21')
  })
})
