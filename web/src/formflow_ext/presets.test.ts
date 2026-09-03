import { describe, expect, it } from 'vitest'
import { PRESETS, presetById, presetForEditorAttr } from './presets'

const check = (id: string) => presetById(id)!

describe('presets accept/reject', () => {
  const cases: Array<[string, string[], string[]]> = [
    ['ipv4', ['10.0.0.5', '255.255.255.0'], ['10.0.0.256', 'localhost', '10.0.0']],
    ['hostname', ['tool-01.plant.local', 'host'], ['-bad.example', 'a..b', 'has space']],
    ['ipv4-or-hostname', ['10.0.0.5', 'tool-01.local'], ['@nope@', '10.0.0.256 ']],
    ['port', ['1', '9000', '65535'], ['0', '65536', '-1', 'abc']],
    ['email', ['a@b.co'], ['a@b', 'nope']],
    ['toolname', ['PRESS-04', 'a.b_c'], ['-leading', 'has space']],
    ['slug', ['north-line-2'], ['North', 'a--b', '-x']],
    ['integer', ['-3', '42'], ['4.2', 'x']],
    ['decimal', ['-3', '4.25'], ['4.', 'x']],
  ]
  for (const [id, good, bad] of cases) {
    it(id, () => {
      for (const g of good) expect(check(id).test(g), `${id} should accept ${g}`).toBe(true)
      for (const b of bad) expect(check(id).test(b), `${id} should reject ${b}`).toBe(false)
    })
  }
})

describe('presetForEditorAttr', () => {
  it('maps the ILS editor attributes', () => {
    expect(presetForEditorAttr('Toolname')).toBe('toolname')
    expect(presetForEditorAttr('IPv4-or-Hostname')).toBe('ipv4-or-hostname')
    expect(presetForEditorAttr('  PORT ')).toBe('port')
  })
  it('is undefined for an unknown editor', () => {
    expect(presetForEditorAttr('WhatIsThis')).toBeUndefined()
    expect(presetForEditorAttr(undefined)).toBeUndefined()
  })
})

it('every preset id is unique and resolvable', () => {
  const ids = PRESETS.map((p) => p.id)
  expect(new Set(ids).size).toBe(ids.length)
  for (const id of ids) expect(presetById(id)).toBeDefined()
})
