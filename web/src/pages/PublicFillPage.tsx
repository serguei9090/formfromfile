import { useEffect, useState, type CSSProperties } from 'react'
import { useParams } from 'react-router'
import { Moon, Sun } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import type { PublicTemplate } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Leaf } from '@/app/Leaf'
import { useApplyTheme, useThemeStore } from '@/stores/themeStore'
import { FillForm } from '@/designer/FillForm'
import { autoMetaFromSchema } from '@/formflow_ext/autoMeta'
import { parseStoredForm, type FormTemplate } from '@/formflow_ext/templateModel'
import { parseSource } from '@/formflow_ext/formats'

type Brand = { accent?: string; logoDataUri?: string }

type Loaded = {
  name: string
  brand?: Brand
  source: string
  template: FormTemplate
  values: Record<string, unknown>
  tokenValues: Record<string, string>
}

/** Unauthenticated share route: `/f/:slug`. No Shell / AuthGate. */
export function PublicFillPage() {
  useApplyTheme()
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggle)
  const { slug } = useParams()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!slug) return
    api
      .get<{ template: PublicTemplate }>(`/public/templates/${slug}`)
      .then(({ template }) => {
        const brand: Brand = (() => { try { return JSON.parse(template.brand || "{}") } catch { return {} } })();
        const saved = parseStoredForm(template.formJson)
        if (saved) {
          setLoaded({
            name: template.name,
            brand,
            source: template.body,
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
        const p = parseSource(template.body)
        setLoaded({
          name: template.name,
            brand,
          source: template.body,
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
      .catch((e) =>
        setError(e instanceof ApiError && e.status === 404 ? 'This form link is not available.' : String(e)),
      )
  }, [slug])

  const accentStyle = loaded?.brand?.accent
    ? ({ ['--primary' as string]: loaded.brand.accent } as CSSProperties)
    : undefined

  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-4 py-10" style={accentStyle}>
      <div className="mb-6 flex items-center gap-2">
        {loaded?.brand?.logoDataUri ? (
          <img src={loaded.brand.logoDataUri} alt="" className="h-6 w-auto" />
        ) : (
          <Leaf className="size-6" />
        )}
        <span className="font-semibold">{loaded?.name ?? 'FormFromFile'}</span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          onClick={toggleTheme}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
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
              draftKey={`f:${slug}`}
              runCheck={async (metaPath, value) =>
                api.post(`/public/templates/${slug}/check`, { path: metaPath, value })
              }
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
