import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate, useParams } from 'react-router'
import { Copy, Download, FileSearch, Save } from 'lucide-react'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FileDropField } from '@/app/FileDropField'
import { FormFields, type FieldCtx } from '@/designer/FormFields'
import { SchemaTree } from '@/designer/SchemaTree'
import { reseedPreserving, setFieldTypeAt } from '@/designer/schemaEdit'
import { FormFlowParser } from '@/core/form_flow/formFlowParser'
import {
  SOURCE_FORMAT_LABELS,
  defaultValuesFromFields,
  type FieldType,
  type FormFlowSchema,
} from '@/core/form_flow/schemaModel'
import { pruneMetaMap, setMetaAt, type FieldMetaMap } from '@/formflow_ext/fieldMeta'
import { autoMetaFromSchema } from '@/formflow_ext/autoMeta'
import { parseStoredForm, serializeStoredForm, type TokenSpec } from '@/formflow_ext/templateModel'
import { applyTokens, pruneTokenValues, scanTokens } from '@/formflow_ext/tokens'
import { parseRichXml, renderRichXml } from '@/formflow_ext/xml/richXml'
import { useSchemasStore } from '@/stores/schemasStore'

const parser = new FormFlowParser()
type Values = Record<string, unknown>

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const EXT: Record<string, string> = { xml: 'xml', yaml: 'yaml', json: 'json' }

export function DesignerPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const create = useSchemasStore((s) => s.create)
  const update = useSchemasStore((s) => s.update)
  const getSchema = useSchemasStore((s) => s.get)

  const [source, setSource] = useState('')
  const [schema, setSchema] = useState<FormFlowSchema | null>(null)
  const [meta, setMeta] = useState<FieldMetaMap>({})
  const [tokens, setTokens] = useState<TokenSpec[]>([])
  const [tokenValues, setTokenValues] = useState<Record<string, string>>({})
  const [name, setName] = useState('')
  const [parseError, setParseError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [output, setOutput] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const form = useForm<Values>({ defaultValues: {} })

  useEffect(() => {
    if (!id) return
    void getSchema(id).then((rec) => {
      setName(rec.name)
      setSource(rec.body)
      const saved = parseStoredForm(rec.formJson)
      if (saved) {
        setSchema(saved.schema)
        setMeta(saved.meta)
        setTokens(saved.tokens)
        setTokenValues(saved.tokenValues)
        form.reset(saved.values)
        return
      }
      try {
        const s = parser.parse(rec.body)
        setSchema(s)
        setMeta({})
        setTokens([])
        setTokenValues({})
        form.reset(defaultValuesFromFields(s.fields))
      } catch (e) {
        setParseError(msg(e))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  function detect() {
    try {
      const s = parser.parse(source)
      // XML: re-parse with attributes + comments preserved (core drops them).
      const rich = s.format === 'xml' ? parseRichXml(source) : null
      const detected = rich?.schema ?? s
      const seed = rich?.seed ?? defaultValuesFromFields(s.fields)
      setSchema(detected)
      setMeta(autoMetaFromSchema(detected))
      setTokens(scanTokens(seed))
      setTokenValues({})
      setParseError('')
      setOutput(null)
      form.reset(seed)
      if (!name) setName('Untitled form')
    } catch (e) {
      setParseError(msg(e))
      setSchema(null)
    }
  }

  function retype(path: number[], type: FieldType) {
    setSchema((s) => {
      if (!s) return s
      const next = { ...s, fields: setFieldTypeAt(s.fields, path, type) }
      // keep values on branches that didn't change shape (finding #6)
      const seed = reseedPreserving(next.fields, form.getValues())
      form.reset(seed)
      setMeta((m) => pruneMetaMap(m, next.fields))
      const tk = scanTokens(seed)
      setTokens(tk)
      setTokenValues((tv) => pruneTokenValues(tv, tk))
      setOutput(null)
      return next
    })
  }

  function doExport() {
    if (!schema) return
    try {
      const rendered =
        schema.format === 'xml'
          ? renderRichXml(schema, form.getValues(), source)
          : parser.render(schema, form.getValues())
      setOutput(applyTokens(rendered, tokenValues))
    } catch (e) {
      setParseError(msg(e))
    }
  }

  function downloadOutput() {
    if (!output || !schema) return
    const blob = new Blob([output], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(name || 'form').replace(/\s+/g, '-')}.${EXT[schema.format]}`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function save() {
    if (!schema) return
    setSaving(true)
    setSaveError('')
    try {
      const payload = {
        name: name.trim() || 'Untitled form',
        kind: schema.format,
        body: source,
        formJson: serializeStoredForm({
          schema,
          values: form.getValues(),
          meta,
          tokens,
          tokenValues,
        }),
      }
      if (id) {
        await update(id, payload)
      } else {
        const rec = await create(payload)
        navigate(`/designer/${rec.id}`, { replace: true })
      }
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : msg(e))
    } finally {
      setSaving(false)
    }
  }

  const ctx = useMemo<FieldCtx>(
    () => ({ control: form.control, reg: (n, o) => form.register(n as never, o), meta }),
    [form, meta],
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Designer</h1>
        {schema ? (
          <span className="rounded bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
            {SOURCE_FORMAT_LABELS[schema.format]}
          </span>
        ) : null}
        <div className="flex-1" />
        {schema ? (
          <>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Form name"
              className="h-9 w-48"
            />
            <Button onClick={() => void save()} disabled={saving}>
              <Save className="size-4" /> {id ? 'Save' : 'Save new'}
            </Button>
          </>
        ) : null}
      </div>
      {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}

      {!schema ? (
        <Card>
          <CardHeader>
            <CardTitle>Paste or drop an XML / YAML / JSON file</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <FileDropField
              value={source}
              onChange={setSource}
              accept=".xml,.yaml,.yml,.json"
              placeholder={'<config>\n  <enabled>true</enabled>\n</config>'}
            />
            {parseError ? <p className="text-sm text-destructive">{parseError}</p> : null}
            <Button onClick={detect} disabled={!source.trim()}>
              <FileSearch className="size-4" /> Detect schema
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Schema</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-muted-foreground">
                Set a field's type, then open <span className="text-primary">⚙</span> for label,
                help and validation. Retyping keeps values on branches that didn't change shape.
              </p>
              <SchemaTree
                fields={schema.fields}
                onRetype={retype}
                meta={meta}
                onMeta={(kp, patch) => setMeta((m) => setMetaAt(m, kp, patch))}
              />
              <Button
                variant="ghost"
                size="sm"
                className="mt-4"
                onClick={() => {
                  setSchema(null)
                  setMeta({})
                  setTokens([])
                  setTokenValues({})
                  setOutput(null)
                }}
              >
                ← Load a different file
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Form</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {tokens.length > 0 ? (
                <fieldset className="space-y-2 rounded-md border border-primary/30 bg-primary/[0.03] p-3">
                  <legend className="px-1 text-xs font-semibold text-primary">
                    Tokens — substituted on export
                  </legend>
                  {tokens.map((t) => (
                    <div key={t.token} className="space-y-1">
                      <Label htmlFor={`tok-${t.token}`}>
                        {t.name}{' '}
                        <span className="font-normal text-muted-foreground">
                          {t.token} · {t.occurrences.length}×
                        </span>
                      </Label>
                      <Input
                        id={`tok-${t.token}`}
                        value={tokenValues[t.token] ?? ''}
                        onChange={(e) =>
                          setTokenValues((v) => ({ ...v, [t.token]: e.target.value }))
                        }
                      />
                    </div>
                  ))}
                </fieldset>
              ) : null}
              <form>
                <FormFields fields={schema.fields} prefix="" ctx={ctx} />
              </form>
              <div className="flex gap-2">
                <Button variant="outline" onClick={doExport}>
                  <Download className="size-4" /> Export
                </Button>
              </div>
              {output != null ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-muted-foreground">Output</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void navigator.clipboard.writeText(output)}
                    >
                      <Copy className="size-3.5" /> Copy
                    </Button>
                    <Button variant="ghost" size="sm" onClick={downloadOutput}>
                      <Download className="size-3.5" /> Download
                    </Button>
                  </div>
                  <pre className="max-h-80 overflow-auto rounded-md border border-border/60 bg-muted p-3 font-mono text-xs">
                    {output}
                  </pre>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
