import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, Check, Copy, Download, Trash2, UserPlus } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import type { AuditEntry, DataOpEntry, Role, User } from '@/api/types'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/authStore'
import { AdminSettings } from './AdminSettings'

const ROLES: Role[] = ['admin', 'author', 'user']
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

function AddUserForm({ onCreated }: { onCreated: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('user')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ email: string; password: string } | null>(null)
  const [copied, setCopied] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const res = await api.post<{ user: User; generatedPassword?: string }>('/admin/users', {
        email,
        password: password || undefined,
        role,
      })
      if (res.generatedPassword) {
        setResult({ email: res.user.email, password: res.generatedPassword })
      }
      setEmail('')
      setPassword('')
      setRole('user')
      onCreated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : msg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <UserPlus className="size-4" /> Add user
      </h3>
      <p className="text-xs text-muted-foreground">
        For deployments with public sign-up turned off — an admin creates the account directly.
        Leave the password blank to generate one (shown once, below).
      </p>
      <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="new-user-email">Email</Label>
          <Input
            id="new-user-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-9 w-56"
            placeholder="person@example.com"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-user-password">Password</Label>
          <Input
            id="new-user-password"
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-9 w-40"
            placeholder="generate for me"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-user-role">Role</Label>
          <Select
            id="new-user-role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="h-9"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" disabled={busy || !email}>
          {busy ? 'Creating…' : 'Add user'}
        </Button>
      </form>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {result ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/[0.05] p-3 text-sm"
        >
          <span>
            Created <span className="font-medium">{result.email}</span> — password:{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{result.password}</code>
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(result.password)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />} Copy
          </Button>
          <span className="text-xs text-muted-foreground">
            Won't be shown again — hand it to them now.
          </span>
          <button className="ml-auto text-xs underline" onClick={() => setResult(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
    </Card>
  )
}

type Tab = 'users' | 'settings' | 'activity'
const TABS: { id: Tab; label: string }[] = [
  { id: 'users', label: 'Users' },
  { id: 'settings', label: 'Settings' },
  { id: 'activity', label: 'Activity' },
]

export function AdminPage() {
  const me = useAuthStore((s) => s.user)
  const [tab, setTab] = useState<Tab>('users')
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
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <div className="flex-1" />
        <div className="inline-flex overflow-hidden rounded-md border border-border text-xs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`px-3 py-1.5 ${tab === t.id ? 'bg-primary text-primary-foreground' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {tab === 'users' ? (
        <>
          <AddUserForm onCreated={load} />
          {users == null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid gap-2">
              {users.map((u) => (
                <Card key={u.id} className="flex items-center gap-3 p-3 text-sm">
                  <span
                    className={`min-w-0 flex-1 truncate ${u.disabled ? 'line-through opacity-60' : ''}`}
                  >
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
        </>
      ) : null}

      {tab === 'settings' ? <AdminSettings /> : null}

      {tab === 'activity' ? (
        <div className="space-y-4">
          {dataOps.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data operations recorded yet.</p>
          ) : (
            <details open className="text-xs">
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
          )}

          {audit.length === 0 ? (
            <p className="text-sm text-muted-foreground">No audit entries recorded yet.</p>
          ) : (
            <details open className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                Audit log ({audit.length})
              </summary>
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
          )}
        </div>
      ) : null}
    </div>
  )
}
