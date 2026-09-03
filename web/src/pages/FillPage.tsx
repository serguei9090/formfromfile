import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FillForm } from '@/designer/FillForm'
import { FormFlowParser } from '@/core/form_flow/formFlowParser'
import { defaultValuesFromFields } from '@/core/form_flow/schemaModel'
import { autoMetaFromSchema } from '@/formflow_ext/autoMeta'
import { parseStoredForm, type FormTemplate } from '@/formflow_ext/templateModel'
import { parseRichXml } from '@/formflow_ext/xml/richXml'
import { useSchemasStore } from '@/stores/schemasStore'

const parser = new FormFlowParser()
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const EXT: Record<string, string> = { xml: 'xml', yaml: 'yaml', json: 'json' }

type Loaded = {
  name: string
  source: string
  template: FormTemplate
  values: Record<string, unknown>
  tokenValues: Record<string, string>
}

/** Fill one of your own saved templates (`/fill/:id`). Public share is F11. */
export function FillPage() {
  const { id } = useParams()
  const getSchema = useSchemasStore((s) => s.get)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    void getSchema(id)
      .then((rec) => {
        const saved = parseStoredForm(rec.formJson)
        if (saved) {
          setLoaded({
            name: rec.name,
            source: rec.body,
            template: { schema: saved.schema, meta: saved.meta, tokens: saved.tokens },
            values: saved.values,
            tokenValues: saved.tokenValues,
          })
          return
        }
        const rich = parseRichXml(rec.body)
        const schema = rich?.schema ?? parser.parse(rec.body)
        setLoaded({
          name: rec.name,
          source: rec.body,
          template: { schema, meta: autoMetaFromSchema(schema), tokens: [] },
          values: rich?.seed ?? defaultValuesFromFields(schema.fields),
          tokenValues: {},
        })
      })
      .catch((e) => setError(msg(e)))
  }, [id, getSchema])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!loaded) return <p className="text-sm text-muted-foreground">Loading…</p>

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-muted-foreground hover:text-foreground" aria-label="Back">
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{loaded.name}</h1>
        <Link to={`/designer/${id}`} className="ml-auto text-xs text-muted-foreground underline">
          Edit template
        </Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Fill</CardTitle>
        </CardHeader>
        <CardContent>
          <FillForm
            template={loaded.template}
            source={loaded.source}
            initialValues={loaded.values}
            initialTokenValues={loaded.tokenValues}
            ext={EXT[loaded.template.schema.format] ?? 'txt'}
          />
        </CardContent>
      </Card>
    </div>
  )
}
