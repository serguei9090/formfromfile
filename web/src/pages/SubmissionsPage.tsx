import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, Download, RotateCcw, Trash2 } from 'lucide-react'
import { api } from '@/api/client'
import type { SchemaRecord, SubmissionRecord, SubmissionSummary } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DiffView } from '@/designer/DiffView'
import { parseStoredForm } from '@/formflow_ext/templateModel'
import { parseSource } from '@/formflow_ext/formats'
import { alignValues } from '@/formflow_ext/reverseFill'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

function templateSeed(rec: SchemaRecord): Record<string, unknown> {
  const saved = parseStoredForm(rec.formJson)
  if (saved) return saved.values
  try {
    return parseSource(rec.body).seed
  } catch {
    return {}
  }
}

function flatten(obj: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? `${prefix}.${k}` : k, out)
  } else if (Array.isArray(obj)) {
    obj.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out))
  } else {
    out[prefix] = obj == null ? '' : String(obj)
  }
  return out
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function SubmissionsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [list, setList] = useState<SubmissionSummary[] | null>(null)
  const [open, setOpen] = useState<SubmissionRecord | null>(null)
  const [template, setTemplate] = useState<SchemaRecord | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    api
      .get<{ submissions: SubmissionSummary[] }>(`/schemas/${id}/submissions`)
      .then(({ submissions }) => setList(submissions ?? []))
      .catch((e) => setError(msg(e)))
    api
      .get<{ schema: SchemaRecord }>(`/schemas/${id}`)
      .then(({ schema }) => setTemplate(schema))
      .catch(() => {})
  }, [id])

  function reRun(sub: SubmissionRecord) {
    if (!template) return
    let vals: Record<string, unknown> = {}
    try {
      vals = JSON.parse(sub.valuesJson || '{}')
    } catch {
      /* ignore */
    }
    const schema =
      parseStoredForm(template.formJson)?.schema ?? parseSource(template.body).schema
    navigate(`/fill/${id}`, { state: { prefillValues: alignValues(schema, vals) } })
  }

  async function view(sid: string) {
    try {
      const { submission } = await api.get<{ submission: SubmissionRecord }>(`/submissions/${sid}`)
      setOpen(submission)
    } catch (e) {
      setError(msg(e))
    }
  }

  async function del(sid: string) {
    if (!confirm('Delete this submission?')) return
    try {
      await api.del(`/submissions/${sid}`)
      setList((l) => (l ? l.filter((s) => s.id !== sid) : l))
      if (open?.id === sid) setOpen(null)
    } catch (e) {
      setError(msg(e))
    }
  }

  async function exportCsv() {
    if (!list || list.length === 0) return
    try {
      const full = await Promise.all(
        list.map((s) => api.get<{ submission: SubmissionRecord }>(`/submissions/${s.id}`)),
      )
      const rows = full.map((r) => r.submission)
      const valueKeys = new Set<string>()
      const flat = rows.map((r) => {
        let parsed: unknown = {}
        try {
          parsed = JSON.parse(r.valuesJson || '{}')
        } catch {
          /* ignore */
        }
        const f = flatten(parsed)
        Object.keys(f).forEach((k) => valueKeys.add(k))
        return f
      })
      const cols = ['submitter', 'createdAt', ...[...valueKeys].sort()]
      const lines = [cols.map(csvCell).join(',')]
      rows.forEach((r, i) => {
        lines.push(
          [
            r.submitter || 'Anonymous',
            new Date(r.createdAt).toISOString(),
            ...[...valueKeys].sort().map((k) => flat[i][k] ?? ''),
          ]
            .map((c) => csvCell(String(c)))
            .join(','),
        )
      })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
      a.download = `submissions-${id}.csv`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      setError(msg(e))
    }
  }

  function download(s: SubmissionRecord) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([s.output], { type: 'text/plain' }))
    a.download = `submission-${s.id}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-muted-foreground hover:text-foreground" aria-label="Back">
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Submissions</h1>
        {list && list.length > 0 ? (
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => void exportCsv()}>
            <Download className="size-4" /> Export CSV
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {list == null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : list.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No submissions yet. Publish the template and share its link.
        </Card>
      ) : (
        <div className="grid gap-2">
          {list.map((s) => (
            <Card key={s.id} className="flex items-center gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{s.submitter || 'Anonymous'}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(s.createdAt).toLocaleString()}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => void view(s.id)}>
                View
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete submission"
                onClick={() => void del(s.id)}
              >
                <Trash2 className="size-4" />
              </Button>
            </Card>
          ))}
        </div>
      )}

      {open ? (
        <Card>
          <CardContent className="space-y-2 pt-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">
                {open.submitter || 'Anonymous'} · {new Date(open.createdAt).toLocaleString()}
              </span>
              <Button variant="ghost" size="sm" onClick={() => download(open)}>
                <Download className="size-3.5" /> Download
              </Button>
              {template ? (
                <Button variant="ghost" size="sm" onClick={() => reRun(open)}>
                  <RotateCcw className="size-3.5" /> Re-run on current template
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" onClick={() => setOpen(null)}>
                Close
              </Button>
            </div>
            {template
              ? (() => {
                  let vals: Record<string, unknown> = {}
                  try {
                    vals = JSON.parse(open.valuesJson || '{}')
                  } catch {
                    /* ignore */
                  }
                  return (
                    <DiffView
                      before={templateSeed(template)}
                      after={vals}
                      title="Submitted vs template default"
                      emptyText="Submitted with the template's default values."
                    />
                  )
                })()
              : null}
            <pre className="max-h-96 overflow-auto rounded-md border border-border/60 bg-muted p-3 font-mono text-xs">
              {open.output}
            </pre>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
