import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { SchemaField } from '@/core/form_flow/schemaModel'
import type { FieldMeta } from '@/formflow_ext/fieldMeta'
import { PRESETS } from '@/formflow_ext/presets'

const num = (s: string): number | undefined => {
  if (s.trim() === '') return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

/** Per-field authoring panel: label, help, validation. Leaf fields only get the
 * validation rows; object/array fields get label + help. */
export function FieldSettings({
  field,
  meta,
  onChange,
  autoFocus,
}: {
  field: SchemaField
  meta: FieldMeta
  onChange: (patch: Partial<FieldMeta>) => void
  autoFocus?: boolean
}) {
  const [advanced, setAdvanced] = useState(!!meta.pattern)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoFocus) rootRef.current?.querySelector<HTMLElement>('input, select, textarea')?.focus()
  }, [autoFocus])
  const leaf = field.type === 'text' || field.type === 'number' || field.type === 'boolean'
  const scalarInput = field.type === 'text' || field.type === 'number'
  const presetOptions = PRESETS.filter((p) =>
    p.types.includes(field.type === 'number' ? 'number' : 'text'),
  )

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={`Settings for ${field.key}`}
      className="mt-1 space-y-2 rounded-md border border-border/60 bg-muted/40 p-2 text-sm"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`lbl-${field.key}`}>Label</Label>
          <Input
            id={`lbl-${field.key}`}
            value={meta.label ?? ''}
            placeholder={field.key}
            onChange={(e) => onChange({ label: e.target.value })}
          />
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={meta.editable !== false}
            onChange={(e) => onChange({ editable: e.target.checked ? undefined : false })}
          />
          Filler can edit
        </label>
      </div>

      <div className="space-y-1">
        <Label htmlFor={`help-${field.key}`}>Help text</Label>
        <Textarea
          id={`help-${field.key}`}
          rows={2}
          value={meta.help ?? ''}
          onChange={(e) => onChange({ help: e.target.value })}
        />
      </div>

      {leaf ? (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={!!meta.required}
            onChange={(e) => onChange({ required: e.target.checked || undefined })}
          />
          Required
        </label>
      ) : null}

      {scalarInput ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`preset-${field.key}`}>Validation</Label>
              <Select
                id={`preset-${field.key}`}
                value={meta.preset ?? ''}
                onChange={(e) => onChange({ preset: e.target.value || undefined })}
              >
                <option value="">— none —</option>
                {presetOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            {field.type === 'number' ? (
              <div className="flex gap-2">
                <div className="space-y-1">
                  <Label htmlFor={`min-${field.key}`}>Min</Label>
                  <Input
                    id={`min-${field.key}`}
                    type="number"
                    value={meta.min ?? ''}
                    onChange={(e) => onChange({ min: num(e.target.value) })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`max-${field.key}`}>Max</Label>
                  <Input
                    id={`max-${field.key}`}
                    type="number"
                    value={meta.max ?? ''}
                    onChange={(e) => onChange({ max: num(e.target.value) })}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-1">
            <Label htmlFor={`enum-${field.key}`}>Allowed values (comma-separated → dropdown)</Label>
            <Input
              id={`enum-${field.key}`}
              value={(meta.enumValues ?? []).join(', ')}
              placeholder="e.g. Passive, Active"
              onChange={(e) => {
                const list = e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
                onChange({ enumValues: list.length ? list : undefined })
              }}
            />
          </div>

          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => setAdvanced((a) => !a)}
          >
            {advanced ? 'Hide' : 'Advanced'} — raw regex
          </button>
          {advanced ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={`pat-${field.key}`}>Pattern</Label>
                <Input
                  id={`pat-${field.key}`}
                  value={meta.pattern ?? ''}
                  placeholder="^[A-Z]{3}-\\d+$"
                  onChange={(e) => onChange({ pattern: e.target.value || undefined })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`patmsg-${field.key}`}>Message on mismatch</Label>
                <Input
                  id={`patmsg-${field.key}`}
                  value={meta.patternMessage ?? ''}
                  onChange={(e) => onChange({ patternMessage: e.target.value || undefined })}
                />
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
