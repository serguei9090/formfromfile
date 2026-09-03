import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('merges and dedupes tailwind classes', () => {
    const off = false
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-sm', off && 'hidden', 'font-medium')).toBe('text-sm font-medium')
  })
})
