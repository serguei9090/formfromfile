import { describe, expect, it } from 'vitest'
import { parseRichYaml, renderRichYaml } from './richYaml'

const src = `# service config
name: web-01          # instance name
port: 8080
replicas: 3
tls:
  # cert paths
  cert: /etc/ssl/cert.pem
  key: /etc/ssl/key.pem
hosts:
  - a.example
  - b.example
version: "1.0"
`

describe('parseRichYaml', () => {
  it('detects the shape, key order preserved', () => {
    const r = parseRichYaml(src)!
    expect(r.schema.fields.map((f) => f.key)).toEqual([
      'name',
      'port',
      'replicas',
      'tls',
      'hosts',
      'version',
    ])
    expect(r.seed.port).toBe('8080')
    expect((r.seed.hosts as unknown[]).length).toBe(2)
  })

  it('returns null for non-mapping YAML', () => {
    expect(parseRichYaml('- just\n- a\n- list')).toBeNull()
    expect(parseRichYaml('plain scalar')).toBeNull()
  })
})

describe('renderRichYaml', () => {
  it('keeps comments and key order, rewrites only edited values', () => {
    const r = parseRichYaml(src)!
    const values = { ...r.seed, port: '9090', tls: { ...(r.seed.tls as object), cert: '/new/cert' } }
    const out = renderRichYaml(r.schema, values, src)

    expect(out).toContain('# service config')
    expect(out).toContain('# instance name')
    expect(out).toContain('# cert paths')
    expect(out).toContain('port: 9090')
    expect(out).toContain('cert: /new/cert')
    expect(out.indexOf('name:')).toBeLessThan(out.indexOf('port:'))
  })

  it('keeps "1.0" from collapsing to 1 (finding #8)', () => {
    const r = parseRichYaml(src)!
    const out = renderRichYaml(r.schema, r.seed, src)
    expect(out).toMatch(/version:\s*["']?1\.0["']?/)
    expect(out).not.toMatch(/version:\s*1\s*$/m)
  })
})
