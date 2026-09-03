import { describe, expect, it } from 'vitest'
import ils from './xml/__fixtures__/ils.simple.default.xml?raw'
import { parseRichXml } from './xml/richXml'
import { autoMetaFromSchema } from './autoMeta'

describe('autoMetaFromSchema', () => {
  it('maps <field editor="…"> to a preset on the sibling @_name', () => {
    const { schema } = parseRichXml(ils)!
    const meta = autoMetaFromSchema(schema)
    // the array item template comes from the first <field>, editor="Toolname"
    expect(meta['newToolUI.fields.field.@_name']).toEqual({ preset: 'toolname' })
  })

  it('is empty when there are no editor hints', () => {
    const { schema } = parseRichXml('<c><a>1</a><b>x</b></c>')!
    expect(autoMetaFromSchema(schema)).toEqual({})
  })
})
