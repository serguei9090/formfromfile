import { useFieldArray, type Control, type RegisterOptions, type UseFormRegisterReturn } from 'react-hook-form'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  defaultValuesFromFields,
  fieldDisplayLabel,
  isScalarArrayTemplate,
  type SchemaField,
} from '@/core/form_flow/schemaModel'

type Values = Record<string, unknown>

/** A dynamic-path-friendly register + the form control. */
export interface FieldCtx {
  control: Control<Values>
  reg: (name: string, opts?: RegisterOptions) => UseFormRegisterReturn
}

export function FormFields({ fields, prefix, ctx }: { fields: SchemaField[]; prefix: string; ctx: FieldCtx }) {
  return (
    <div className="space-y-3">
      {fields.map((f) => (
        <FieldRow key={f.key} field={f} name={prefix ? `${prefix}.${f.key}` : f.key} ctx={ctx} />
      ))}
    </div>
  )
}

function FieldRow({ field, name, ctx }: { field: SchemaField; name: string; ctx: FieldCtx }) {
  if (field.type === 'object') {
    return (
      <fieldset className="rounded-md border border-border/60 p-3">
        <legend className="px-1 text-xs font-semibold text-muted-foreground">{fieldDisplayLabel(field)}</legend>
        <FormFields fields={field.children} prefix={name} ctx={ctx} />
      </fieldset>
    )
  }
  if (field.type === 'array') {
    return <ArrayField field={field} name={name} ctx={ctx} />
  }
  if (field.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" {...ctx.reg(name)} className="size-4 accent-primary" />
        {fieldDisplayLabel(field)}
      </label>
    )
  }
  return (
    <div className="space-y-1">
      <Label htmlFor={name}>{fieldDisplayLabel(field)}</Label>
      <Input
        id={name}
        type={field.type === 'number' ? 'number' : 'text'}
        {...ctx.reg(name, field.type === 'number' ? { valueAsNumber: true } : undefined)}
      />
    </div>
  )
}

function ArrayField({ field, name, ctx }: { field: SchemaField; name: string; ctx: FieldCtx }) {
  const { fields, append, remove } = useFieldArray({ control: ctx.control, name: name as never })
  const scalar = isScalarArrayTemplate(field.children)

  return (
    <div className="space-y-2 rounded-md border border-primary/30 bg-primary/[0.03] p-3">
      <div className="text-xs font-semibold text-primary">{fieldDisplayLabel(field)} — list</div>
      {fields.map((item, i) => (
        <div key={item.id} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {scalar ? (
              <Input {...ctx.reg(`${name}.${i}.value`)} />
            ) : (
              <FormFields fields={field.children} prefix={`${name}.${i}`} ctx={ctx} />
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
          append(
            (scalar ? { value: '' } : defaultValuesFromFields(field.children)) as never,
          )
        }
      >
        <Plus className="size-4" /> Add item
      </Button>
    </div>
  )
}
