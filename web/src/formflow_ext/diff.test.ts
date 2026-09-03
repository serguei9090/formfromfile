import { describe, expect, it } from 'vitest'
import { diffValues, summarize } from './diff'

describe('diffValues', () => {
  it('reports changed / added / removed scalars across nesting', () => {
    const before = { name: 'a', svc: { port: 21, mode: 'passive' }, tags: ['x'] }
    const after = { name: 'b', svc: { port: 2121 }, tags: ['x', 'y'] }
    const d = diffValues(before, after)
    const byPath = Object.fromEntries(d.map((c) => [c.path, c]))
    expect(byPath['name']).toMatchObject({ kind: 'changed', before: 'a', after: 'b' })
    expect(byPath['svc.port']).toMatchObject({ kind: 'changed', before: '21', after: '2121' })
    expect(byPath['svc.mode']).toMatchObject({ kind: 'removed', before: 'passive' })
    expect(byPath['tags.1']).toMatchObject({ kind: 'added', after: 'y' })
  })

  it('is empty for equal trees (numeric vs string compares by text)', () => {
    expect(diffValues({ a: 1, b: 'x' }, { a: '1', b: 'x' })).toEqual([])
  })

  it('summarize counts each kind', () => {
    const d = diffValues({ a: 1, b: 2 }, { a: 9, c: 3 })
    expect(summarize(d)).toBe('1 changed · 1 added · 1 removed')
    expect(summarize([])).toBe('no changes')
  })
})
