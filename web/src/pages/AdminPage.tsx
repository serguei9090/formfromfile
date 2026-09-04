import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, Download, Trash2 } from 'lucide-react'
import { api } from '@/api/client'
import type { AuditEntry, DataOpEntry, Role, User } from '@/api/types'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/authStore'
import { AdminSettings } from './AdminSettings'

const ROLES: Role[] = ['admin', 'author', 'user']
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function AdminPage() {
  const me = useAuthStore((s) => s.user)
  const [users, setUsers] = useState<User[] | null>(null)
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [dataOps, setDataOps] = useState<DataOpEntry[]>([])
  const [error, setError] = useState('')

  const load = () =>
    api
      .get<{ users: User[] }>('/admin/users')
      .then((r) => setUsers(r.users ?? []))
      .catch((e) => setError(msg(e)))

  useEffect(() => {
    void load()
    api
      .get<{ entries: AuditEntry[] }>('/admin/audit?limit=100')
      .then((r) => setAudit(r.entries ?? []))
      .catch(() => {})
    api
      .get<{ entries: DataOpEntry[] }>('/admin/data-ops?limit=100')
      .then((r) => setDataOps(r.entries ?? []))
      .catch(() => {})
  }, [])

  if (me?.role !== 'admin') return <p className="text-sm text-muted-foreground">Admins only.</p>

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn()
      await load()
    } catch (e) {
      setError(msg(e))
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-muted-foreground hover:text-foreground" aria-label="Back">
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {users == null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-2">
          {users.map((u) => (
            <Card key={u.id} className="flex items-center gap-3 p-3 text-sm">
              <span className={`min-w-0 flex-1 truncate ${u.disabled ? 'line-through opacity-60' : ''}`}>
                {u.email}
              </span>
              <Select
                value={u.role}
                onChange={(e) =>
                  void act(() =>
                    api.post(`/admin/users/${u.id}/role`, { role: e.target.value as Role }),
                  )
                }
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void act(() =>
                    api.post(`/admin/users/${u.id}/disable`, { disabled: !u.disabled }),
                  )
                }
              >
                {u.disabled ? 'Enable' : 'Disable'}
              </Button>
              <a
                href={`/api/admin/users/${u.id}/export`}
                className="text-muted-foreground hover:text-foreground"
                title="Export this user's data (GDPR)"
                aria-label="Export user data"
              >
                <Download className="size-4" />
              </a>
              {u.id !== me?.id ? (
                <button
                  className="text-muted-foreground hover:text-destructive"
                  title="Erase this user and all their data"
                  aria-label="Erase user"
                  onClick={() => {
                    if (
                      prompt(
                        `Type ERASE to permanently delete ${u.email}, their templates and all submissions to them.`,
                      ) === 'ERASE'
                    )
                      void act(() => api.post(`/admin/users/${u.id}/erase`, { confirm: 'ERASE' }))
                  }}
                >
                  <Trash2 className="size-4" />
                </button>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      <section className="space-y-3 border-t border-border/60 pt-5">
        <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
        <AdminSettings />
      </section>

      {dataOps.length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Data operations — retention purges, exports, erasures ({dataOps.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {dataOps.map((d) => (
              <li key={d.id} className="flex gap-2">
                <span className="text-muted-foreground">
                  {new Date(d.createdAt).toLocaleString()}
                </span>
                <span className="font-medium">{d.actor || 'system'}</span>
                <span className="font-mono">{d.action}</span>
                <span className="truncate text-muted-foreground">
                  {d.subject} {d.detail}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {audit.length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Audit log ({audit.length})</summary>
          <ul className="mt-2 space-y-1">
            {audit.map((a) => (
              <li key={a.id} className="flex gap-2">
                <span className="text-muted-foreground">
                  {new Date(a.createdAt).toLocaleString()}
                </span>
                <span className="font-medium">{a.actorEmail || 'system'}</span>
                <span className="font-mono">{a.action}</span>
                <span className="truncate text-muted-foreground">
                  {a.target} {a.detail}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
