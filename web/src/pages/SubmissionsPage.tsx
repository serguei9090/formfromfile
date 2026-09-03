import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, Download } from 'lucide-react'
import { api } from '@/api/client'
import type { SubmissionRecord, SubmissionSummary } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function SubmissionsPage() {
  const { id } = useParams()
  const [list, setList] = useState<SubmissionSummary[] | null>(null)
  const [open, setOpen] = useState<SubmissionRecord | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    api
      .get<{ submissions: SubmissionSummary[] }>(`/schemas/${id}/submissions`)
      .then(({ submissions }) => setList(submissions ?? []))
      .catch((e) => setError(msg(e)))
  }, [id])

  async function view(sid: string) {
    try {
      const { submission } = await api.get<{ submission: SubmissionRecord }>(`/submissions/${sid}`)
      setOpen(submission)
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
              <Button variant="ghost" size="sm" onClick={() => setOpen(null)}>
                Close
              </Button>
            </div>
            <pre className="max-h-96 overflow-auto rounded-md border border-border/60 bg-muted p-3 font-mono text-xs">
              {open.output}
            </pre>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
