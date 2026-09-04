import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Check, Copy, FilePlus2, Link2, PencilLine, SquarePen, Trash2 } from 'lucide-react'
import { api } from '@/api/client'
import { buttonVariants } from '@/components/ui/button'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { SAMPLES } from '@/data/samples'
import { useSchemasStore } from '@/stores/schemasStore'
import { useAuthStore } from '@/stores/authStore'

export function HomePage() {
  const list = useSchemasStore((s) => s.list)
  const loading = useSchemasStore((s) => s.loading)
  const error = useSchemasStore((s) => s.error)
  const filter = useSchemasStore((s) => s.filter)
  const setFilter = useSchemasStore((s) => s.setFilter)
  const refresh = useSchemasStore((s) => s.refresh)
  const remove = useSchemasStore((s) => s.remove)
  const publish = useSchemasStore((s) => s.publish)
  const unpublish = useSchemasStore((s) => s.unpublish)
  const fork = useSchemasStore((s) => s.fork)
  const role = useAuthStore((s) => s.user?.role)
  const canAuthor = role === 'admin' || role === 'author'
  const [copied, setCopied] = useState('')

  const allFolders = [...new Set(list.map((s) => s.folder).filter(Boolean))].sort()
  const allTags = [...new Set(list.flatMap((s) => s.tags))].sort()

  // `already` must reflect current visibility, not just a non-empty slug —
  // UnpublishSchema keeps the slug around (so republishing reuses the same
  // link) but the template is private again, so a stale slug alone must not
  // skip the publish call on the next "Publish" click.
  async function share(id: string, already: boolean, slug?: string) {
    let s = slug
    if (!already) {
      // asked once, at the moment a template first goes live — later changes
      // of mind go through the "Who can access this link" control on the
      // submissions page.
      const restricted = confirm(
        'Restrict this form to signed-in users only?\n\n' +
          'OK — only people signed in to this app can view or fill it\n' +
          'Cancel — anyone with the link (default)',
      )
      const rec = await publish(id)
      s = rec.shareSlug
      if (restricted) {
        await api.post(`/schemas/${id}/ops`, {
          submissionCap: rec.submissionCap,
          brand: rec.brand ?? '',
          retentionDays: rec.retentionDays ?? 0,
          publicAccess: 'authenticated',
        })
        await refresh()
      }
    }
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
        {canAuthor ? (
          <Link to="/designer" className={buttonVariants()}>
            <FilePlus2 className="size-4" /> New form
          </Link>
        ) : null}
      </div>

      {list.length > 0 || filter.q || filter.folder || filter.tag ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={filter.q ?? ''}
            onChange={(e) => setFilter({ ...filter, q: e.target.value || undefined })}
            placeholder="Search forms…"
            className="h-8 w-48"
          />
          {allFolders.map((f) => (
            <button
              key={f}
              className={`rounded px-2 py-1 text-xs ${filter.folder === f ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
              onClick={() =>
                setFilter({ ...filter, folder: filter.folder === f ? undefined : f })
              }
            >
              {f}
            </button>
          ))}
          {allTags.map((t) => (
            <button
              key={t}
              className={`rounded px-2 py-1 text-xs ${filter.tag === t ? 'bg-primary text-primary-foreground' : 'bg-accent'}`}
              onClick={() => setFilter({ ...filter, tag: filter.tag === t ? undefined : t })}
            >
              #{t}
            </button>
          ))}
        </div>
      ) : null}

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
      ) : list.length === 0 && (filter.q || filter.folder || filter.tag) ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Nothing matches.{' '}
          <button className="underline" onClick={() => setFilter({})}>
            Clear filters
          </button>
        </Card>
      ) : list.length === 0 ? (
        <div className="space-y-4">
          <Card className="p-6 text-sm text-muted-foreground">
            No saved forms yet. Drop an <span className="font-medium">XML · YAML · JSON · TOML ·
            INI · .env · CSV</span> file (or a JSON Schema) in the{' '}
            <Link to="/designer" className="text-primary underline">
              designer
            </Link>
            , or start from a sample:
          </Card>
          <div className="grid gap-2 sm:grid-cols-2">
            {SAMPLES.map((sample) => (
              <Link
                key={sample.id}
                to={`/designer?sample=${sample.id}`}
                className="rounded-lg border border-border p-3 transition-colors hover:border-primary/50 hover:bg-accent"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{sample.name}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                    {sample.kind}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{sample.blurb}</p>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          {list.map((s) => (
            <Card key={s.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{s.name}</span>
                  {s.status === 'published' ? (
                    <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
                      published
                    </span>
                  ) : (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                      draft
                    </span>
                  )}
                  {s.status === 'published' && s.publicAccess === 'authenticated' ? (
                    <span
                      className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent-foreground"
                      title="Only signed-in users can view or fill this link"
                    >
                      signed-in only
                    </span>
                  ) : null}
                  {s.forkedFrom ? (
                    <span className="text-[10px] text-muted-foreground">fork</span>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  <span className="uppercase">{s.kind}</span> · v{s.currentVersion} · edited{' '}
                  {new Date(s.updatedAt).toLocaleDateString()}
                  {s.folder ? ` · ${s.folder}` : ''}
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
                onClick={() => void share(s.id, s.visibility === 'shared', s.shareSlug)}
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
              {canAuthor ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Duplicate"
                  title="Duplicate / fork"
                  onClick={() => void fork(s.id)}
                >
                  <Copy className="size-4" />
                </Button>
              ) : null}
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
