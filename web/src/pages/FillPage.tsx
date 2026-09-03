import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FillForm } from '@/designer/FillForm'
import { autoMetaFromSchema } from '@/formflow_ext/autoMeta'
import { parseStoredForm, type FormTemplate } from '@/formflow_ext/templateModel'
import { parseSource } from '@/formflow_ext/formats'
import { useSchemasStore } from '@/stores/schemasStore'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

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
  const location = useLocation()
  const prefill = (location.state as { prefillValues?: Record<string, unknown> } | null)?.prefillValues
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
            template: {
              schema: saved.schema,
              meta: saved.meta,
              tokens: saved.tokens,
              formatId: saved.formatId,
            },
            values: saved.values,
            tokenValues: saved.tokenValues,
          })
          return
        }
        const p = parseSource(rec.body)
        setLoaded({
          name: rec.name,
          source: rec.body,
          template: {
            schema: p.schema,
            meta: autoMetaFromSchema(p.schema),
            tokens: [],
            formatId: p.formatId,
          },
          values: p.seed,
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
            key={prefill ? 'prefilled' : 'fresh'}
            template={loaded.template}
            source={loaded.source}
            initialValues={prefill ?? loaded.values}
            initialTokenValues={loaded.tokenValues}
            draftKey={prefill ? undefined : `fill:${id}`}
          />
        </CardContent>
      </Card>
    </div>
  )
}
