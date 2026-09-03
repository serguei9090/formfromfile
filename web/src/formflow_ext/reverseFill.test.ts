import { describe, expect, it } from 'vitest'
import { parseSource } from './formats'
import { alignValues, valuesFromFilledFile } from './reverseFill'

const templateYaml = `name: default
server:
  host: 0.0.0.0
  port: 8080
hosts:
  - a.example
`

describe('reverse fill', () => {
  it('pulls values from a modified copy onto the template schema', () => {
    const { schema } = parseSource(templateYaml)
    const filled = `name: prod
server:
  host: 10.0.0.5
  port: 9090
hosts:
  - a.example
  - b.example
`
    const v = valuesFromFilledFile(schema, filled)!
    expect(v.name).toBe('prod')
    expect((v.server as Record<string, unknown>).host).toBe('10.0.0.5')
    expect((v.server as Record<string, unknown>).port).toBe('9090')
    expect(v.hosts).toHaveLength(2)
  })

  it('keeps template defaults where the filled file has nothing', () => {
    const { schema, seed } = parseSource(templateYaml)
    const aligned = alignValues(schema, { name: 'only-name' })
    expect(aligned.name).toBe('only-name')
    expect((aligned.server as Record<string, unknown>).port).toBe(
      (seed.server as Record<string, unknown>).port,
    )
  })

  it('returns null for an unreadable file', () => {
    const { schema } = parseSource(templateYaml)
    expect(valuesFromFilledFile(schema, '\x00\x01 not a config')).toBeNull()
  })
})
