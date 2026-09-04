import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, Download, RotateCcw, Trash2 } from 'lucide-react'
import { api } from '@/api/client'
import type {
  Comment,
  SchemaRecord,
  SubmissionRecord,
  SubmissionSummary,
  Webhook,
} from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DiffView } from '@/designer/DiffView'
import { parseStoredForm } from '@/formflow_ext/templateModel'
import { parseSource } from '@/formflow_ext/formats'
import { alignValues } from '@/formflow_ext/reverseFill'
import { useSchemasStore } from '@/stores/schemasStore'

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
  const [comments, setComments] = useState<Comment[]>([])
  const [commentBody, setCommentBody] = useState('')
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [webhookUrl, setWebhookUrl] = useState('')
  const setApproval = useSchemasStore((s) => s.setApproval)

  useEffect(() => {
    if (!id) return
    api
      .get<{ webhooks: Webhook[] }>(`/schemas/${id}/webhooks`)
      .then((r) => setWebhooks(r.webhooks ?? []))
      .catch(() => {})
  }, [id])

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
      const { comments: cs } = await api.get<{ comments: Comment[] }>(`/submissions/${sid}/comments`)
      setComments(cs ?? [])
    } catch (e) {
      setError(msg(e))
    }
  }

  async function postComment() {
    if (!open || !commentBody.trim()) return
    try {
      const { comment } = await api.post<{ comment: Comment }>(
        `/submissions/${open.id}/comments`,
        { body: commentBody },
      )
      setComments((c) => [...c, comment])
      setCommentBody('')
    } catch (e) {
      setError(msg(e))
    }
  }

  async function addWebhook() {
    if (!id || !webhookUrl.trim()) return
    try {
      const { webhook } = await api.post<{ webhook: Webhook }>(`/schemas/${id}/webhooks`, {
        url: webhookUrl,
        events: ['submission.created'],
      })
      setWebhooks((w) => [...w, webhook])
      setWebhookUrl('')
    } catch (e) {
      setError(msg(e))
    }
  }

  async function removeWebhook(wid: string) {
    await api.del(`/webhooks/${wid}`)
    setWebhooks((w) => w.filter((x) => x.id !== wid))
  }

  async function review(sid: string, approved: boolean) {
    const note = approved ? '' : prompt('Reason (optional):') ?? ''
    try {
      const { submission } = await api.post<{ submission: SubmissionRecord }>(
        `/submissions/${sid}/review`,
        { approved, note },
      )
      setOpen(submission)
      setList((l) => (l ? l.map((s) => (s.id === sid ? { ...s, status: submission.status } : s)) : l))
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
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void exportCsv()}>
              <Download className="size-4" /> CSV
            </Button>
            <a
              href={`/api/schemas/${id}/submissions.zip`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs hover:bg-accent"
            >
              <Download className="size-4" /> ZIP
            </a>
          </div>
        ) : null}
      </div>

      {template ? (
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>
            {list?.length ?? 0} submissions · {template.viewCount} opens
            {template.viewCount > 0
              ? ` · ${Math.round(((list?.length ?? 0) / template.viewCount) * 100)}% completion`
              : ''}
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={template.requiresApproval}
              onChange={async (e) => {
                const updated = await setApproval(template.id, e.target.checked)
                setTemplate(updated)
              }}
            />
            Require review before a submission counts (approval queue)
          </label>
          <label className="flex items-center gap-2">
            Close after
            <input
              type="number"
              min={0}
              className="h-7 w-20 rounded-md border border-input bg-card px-2"
              defaultValue={template.submissionCap || 0}
              onBlur={async (e) => {
                const cap = Number(e.target.value) || 0
                await api.post(`/schemas/${template.id}/ops`, {
                  submissionCap: cap,
                  brand: template.brand ?? '',
                  retentionDays: template.retentionDays ?? 0,
                })
                setTemplate({ ...template, submissionCap: cap })
              }}
            />
            submissions (0 = unlimited)
          </label>
          <label className="flex items-center gap-2">
            Delete submissions older than
            <input
              type="number"
              min={0}
              className="h-7 w-20 rounded-md border border-input bg-card px-2"
              defaultValue={template.retentionDays || 0}
              onBlur={async (e) => {
                const retentionDays = Number(e.target.value) || 0
                await api.post(`/schemas/${template.id}/ops`, {
                  submissionCap: template.submissionCap,
                  brand: template.brand ?? '',
                  retentionDays,
                })
                setTemplate({ ...template, retentionDays })
              }}
            />
            days (0 = keep forever)
          </label>
          <label className="flex items-center gap-2">
            Public page accent
            <input
              type="color"
              className="h-7 w-12"
              defaultValue={(() => {
                try {
                  return JSON.parse(template.brand || '{}').accent || '#059669'
                } catch {
                  return '#059669'
                }
              })()}
              onBlur={async (e) => {
                const brand = JSON.stringify({ accent: e.target.value })
                await api.post(`/schemas/${template.id}/ops`, {
                  submissionCap: template.submissionCap,
                  brand,
                  retentionDays: template.retentionDays ?? 0,
                })
                setTemplate({ ...template, brand })
              }}
            />
          </label>
        </div>
      ) : null}

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          Webhooks ({webhooks.length}) — POST each submission to a URL
        </summary>
        <div className="mt-2 space-y-2">
          {webhooks.map((wh) => (
            <div key={wh.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono">{wh.url}</span>
              <button className="text-destructive underline" onClick={() => void removeWebhook(wh.id)}>
                remove
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              className="h-8 flex-1 rounded-md border border-input bg-card px-2"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://ci.example.com/hook"
            />
            <Button variant="outline" size="sm" onClick={() => void addWebhook()}>
              Add
            </Button>
          </div>
        </div>
      </details>
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
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{s.submitter || 'Anonymous'}</span>
                  {s.status !== 'approved' ? (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${s.status === 'pending' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-destructive/15 text-destructive'}`}
                    >
                      {s.status}
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(s.createdAt).toLocaleString()}
                  {s.templateVersion ? ` · v${s.templateVersion}` : ''}
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
              {open.status === 'pending' ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => void review(open.id, true)}>
                    Approve
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void review(open.id, false)}>
                    Reject
                  </Button>
                </>
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

            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">Comments</div>
              {comments.map((c) => (
                <div key={c.id} className="text-xs">
                  <span className="font-medium">{c.authorName || 'You'}</span>{' '}
                  <span className="text-muted-foreground">
                    {new Date(c.createdAt).toLocaleString()}
                  </span>
                  <p className="whitespace-pre-wrap">{c.body}</p>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  className="h-8 flex-1 rounded-md border border-input bg-card px-2 text-sm"
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  placeholder="Add a comment…"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void postComment()
                  }}
                />
                <Button variant="outline" size="sm" onClick={() => void postComment()}>
                  Post
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
