import { describe, expect, it } from 'vitest'
import { smartScalar } from './coerce'

describe('smartScalar', () => {
  it('keeps text that would not round-trip as a number', () => {
    expect(smartScalar('1.0')).toBe('1.0')
    expect(smartScalar('007')).toBe('007')
    expect(smartScalar('1.50')).toBe('1.50')
    expect(smartScalar('123456789012345678901234567890')).toBe('123456789012345678901234567890')
  })

  it('converts clean numeric text', () => {
    expect(smartScalar('42')).toBe(42)
    expect(smartScalar('-3')).toBe(-3)
    expect(smartScalar('3.14')).toBe(3.14)
    expect(smartScalar('0')).toBe(0)
  })

  it('passes non-numeric text through', () => {
    expect(smartScalar('v1.2.3')).toBe('v1.2.3')
    expect(smartScalar('Passive')).toBe('Passive')
    expect(smartScalar('')).toBe('')
  })

  it('leaves real numbers and booleans alone', () => {
    expect(smartScalar(5)).toBe(5)
    expect(smartScalar(true)).toBe(true)
  })
})
