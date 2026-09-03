import { useFieldArray, type Control, type RegisterOptions, type UseFormRegisterReturn } from 'react-hook-form'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
  defaultValuesFromFields,
  fieldDisplayLabel,
  isScalarArrayTemplate,
  type SchemaField,
} from '@/core/form_flow/schemaModel'
import { childPath, metaAt, type FieldMeta, type FieldMetaMap } from '@/formflow_ext/fieldMeta'
import { evalComputed, evalCond } from '@/formflow_ext/rules'
import { isStructuralKey } from '@/formflow_ext/xml/richXml'

type Values = Record<string, unknown>

/** A dynamic-path-friendly register + the form control. */
export interface FieldCtx {
  control: Control<Values>
  reg: (name: string, opts?: RegisterOptions) => UseFormRegisterReturn
  /** Authoring metadata, keyed by dotted field path. */
  meta?: FieldMetaMap
  /** Current form values — for conditional visibility + computed fields. */
  values?: Values
  /** rhf-style flat error lookup by field name (F10). */
  errorFor?: (name: string) => string | undefined
  /** On blur of a field that has `meta.checkUrl` — run the async check. */
  onBlurCheck?: (name: string, metaPath: string, value: string) => void
  /** Hide fields the author marked non-editable (filler view). */
  hideLocked?: boolean
}

export function FormFields({
  fields,
  prefix,
  metaPrefix = '',
  ctx,
}: {
  fields: SchemaField[]
  prefix: string
  metaPrefix?: string
  ctx: FieldCtx
}) {
  return (
    <div className="space-y-3">
      {fields
        .filter((f) => !isStructuralKey(f.key))
        .map((f) => {
          const mPath = childPath(metaPrefix, f.key)
          const m = metaAt(ctx.meta ?? {}, mPath)
          if (ctx.hideLocked && m.editable === false && f.children.length === 0) return null
          if (m.visibleWhen && !evalCond(m.visibleWhen, ctx.values ?? {})) return null
          return (
            <FieldRow
              key={f.key}
              field={f}
              name={prefix ? `${prefix}.${f.key}` : f.key}
              metaPath={mPath}
              m={m}
              ctx={ctx}
            />
          )
        })}
    </div>
  )
}

function labelText(field: SchemaField, m: FieldMeta): string {
  return m.label?.trim() || fieldDisplayLabel(field)
}

function Help({ text }: { text?: string }) {
  if (!text) return null
  return (
    <span className="ml-1 cursor-help text-muted-foreground" title={text} aria-label={text}>
      ⓘ
    </span>
  )
}

function FieldRow({
  field,
  name,
  metaPath,
  m,
  ctx,
}: {
  field: SchemaField
  name: string
  metaPath: string
  m: FieldMeta
  ctx: FieldCtx
}) {
  if (field.type === 'object') {
    return (
      <fieldset className="rounded-md border border-border/60 p-3">
        <legend className="px-1 text-xs font-semibold text-muted-foreground">
          {labelText(field, m)}
          <Help text={m.help} />
        </legend>
        <FormFields fields={field.children} prefix={name} metaPrefix={metaPath} ctx={ctx} />
      </fieldset>
    )
  }
  if (field.type === 'array') {
    return <ArrayField field={field} name={name} metaPath={metaPath} m={m} ctx={ctx} />
  }

  const err = ctx.errorFor?.(name)
  const locked = m.editable === false

  if (field.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          disabled={locked}
          {...ctx.reg(name)}
          className="size-4 accent-primary"
        />
        {labelText(field, m)}
        <Help text={m.help} />
      </label>
    )
  }

  if (m.computed) {
    return (
      <div className="space-y-1">
        <Label>
          {labelText(field, m)} <span className="text-muted-foreground">(computed)</span>
          <Help text={m.help} />
        </Label>
        <Input value={evalComputed(m.computed, ctx.values ?? {})} readOnly disabled />
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <Label htmlFor={name}>
        {labelText(field, m)}
        {(m.required || m.requiredWhen) ? <span className="text-destructive"> *</span> : null}
        <Help text={m.help} />
      </Label>
      {m.enumValues && m.enumValues.length > 0 ? (
        <Select id={name} disabled={locked} className="h-9 w-full" {...ctx.reg(name)}>
          <option value="">— select —</option>
          {m.enumValues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          id={name}
          disabled={locked}
          aria-invalid={err ? true : undefined}
          // number fields stay strings in the form — the renderers' smartScalar
          // converts on export only when the text round-trips exactly, so
          // "1.0" / "007" survive (review finding #8).
          inputMode={field.type === 'number' ? 'decimal' : undefined}
          type="text"
          {...ctx.reg(name)}
          onBlur={(e) => {
            ctx.reg(name).onBlur(e)
            if (m.checkUrl) ctx.onBlurCheck?.(name, metaPath, e.target.value)
          }}
        />
      )}
      {err ? (
        <p role="alert" className="text-xs text-destructive">
          {err}
        </p>
      ) : null}
    </div>
  )
}

function ArrayField({
  field,
  name,
  metaPath,
  m,
  ctx,
}: {
  field: SchemaField
  name: string
  metaPath: string
  m: FieldMeta
  ctx: FieldCtx
}) {
  const { fields, append, remove } = useFieldArray({ control: ctx.control, name: name as never })
  const scalar = isScalarArrayTemplate(field.children)

  return (
    <div className="space-y-2 rounded-md border border-primary/30 bg-primary/[0.03] p-3">
      <div className="text-xs font-semibold text-primary">
        {labelText(field, m)} — list
        <Help text={m.help} />
      </div>
      {fields.map((item, i) => (
        <div key={item.id} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {scalar ? (
              <Input {...ctx.reg(`${name}.${i}.value`)} />
            ) : (
              <FormFields
                fields={field.children}
                prefix={`${name}.${i}`}
                metaPrefix={metaPath}
                ctx={ctx}
              />
            )}
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Remove item" onClick={() => remove(i)}>
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          append((scalar ? { value: '' } : defaultValuesFromFields(field.children)) as never)
        }
      >
        <Plus className="size-4" /> Add item
      </Button>
    </div>
  )
}
