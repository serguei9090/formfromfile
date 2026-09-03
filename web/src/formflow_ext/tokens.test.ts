import { describe, expect, it } from 'vitest'
import { applyTokens, pruneTokenValues, scanTokens } from './tokens'

describe('scanTokens', () => {
  it('finds unique %tokens% across a nested values tree with occurrence paths', () => {
    const values = {
      instanceXML: {
        Name: '%Name%',
        ChatConfiguration: '%IP Address%:9000',
        Services: {
          FTP: { FTPHostName: '%IP Address%' },
        },
      },
    }
    const tokens = scanTokens(values)
    const byName = Object.fromEntries(tokens.map((t) => [t.name, t]))
    expect(Object.keys(byName).sort()).toEqual(['IP Address', 'Name'])
    expect(byName['Name'].token).toBe('%Name%')
    expect(byName['Name'].occurrences).toEqual(['instanceXML.Name'])
    expect(byName['IP Address'].occurrences).toEqual([
      'instanceXML.ChatConfiguration',
      'instanceXML.Services.FTP.FTPHostName',
    ])
  })

  it('recognises ${…} and {{…}} styles and array indices in paths', () => {
    const tokens = scanTokens({ hosts: ['${primary}', 'plain', '{{secondary}}'] })
    expect(tokens.map((t) => t.name).sort()).toEqual(['primary', 'secondary'])
    expect(tokens.find((t) => t.name === 'primary')!.occurrences).toEqual(['hosts[0]'])
  })

  it('returns nothing when there are no tokens', () => {
    expect(scanTokens({ a: 'b', n: 3, ok: true })).toEqual([])
  })
})

describe('applyTokens', () => {
  it('substitutes every occurrence, literally', () => {
    const out = applyTokens('<Name>%Name%</Name><Host>%IP Address%</Host><Chat>%IP Address%:9000</Chat>', {
      '%Name%': 'TOOL-1',
      '%IP Address%': '10.0.0.5',
    })
    expect(out).toBe('<Name>TOOL-1</Name><Host>10.0.0.5</Host><Chat>10.0.0.5:9000</Chat>')
  })

  it('leaves a token untouched when its value is empty', () => {
    expect(applyTokens('%A%-%B%', { '%A%': 'x', '%B%': '' })).toBe('x-%B%')
  })
})

describe('pruneTokenValues', () => {
  it('drops values whose token is gone', () => {
    const kept = pruneTokenValues(
      { '%A%': '1', '%B%': '2' },
      [{ token: '%A%', name: 'A', occurrences: [] }],
    )
    expect(kept).toEqual({ '%A%': '1' })
  })
})
