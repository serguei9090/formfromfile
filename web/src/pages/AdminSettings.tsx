import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/stores/authStore'

type SettingsView = {
  settings: Record<string, string | boolean>
  effective: Record<string, string | number | boolean>
  sources: Record<string, 'override' | 'base'>
  aiHasKey: boolean
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

function SourceBadge({ source }: { source?: 'override' | 'base' }) {
  const overridden = source === 'override'
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
        overridden ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
      }`}
      title={overridden ? 'A settings row overrides the startup value' : 'Using the startup value (env var or default)'}
    >
      {overridden ? 'overridden' : 'default'}
    </span>
  )
}

function Toggle({
  label,
  help,
  checked,
  source,
  disabled,
  busy,
  onSet,
  onReset,
}: {
  label: string
  help?: string
  checked: boolean
  source?: 'override' | 'base'
  disabled?: boolean
  busy?: boolean
  onSet: (on: boolean) => void
  onReset: () => void
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      <input
        type="checkbox"
        aria-label={label}
        className="mt-1 size-4 accent-primary"
        checked={checked}
        disabled={disabled || busy}
        onChange={(e) => onSet(e.target.checked)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          {label} <SourceBadge source={source} />
          {source === 'override' ? (
            <button className="text-xs text-muted-foreground underline" onClick={onReset}>
              reset
            </button>
          ) : null}
        </div>
        {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
      </div>
    </div>
  )
}

export function AdminSettings() {
  const refreshConfig = useAuthStore((s) => s.refresh)
  const [view, setView] = useState<SettingsView | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = () =>
    api
      .get<SettingsView>('/admin/settings')
      .then(setView)
      .catch((e) => setError(msg(e)))

  useEffect(() => {
    void load()
  }, [])

  async function put(key: string, value: string | null) {
    setBusy(key)
    setError('')
    try {
      await api.put('/admin/settings', { [key]: value })
      await load()
      // /config drives allowRegister + the Turnstile site key in the SPA
      void refreshConfig()
    } catch (e) {
      setError(msg(e))
    } finally {
      setBusy('')
    }
  }

  if (error && !view) return <p className="text-sm text-destructive">{error}</p>
  if (!view) return <p className="text-sm text-muted-foreground">Loading…</p>

  const eff = view.effective
  const src = view.sources
  const bool = (k: string) => ({
    checked: Boolean(eff[k]),
    source: src[k],
    busy: busy === k,
    onSet: (on: boolean) => void put(k, on ? 'true' : 'false'),
    onReset: () => void put(k, null),
  })

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <p className="text-xs text-muted-foreground">
        Changes take effect immediately — no restart. An <span className="font-medium">overridden</span>{' '}
        row wins over the startup env var / default; <span className="font-medium">reset</span> drops
        it.
      </p>

      <Card className="p-4">
        <h3 className="mb-1 text-sm font-semibold">Access</h3>
        <Toggle
          {...bool('allow_register')}
          label="Allow public self-registration"
          help="Off = only an admin creates accounts (the first account can always bootstrap)."
        />
      </Card>

      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">Anti-abuse — Cloudflare Turnstile</h3>
        <p className="text-xs text-muted-foreground">
          Both keys set → a CAPTCHA on public forms. Free from the Turnstile dashboard. Leave blank
          to disable.
        </p>
        <div className="space-y-1">
          <Label htmlFor="ts-site">
            Site key <SourceBadge source={src.turnstile_site_key} />
          </Label>
          <div className="flex gap-2">
            <Input
              id="ts-site"
              defaultValue={String(eff.turnstile_site_key ?? '')}
              placeholder="0x4AAAAAAA…"
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v !== String(eff.turnstile_site_key ?? '')) void put('turnstile_site_key', v || null)
              }}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ts-secret">
            Secret key{' '}
            <span className="text-xs font-normal text-muted-foreground">
              {eff.turnstile_secret ? '· currently set' : '· not set'}
            </span>
          </Label>
          <Input
            id="ts-secret"
            type="password"
            placeholder={eff.turnstile_secret ? '•••••••• (unchanged)' : 'paste to set'}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v) void put('turnstile_secret', v)
            }}
          />
          {eff.turnstile_secret ? (
            <button
              className="text-xs text-muted-foreground underline"
              onClick={() => void put('turnstile_secret', null)}
            >
              clear secret
            </button>
          ) : null}
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="mb-1 text-sm font-semibold">Webhooks</h3>
        <Toggle
          {...bool('webhook_allow_private')}
          label="Allow webhook targets on private / loopback addresses"
          help="Default blocks LAN / 127.0.0.1 / link-local / metadata IPs (SSRF). Turn on only for trusted internal endpoints."
        />
      </Card>

      <Card className="p-4">
        <h3 className="mb-1 text-sm font-semibold">AI assist (beta)</h3>
        <Toggle
          {...bool('ai_beta')}
          label="Enable AI assist"
          disabled={!view.aiHasKey}
          help={
            view.aiHasKey
              ? 'Suggest labels, explain diffs, generate/fill from a prompt. Calls the Anthropic API (costs money).'
              : 'No API key configured — set FFF_ANTHROPIC_API_KEY on the server first.'
          }
        />
      </Card>

      <Card className="space-y-2 p-4">
        <h3 className="text-sm font-semibold">Limits</h3>
        <div className="space-y-1">
          <Label htmlFor="cap">
            Default submission cap per form <SourceBadge source={src.submission_cap_default} />
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="cap"
              type="text"
              inputMode="numeric"
              className="w-28"
              defaultValue={String(eff.submission_cap_default ?? 0)}
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v !== String(eff.submission_cap_default ?? 0)) void put('submission_cap_default', v || '0')
              }}
            />
            <span className="text-xs text-muted-foreground">
              0 = unlimited. A per-form cap still overrides this.
            </span>
          </div>
        </div>
      </Card>
    </div>
  )
}
