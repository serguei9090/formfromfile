import { useEffect } from 'react'
import { Link } from 'react-router'
import { useState } from 'react'
import { Check, FilePlus2, Link2, PencilLine, SquarePen, Trash2 } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useSchemasStore } from '@/stores/schemasStore'

export function HomePage() {
  const list = useSchemasStore((s) => s.list)
  const loading = useSchemasStore((s) => s.loading)
  const error = useSchemasStore((s) => s.error)
  const refresh = useSchemasStore((s) => s.refresh)
  const remove = useSchemasStore((s) => s.remove)
  const publish = useSchemasStore((s) => s.publish)
  const unpublish = useSchemasStore((s) => s.unpublish)
  const [copied, setCopied] = useState('')

  async function share(id: string, slug?: string) {
    const s = slug ?? (await publish(id)).shareSlug
    if (!s) return
    const url = `${location.origin}/f/${s}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(id)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      prompt('Share link:', url)
    }
  }

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Forms</h1>
          <p className="text-sm text-muted-foreground">
            Upload an XML or YAML file, get a form, fill it, export the result.
          </p>
        </div>
        <Link to="/designer" className={buttonVariants()}>
          <FilePlus2 className="size-4" /> New form
        </Link>
      </div>

      {error ? (
        <Card className="border-destructive/40 p-4 text-sm text-destructive" role="alert">
          {error} ·{' '}
          <button className="underline" onClick={() => void refresh()}>
            Retry
          </button>
        </Card>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : list.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          No saved forms yet. Open the designer and save one.
        </Card>
      ) : (
        <div className="grid gap-2">
          {list.map((s) => (
            <Card key={s.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{s.name}</span>
                  {s.visibility === 'shared' ? (
                    <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
                      shared
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  <span className="uppercase">{s.kind}</span> · edited{' '}
                  {new Date(s.updatedAt).toLocaleString()}
                  {s.visibility === 'shared' ? (
                    <>
                      {' · '}
                      <Link to={`/schemas/${s.id}/submissions`} className="underline">
                        submissions
                      </Link>
                    </>
                  ) : null}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void share(s.id, s.shareSlug)}
                title={s.visibility === 'shared' ? 'Copy share link' : 'Publish + copy link'}
              >
                {copied === s.id ? <Check className="size-4" /> : <Link2 className="size-4" />}
                {s.visibility === 'shared' ? 'Copy link' : 'Publish'}
              </Button>
              {s.visibility === 'shared' ? (
                <Button variant="ghost" size="sm" onClick={() => void unpublish(s.id)}>
                  Unpublish
                </Button>
              ) : null}
              <Link
                to={`/fill/${s.id}`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <PencilLine className="size-4" /> Fill
              </Link>
              <Link
                to={`/designer/${s.id}`}
                className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                aria-label="Edit template"
              >
                <SquarePen className="size-4" />
              </Link>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete"
                onClick={() => {
                  if (confirm(`Delete "${s.name}"?`)) void remove(s.id)
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
