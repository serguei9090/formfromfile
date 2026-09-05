import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { ArrowLeft, Copy, Download, Eye, EyeOff, FileDown, FileSearch, Save, Upload } from 'lucide-react'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FileDropField } from '@/app/FileDropField'
import { FormFields, type FieldCtx } from '@/designer/FormFields'
import { FillForm } from '@/designer/FillForm'
import { SchemaTree } from '@/designer/SchemaTree'
import { reseedPreserving, setFieldTypeAt } from '@/designer/schemaEdit'
import {
  defaultValuesFromFields,
  type FieldType,
  type FormFlowSchema,
} from '@/core/form_flow/schemaModel'
import type { SchemaKind, TemplateVersion } from '@/api/types'
import { pruneMetaMap, setMetaAt, walkPaths, type FieldMetaMap } from '@/formflow_ext/fieldMeta'
import { RulesEditor } from '@/designer/RulesEditor'
import { autoMetaFromSchema } from '@/formflow_ext/autoMeta'
import { parseStoredForm, serializeStoredForm, type TokenSpec } from '@/formflow_ext/templateModel'
import { applyTokens, pruneTokenValues, scanTokens } from '@/formflow_ext/tokens'
import { withComputed } from '@/formflow_ext/rules'
import type { Rule } from '@/formflow_ext/rules'
import {
  FORMAT_ACCEPT,
  extensionFor,
  parseSource,
  renderTemplate,
} from '@/formflow_ext/formats'
import { importJsonSchema, looksLikeJsonSchema } from '@/formflow_ext/importers/jsonSchema'
import { importXsdSchema, looksLikeXsdSchema } from '@/formflow_ext/importers/xsdSchema'
import { generateXsd } from '@/formflow_ext/exporters/xsdGenerate'
import { valuesFromFilledFile } from '@/formflow_ext/reverseFill'
import { sampleById } from '@/data/samples'
import { useSchemasStore } from '@/stores/schemasStore'
import { useAuthStore } from '@/stores/authStore'
import { api } from '@/api/client'

type Values = Record<string, unknown>

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function DesignerPage() {
  const { id } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const create = useSchemasStore((s) => s.create)
  const update = useSchemasStore((s) => s.update)
  const getSchema = useSchemasStore((s) => s.get)
  const listVersions = useSchemasStore((s) => s.versions)
  const rollback = useSchemasStore((s) => s.rollback)
  const aiEnabled = useAuthStore((s) => s.aiEnabled)
  const [aiBusy, setAiBusy] = useState('')
  const [aiPrompt, setAiPrompt] = useState('')

  const [source, setSource] = useState('')
  const [schema, setSchema] = useState<FormFlowSchema | null>(null)
  const [formatId, setFormatId] = useState('json')
  const [xmlPreserveOrder, setXmlPreserveOrder] = useState(false)
  const [meta, setMeta] = useState<FieldMetaMap>({})
  const [tokens, setTokens] = useState<TokenSpec[]>([])
  const [tokenValues, setTokenValues] = useState<Record<string, string>>({})
  const [rules, setRules] = useState<Rule[]>([])
  const [name, setName] = useState('')
  const [parseError, setParseError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [output, setOutput] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')
  const [preview, setPreview] = useState(false)
  // live form panel next to Schema, in Design mode — off by default so
  // Schema gets the full width; Fill preview already covers filling/export.
  const [showLiveForm, setShowLiveForm] = useState(false)
  const [saveNotes, setSaveNotes] = useState('')
  const [folder, setFolder] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [history, setHistory] = useState<TemplateVersion[] | null>(null)
  const [tipHidden, setTipHidden] = useState(() => {
    try {
      return localStorage.getItem('fff:tip:designer') === '1'
    } catch {
      return false
    }
  })
  function dismissTip() {
    setTipHidden(true)
    try {
      localStorage.setItem('fff:tip:designer', '1')
    } catch {
      /* ignore */
    }
  }

  const form = useForm<Values>({ defaultValues: {} })

  useEffect(() => {
    if (!id) return
    void getSchema(id).then((rec) => {
      setName(rec.name)
      setFolder(rec.folder ?? '')
      setTagsText((rec.tags ?? []).join(', '))
      setSource(rec.body)
      const saved = parseStoredForm(rec.formJson)
      if (saved) {
        setSchema(saved.schema)
        setFormatId(saved.formatId)
        setXmlPreserveOrder(saved.xmlPreserveOrder ?? false)
        setMeta(saved.meta)
        setTokens(saved.tokens)
        setRules(saved.rules ?? [])
        setTokenValues(saved.tokenValues)
        form.reset(saved.values)
        return
      }
      try {
        const p = parseSource(rec.body)
        setSchema(p.schema)
        setFormatId(p.formatId)
        setMeta(autoMetaFromSchema(p.schema))
        setTokens([])
        setRules([])
        setTokenValues({})
        form.reset(p.seed)
      } catch (e) {
        setParseError(msg(e))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // ?sample=<id> — load a starter file and detect it right away
  useEffect(() => {
    if (id) return
    const s = sampleById(searchParams.get('sample'))
    if (!s) return
    setSource(s.body)
    setName(s.name)
    setSearchParams({}, { replace: true })
    // detect on the next tick so `source` state is in place
    setTimeout(() => detectFrom(s.body), 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function detectFrom(text: string) {
    try {
      let detected: FormFlowSchema
      let seed: Values
      let nextMeta: FieldMetaMap

      if (looksLikeJsonSchema(text)) {
        const imported = importJsonSchema(text)
        detected = imported.schema
        nextMeta = imported.meta
        seed = defaultValuesFromFields(detected.fields)
        setFormatId('json')
      } else if (looksLikeXsdSchema(text)) {
        const imported = importXsdSchema(text)
        detected = imported.schema
        nextMeta = imported.meta
        seed = defaultValuesFromFields(detected.fields)
        setFormatId('xml')
        // the .xsd itself isn't valid target XML — start export from a clean slate
        setSource('')
      } else {
        const p = parseSource(text)
        detected = p.schema
        seed = p.seed
        nextMeta = autoMetaFromSchema(detected)
        setFormatId(p.formatId)
      }

      setSchema(detected)
      setMeta(nextMeta)
      setTokens(scanTokens(seed))
      setRules([])
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

  const detect = () => detectFrom(source)

  async function aiSuggest() {
    if (!schema) return
    setAiBusy('suggest')
    try {
      const { meta: suggested } = await api.post<{ meta: Record<string, Partial<FieldMetaMap[string]>> }>(
        '/ai/suggest-meta',
        { schema: JSON.stringify(schema), values: JSON.stringify(form.getValues()) },
      )
      setMeta((m) => {
        let next = m
        for (const [path, patch] of Object.entries(suggested)) next = setMetaAt(next, path, patch)
        return next
      })
    } catch (e) {
      setParseError(msg(e))
    } finally {
      setAiBusy('')
    }
  }

  async function aiFromPrompt() {
    if (!aiPrompt.trim()) return
    setAiBusy('prompt')
    try {
      const { body, kind } = await api.post<{ body: string; kind: string }>('/ai/schema-from-prompt', {
        description: aiPrompt,
        format: '',
      })
      setSource(body)
      setName(kind ? `AI ${kind} template` : 'AI template')
      detectFrom(body)
    } catch (e) {
      setParseError(msg(e))
    } finally {
      setAiBusy('')
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
      const rendered = renderTemplate(
        formatId,
        schema,
        withComputed(meta, form.getValues()),
        source,
        { xmlPreserveOrder },
      )
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
    a.download = `${(name || 'form').replace(/\s+/g, '-')}.${extensionFor(formatId)}`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function downloadXsd() {
    if (!schema) return
    const blob = new Blob([generateXsd(schema)], { type: 'application/xml' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(name || 'schema').replace(/\s+/g, '-')}.xsd`
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
        kind: formatId as SchemaKind,
        body: source,
        folder: folder.trim(),
        tags: tagsText
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        notes: saveNotes.trim(),
        formJson: serializeStoredForm({
          schema,
          values: form.getValues(),
          meta,
          tokens,
          rules,
          tokenValues,
          formatId,
          xmlPreserveOrder,
        }),
      }
      if (id) {
        await update(id, payload)
        setSaveNotes('')
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

  const watched = form.watch()
  const ctx = useMemo<FieldCtx>(
    () => ({
      control: form.control,
      reg: (n, o) => form.register(n as never, o),
      meta,
      values: watched,
    }),
    [form, meta, watched],
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className="text-muted-foreground hover:text-foreground" aria-label="Back to My Forms">
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Designer</h1>
        {schema ? (
          <span className="rounded bg-accent px-2 py-0.5 text-xs font-medium uppercase text-accent-foreground">
            {formatId}
          </span>
        ) : null}
        <div className="flex-1" />
        {schema ? (
          <>
            <div className="inline-flex overflow-hidden rounded-md border border-border text-xs">
              <button
                className={`px-2.5 py-1.5 ${!preview ? 'bg-primary text-primary-foreground' : ''}`}
                onClick={() => setPreview(false)}
              >
                Design
              </button>
              <button
                className={`px-2.5 py-1.5 ${preview ? 'bg-primary text-primary-foreground' : ''}`}
                onClick={() => setPreview(true)}
              >
                Fill preview
              </button>
            </div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Form name"
              className="h-9 w-40"
            />
            <Input
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="Folder"
              className="h-9 w-28"
            />
            <Input
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="tags, comma"
              className="h-9 w-32"
            />
            {id ? (
              <Input
                value={saveNotes}
                onChange={(e) => setSaveNotes(e.target.value)}
                placeholder="What changed? (version note)"
                className="h-9 w-48"
              />
            ) : null}
            {aiEnabled ? (
              <Button
                variant="outline"
                onClick={() => void aiSuggest()}
                disabled={aiBusy === 'suggest'}
              >
                ✨ {aiBusy === 'suggest' ? 'Thinking…' : 'Suggest labels & validation'}
              </Button>
            ) : null}
            <Button onClick={() => void save()} disabled={saving}>
              <Save className="size-4" /> {id ? 'Save version' : 'Save new'}
            </Button>
          </>
        ) : null}
      </div>
      {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}

      {schema && !tipHidden ? (
        <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/[0.04] p-3 text-xs">
          <span>
            Open <span className="text-primary">⚙</span> on any field for a label, help text and
            validation. Flip to <span className="font-medium">Fill preview</span> to see what the
            filler gets. <span className="font-medium">Save</span>, then{' '}
            <span className="font-medium">Publish</span> to share a link.
          </span>
          <button className="ml-auto shrink-0 underline" onClick={dismissTip}>
            Got it
          </button>
        </div>
      ) : null}

      {!schema ? (
        <Card>
          <CardHeader>
            <CardTitle>Paste or drop an XML / YAML / JSON file</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <FileDropField
              value={source}
              onChange={setSource}
              accept={FORMAT_ACCEPT}
              placeholder={'<config>\n  <enabled>true</enabled>\n</config>'}
            />
            {parseError ? <p className="text-sm text-destructive">{parseError}</p> : null}
            <Button onClick={detect} disabled={!source.trim()}>
              <FileSearch className="size-4" /> Detect schema
            </Button>
            {aiEnabled ? (
              <div className="space-y-2 border-t border-border/50 pt-3">
                <p className="text-xs text-muted-foreground">…or describe the config you need:</p>
                <div className="flex gap-2">
                  <Input
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="e.g. a Postgres connection config with pool size and SSL"
                  />
                  <Button
                    variant="outline"
                    onClick={() => void aiFromPrompt()}
                    disabled={aiBusy === 'prompt' || !aiPrompt.trim()}
                  >
                    ✨ {aiBusy === 'prompt' ? 'Generating…' : 'Generate'}
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : preview ? (
        <Card>
          <CardHeader>
            <CardTitle>Fill preview — exactly what a filler sees</CardTitle>
          </CardHeader>
          <CardContent>
            <FillForm
              key={JSON.stringify(meta) + tokens.length}
              template={{ schema, meta, tokens, rules, formatId, xmlPreserveOrder }}
              source={source}
              initialValues={form.getValues()}
              initialTokenValues={tokenValues}
            />
          </CardContent>
        </Card>
      ) : (
        <div className={`grid gap-5 ${showLiveForm ? 'lg:grid-cols-2' : 'grid-cols-1'}`}>
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Schema</CardTitle>
              <button
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent"
                onClick={() => setShowLiveForm((v) => !v)}
                aria-pressed={showLiveForm}
                title="Show a live form next to the schema, for quick value edits without leaving Design"
              >
                {showLiveForm ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                {showLiveForm ? 'Hide live form' : 'Show live form'}
              </button>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-muted-foreground">
                Set a field's type, then open <span className="text-primary">⚙</span> for label,
                help and validation. Retyping keeps values on branches that didn't change shape.
              </p>
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter fields…"
                className="mb-3 h-8"
              />
              <SchemaTree
                fields={schema.fields}
                onRetype={retype}
                meta={meta}
                onMeta={(kp, patch) => setMeta((m) => setMetaAt(m, kp, patch))}
                filter={filter}
              />
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                  Cross-field rules ({rules.length})
                </summary>
                <div className="mt-2">
                  <RulesEditor rules={rules} paths={walkPaths(schema.fields)} onChange={setRules} />
                </div>
              </details>
              {formatId === 'xml' ? (
                <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-primary"
                    checked={xmlPreserveOrder}
                    onChange={(e) => setXmlPreserveOrder(e.target.checked)}
                  />
                  Keep comments in their exact position (slower, rebuilds repeated blocks)
                </label>
              ) : null}
              {formatId === 'xml' ? (
                <Button variant="ghost" size="sm" className="mt-2" onClick={downloadXsd}>
                  <FileDown className="size-4" /> Generate .xsd from this schema
                </Button>
              ) : null}
              {id ? (
                <div className="mt-3">
                  <button
                    className="text-xs text-muted-foreground underline"
                    onClick={async () =>
                      setHistory(history ? null : await listVersions(id))
                    }
                  >
                    {history ? 'Hide' : 'Show'} version history
                  </button>
                  {history ? (
                    <ul className="mt-2 space-y-1 text-xs">
                      {history.map((v) => (
                        <li key={v.id} className="flex items-center gap-2">
                          <span className="font-mono">v{v.version}</span>
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {v.notes || '—'} · {new Date(v.createdAt).toLocaleDateString()}
                          </span>
                          {v.version !== history[0].version ? (
                            <button
                              className="text-primary underline"
                              onClick={async () => {
                                if (!confirm(`Roll back to v${v.version}?`)) return
                                await rollback(id, v.version)
                                location.reload()
                              }}
                            >
                              roll back
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
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

          {showLiveForm ? (
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
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent">
                <Upload className="size-3.5" /> Load values from a filled file
                <input
                  type="file"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (!f || !schema) return
                    const aligned = valuesFromFilledFile(schema, await f.text())
                    if (aligned) form.reset(aligned)
                    else setParseError("Couldn't read that file as the same format.")
                  }}
                />
              </label>
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
          ) : null}
        </div>
      )}
    </div>
  )
}
