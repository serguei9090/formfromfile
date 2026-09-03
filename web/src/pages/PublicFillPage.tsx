import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { api, ApiError } from '@/api/client'
import type { PublicTemplate } from '@/api/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Leaf } from '@/app/Leaf'
import { useApplyTheme } from '@/stores/themeStore'
import { FillForm } from '@/designer/FillForm'
import { FormFlowParser } from '@/core/form_flow/formFlowParser'
import { defaultValuesFromFields } from '@/core/form_flow/schemaModel'
import { autoMetaFromSchema } from '@/formflow_ext/autoMeta'
import { parseStoredForm, type FormTemplate } from '@/formflow_ext/templateModel'
import { parseRichXml } from '@/formflow_ext/xml/richXml'

const parser = new FormFlowParser()
const EXT: Record<string, string> = { xml: 'xml', yaml: 'yaml', json: 'json' }

type Loaded = {
  name: string
  source: string
  template: FormTemplate
  values: Record<string, unknown>
  tokenValues: Record<string, string>
}

/** Unauthenticated share route: `/f/:slug`. No Shell / AuthGate. */
export function PublicFillPage() {
  useApplyTheme()
  const { slug } = useParams()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!slug) return
    api
      .get<{ template: PublicTemplate }>(`/public/templates/${slug}`)
      .then(({ template }) => {
        const saved = parseStoredForm(template.formJson)
        if (saved) {
          setLoaded({
            name: template.name,
            source: template.body,
            template: { schema: saved.schema, meta: saved.meta, tokens: saved.tokens },
            values: saved.values,
            tokenValues: saved.tokenValues,
          })
          return
        }
        const rich = parseRichXml(template.body)
        const schema = rich?.schema ?? parser.parse(template.body)
        setLoaded({
          name: template.name,
          source: template.body,
          template: { schema, meta: autoMetaFromSchema(schema), tokens: [] },
          values: rich?.seed ?? defaultValuesFromFields(schema.fields),
          tokenValues: {},
        })
      })
      .catch((e) =>
        setError(e instanceof ApiError && e.status === 404 ? 'This form link is not available.' : String(e)),
      )
  }, [slug])

  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-4 py-10">
      <div className="mb-6 flex items-center gap-2">
        <Leaf className="size-6" />
        <span className="font-semibold">FormFromFile</span>
      </div>
      {error ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">{error}</Card>
      ) : !loaded ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{loaded.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <FillForm
              template={loaded.template}
              source={loaded.source}
              initialValues={loaded.values}
              initialTokenValues={loaded.tokenValues}
              ext={EXT[loaded.template.schema.format] ?? 'txt'}
              onSubmit={async ({ values, output, submitter }) => {
                await api.post(`/public/templates/${slug}/submissions`, {
                  submitter,
                  valuesJson: JSON.stringify(values),
                  output,
                })
              }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
