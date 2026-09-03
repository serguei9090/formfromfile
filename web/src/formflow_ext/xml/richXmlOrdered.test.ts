import { describe, expect, it } from 'vitest'
import { parseRichXml } from './richXml'
import { renderRichXmlOrdered, xmlHasInterspersedComments } from './richXmlOrdered'

const src = `<?xml version="1.0" encoding="UTF-8"?>
<Tool>
  <Name>D</Name>
  <!-- ftp section -->
  <Services>
    <FTP>
      <FTPUser>acct</FTPUser>
      <FTPPort>21</FTPPort>
    </FTP>
  </Services>
  <!-- ui -->
  <newToolUI>
    <fields>
      <field editor="Toolname" name="Name"/>
    </fields>
  </newToolUI>
</Tool>
`

describe('richXmlOrdered', () => {
  it('detects between-element comments', () => {
    expect(xmlHasInterspersedComments(src)).toBe(true)
    expect(xmlHasInterspersedComments('<a><b>1</b></a>')).toBe(false)
  })

  it('keeps a comment between two elements in place', () => {
    const rich = parseRichXml(src)!
    const out = renderRichXmlOrdered(rich.schema, rich.seed, src)!
    // comment stays between <Name> and <Services>, not hoisted to the top
    expect(out).toMatch(/<Name>D<\/Name>\s*<!-- ftp section -->\s*<Services>/)
    expect(out).toMatch(/<!-- ui -->\s*<newToolUI>/)
  })

  it('rewrites an edited value + keeps attributes', () => {
    const rich = parseRichXml(src)!
    const vals = structuredClone(rich.seed) as Record<string, unknown>
    ;(vals.Services as Record<string, Record<string, unknown>>).FTP.FTPPort = '2121'
    const out = renderRichXmlOrdered(rich.schema, vals, src)!
    expect(out).toContain('<FTPPort>2121</FTPPort>')
    expect(out).toContain('<field editor="Toolname" name="Name"/>')
  })

  it('returns null for invalid XML (caller falls back)', () => {
    expect(renderRichXmlOrdered({ format: 'xml', rootName: 'x', fields: [] }, {}, '<a>')).toBeNull()
  })
})
