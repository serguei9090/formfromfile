import { useEffect } from 'react'
import { Link } from 'react-router'
import { FilePlus2, Trash2 } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useSchemasStore } from '@/stores/schemasStore'

export function HomePage() {
  const list = useSchemasStore((s) => s.list)
  const loading = useSchemasStore((s) => s.loading)
  const refresh = useSchemasStore((s) => s.refresh)
  const remove = useSchemasStore((s) => s.remove)

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
              <Link to={`/designer/${s.id}`} className="min-w-0 flex-1">
                <div className="truncate font-medium">{s.name}</div>
                <div className="text-xs text-muted-foreground">
                  <span className="uppercase">{s.kind}</span> · edited{' '}
                  {new Date(s.updatedAt).toLocaleString()}
                </div>
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
