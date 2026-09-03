import { useEffect, useMemo, useState } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { Copy, Download, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FormTemplate } from '@/formflow_ext/templateModel'
import { applyTokens } from '@/formflow_ext/tokens'
import { walkPaths } from '@/formflow_ext/fieldMeta'
import { failingRules, withComputed } from '@/formflow_ext/rules'
import { errorMessageAt, makeResolver } from '@/formflow_ext/validation'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/authStore'
import { extensionFor, renderTemplate } from '@/formflow_ext/formats'
import { valuesFromFilledFile } from '@/formflow_ext/reverseFill'
import { DiffView } from './DiffView'
import { FormFields, type FieldCtx } from './FormFields'

type Values = Record<string, unknown>

function loadDraft(key: string | undefined): { values?: Values; tokenValues?: Record<string, string> } | null {
  if (!key) return null
  try {
    const raw = localStorage.getItem(`fff:draft:${key}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
function saveDraft(key: string | undefined, values: Values, tokenValues: Record<string, string>) {
  if (!key) return
  try {
    localStorage.setItem(`fff:draft:${key}`, JSON.stringify({ values, tokenValues }))
  } catch {
    /* private mode / quota — ignore */
  }
}
function clearDraft(key: string | undefined) {
  if (!key) return
  try {
    localStorage.removeItem(`fff:draft:${key}`)
  } catch {
    /* ignore */
  }
}

/**
 * The fill-only view: no schema tree, no type controls. Validation from the
 * template's `meta` is enforced — export stays disabled until the form is
 * valid. Reused by `FillPage` (`/fill/:id`) and, later, the public share route.
 */
export function FillForm({
  template,
  source,
  initialValues,
  initialTokenValues = {},
  draftKey,
  runCheck,
  onSubmit,
}: {
  template: FormTemplate
  /** Original file text — needed to restore the XML declaration + comments. */
  source: string
  initialValues: Values
  initialTokenValues?: Record<string, string>
  /** localStorage draft namespace, e.g. `fill:<id>` / `f:<slug>`. */
  draftKey?: string
  /** Runs a field's author-configured async check; returns `{ ok, message? }`. */
  runCheck?: (metaPath: string, value: string) => Promise<{ ok?: boolean; message?: string }>
  /** When set, a "Send to team" button POSTs the filled result. */
  onSubmit?: (args: { values: Values; output: string; submitter: string }) => Promise<void>
}) {
  const { schema, meta, tokens, rules, formatId, xmlPreserveOrder } = template
  const resolver = useMemo(
    () => makeResolver(schema, meta, rules) as unknown as Resolver<Values>,
    [schema, meta, rules],
  )
  const draft = useMemo(() => loadDraft(draftKey), [draftKey])
  const form = useForm<Values>({
    defaultValues: draft?.values ?? initialValues,
    resolver,
    mode: 'onChange',
  })
  const [tokenValues, setTokenValues] = useState(draft?.tokenValues ?? initialTokenValues)
  const [output, setOutput] = useState<string | null>(null)
  const [submitter, setSubmitter] = useState('')
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [showDiff, setShowDiff] = useState(false)
  const aiEnabled = useAuthStore((s) => s.aiEnabled)
  const [aiInstruction, setAiInstruction] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [explanation, setExplanation] = useState('')

  async function aiFill() {
    if (!aiInstruction.trim()) return
    setAiBusy(true)
    try {
      const { values } = await api.post<{ values: Record<string, unknown> }>('/ai/fill-assist', {
        schema: JSON.stringify(schema),
        meta: JSON.stringify(meta),
        instruction: aiInstruction,
      })
      form.reset({ ...form.getValues(), ...values })
    } catch {
      /* ignore */
    } finally {
      setAiBusy(false)
    }
  }

  async function aiExplain() {
    setExplanation('…')
    try {
      const { text } = await api.post<{ text: string }>('/ai/explain-diff', {
        format: formatId,
        before: JSON.stringify(initialValues, null, 2),
        after: JSON.stringify(form.getValues(), null, 2),
      })
      setExplanation(text)
    } catch {
      setExplanation('')
    }
  }

  async function loadFromFile(file: File) {
    setLoadError('')
    const text = await file.text()
    const aligned = valuesFromFilledFile(schema, text)
    if (!aligned) {
      setLoadError("Couldn't read that file — expected the same format as the template.")
      return
    }
    form.reset(aligned)
    setShowDiff(true)
  }

  // compute initial validity so Export starts correctly disabled/enabled
  useEffect(() => {
    void form.trigger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // autosave a draft on every change
  useEffect(() => {
    if (!draftKey) return
    const sub = form.watch((values) => saveDraft(draftKey, values as Values, tokenValues))
    return () => sub.unsubscribe()
  }, [form, draftKey, tokenValues])

  // required-field progress
  const requiredPaths = useMemo(
    () => walkPaths(schema.fields).filter((p) => meta[p]?.required),
    [schema, meta],
  )
  const watched = form.watch()
  const requiredDone = requiredPaths.filter((p) => {
    const v = p.split('.').reduce<unknown>((o, k) => (o as Values)?.[k], watched)
    return v != null && String(v).trim() !== ''
  }).length
  const requiredTotal = requiredPaths.length + tokens.length

  const [asyncErrors, setAsyncErrors] = useState<Record<string, string>>({})
  const errors = form.formState.errors
  const ctx: FieldCtx = {
    control: form.control,
    reg: (n, o) => form.register(n as never, o),
    meta,
    values: watched,
    errorFor: (name) => errorMessageAt(errors, name) ?? asyncErrors[name],
    onBlurCheck: async (name, metaPath, value) => {
      if (!runCheck || !value.trim()) return
      try {
        const res = await runCheck(metaPath, value)
        setAsyncErrors((e) => {
          const next = { ...e }
          if (res.ok === false) next[name] = res.message || 'Failed validation'
          else delete next[name]
          return next
        })
      } catch {
        /* ignore transient errors */
      }
    },
    hideLocked: true,
  }
  const brokenRules = failingRules(rules, watched)

  const missingTokens = tokens.filter((t) => !(tokenValues[t.token] ?? '').trim())
  const canExport =
    form.formState.isValid && missingTokens.length === 0 && brokenRules.length === 0
  const done = requiredDone + (tokens.length - missingTokens.length)

  async function doExport() {
    const ok = await form.trigger()
    if (!ok || missingTokens.length > 0 || brokenRules.length > 0) return
    const rendered = renderTemplate(
      formatId,
      schema,
      withComputed(meta, form.getValues()),
      source,
      { xmlPreserveOrder },
    )
    setOutput(applyTokens(rendered, tokenValues))
  }

  function download() {
    if (!output) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([output], { type: 'text/plain' }))
    a.download = `filled.${extensionFor(formatId)}`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-4">
      {aiEnabled ? (
        <div className="flex gap-2">
          <Input
            value={aiInstruction}
            onChange={(e) => setAiInstruction(e.target.value)}
            placeholder="Describe what you need — e.g. passive FTP on 10.0.0.5, RTO auto-approve"
          />
          <Button variant="outline" onClick={() => void aiFill()} disabled={aiBusy || !aiInstruction.trim()}>
            ✨ {aiBusy ? 'Filling…' : 'Fill'}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 hover:bg-accent">
          <Upload className="size-3.5" /> Load values from a filled file
          <input
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void loadFromFile(f)
              e.target.value = ''
            }}
          />
        </label>
        {loadError ? (
          <span role="alert" className="text-destructive">
            {loadError}
          </span>
        ) : null}
      </div>

      {tokens.length > 0 ? (
        <fieldset className="space-y-2 rounded-md border border-primary/30 bg-primary/[0.03] p-3">
          <legend className="px-1 text-xs font-semibold text-primary">Details</legend>
          {tokens.map((t) => (
            <div key={t.token} className="space-y-1">
              <Label htmlFor={`tok-${t.token}`}>{t.name}</Label>
              <Input
                id={`tok-${t.token}`}
                value={tokenValues[t.token] ?? ''}
                onChange={(e) => setTokenValues((v) => ({ ...v, [t.token]: e.target.value }))}
              />
            </div>
          ))}
        </fieldset>
      ) : null}

      <form onSubmit={(e) => e.preventDefault()}>
        <FormFields fields={schema.fields} prefix="" ctx={ctx} />
      </form>

      <button
        type="button"
        className="text-xs text-muted-foreground underline"
        onClick={() => setShowDiff((s) => !s)}
      >
        {showDiff ? 'Hide' : 'Show'} changes from the original
      </button>
      {showDiff ? (
        <>
          <DiffView before={initialValues} after={watched} title="Your changes" />
          {aiEnabled ? (
            <button type="button" className="text-xs text-primary underline" onClick={() => void aiExplain()}>
              ✨ Explain these changes
            </button>
          ) : null}
          {explanation ? (
            <p className="rounded-md border border-border/60 bg-muted/40 p-2 text-xs">{explanation}</p>
          ) : null}
        </>
      ) : null}

      {brokenRules.length > 0 ? (
        <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          {brokenRules.map((r) => (
            <li key={r.id} role="alert">
              {r.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={() => void doExport()} disabled={!canExport}>
          <Download className="size-4" /> Export
        </Button>
        {requiredTotal > 0 ? (
          <span className="text-xs text-muted-foreground">
            {done} of {requiredTotal} required {done === requiredTotal ? '✓' : 'done'}
          </span>
        ) : null}
      </div>

      {output != null && onSubmit ? (
        <div className="space-y-2 rounded-md border border-border/60 p-3">
          {sent ? (
            <div className="space-y-2 text-sm">
              <p className="text-primary">Sent to the team. Thank you!</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  clearDraft(draftKey)
                  form.reset(initialValues)
                  setTokenValues(initialTokenValues)
                  setOutput(null)
                  setSent(false)
                  setSubmitter('')
                }}
              >
                Submit another
              </Button>
            </div>
          ) : (
            <>
              <Label htmlFor="submitter">Your name or email (optional)</Label>
              <Input
                id="submitter"
                value={submitter}
                onChange={(e) => setSubmitter(e.target.value)}
              />
              {sendError ? (
                <p role="alert" className="text-xs text-destructive">
                  {sendError}
                </p>
              ) : null}
              <Button
                disabled={sending}
                onClick={async () => {
                  setSending(true)
                  setSendError('')
                  try {
                    await onSubmit({ values: form.getValues(), output, submitter })
                    clearDraft(draftKey)
                    setSent(true)
                  } catch (e) {
                    setSendError(e instanceof Error ? e.message : String(e))
                  } finally {
                    setSending(false)
                  }
                }}
              >
                Send to team
              </Button>
            </>
          )}
        </div>
      ) : null}

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
            <Button variant="ghost" size="sm" onClick={download}>
              <Download className="size-3.5" /> Download
            </Button>
          </div>
          <pre className="max-h-80 overflow-auto rounded-md border border-border/60 bg-muted p-3 font-mono text-xs">
            {output}
          </pre>
        </div>
      ) : null}
    </div>
  )
}
