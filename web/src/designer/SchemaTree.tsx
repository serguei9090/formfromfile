import { useState } from 'react'
import { Settings2 } from 'lucide-react'
import { Select } from '@/components/ui/select'
import { FIELD_TYPE_LABELS, type FieldType, type SchemaField } from '@/core/form_flow/schemaModel'
import { childPath, metaAt, type FieldMeta, type FieldMetaMap } from '@/formflow_ext/fieldMeta'
import { isStructuralKey } from '@/formflow_ext/xml/richXml'
import { FieldSettings } from './FieldSettings'

const TYPES: FieldType[] = ['text', 'number', 'boolean', 'object', 'array']

export function SchemaTree({
  fields,
  onRetype,
  meta,
  onMeta,
  path = [],
  keyPrefix = '',
}: {
  fields: SchemaField[]
  onRetype: (path: number[], type: FieldType) => void
  meta: FieldMetaMap
  onMeta: (keyPath: string, patch: Partial<FieldMeta>) => void
  path?: number[]
  keyPrefix?: string
}) {
  return (
    <ul className={path.length ? 'ml-4 space-y-1 border-l border-border/50 pl-3' : 'space-y-1'}>
      {fields.map((f, i) => {
        if (isStructuralKey(f.key)) return null
        const here = [...path, i]
        const kp = childPath(keyPrefix, f.key)
        return (
          <li key={f.key} className="space-y-1">
            <Row field={f} keyPath={kp} meta={metaAt(meta, kp)} onRetype={(t) => onRetype(here, t)} onMeta={onMeta} />
            {(f.type === 'object' || f.type === 'array') && f.children.length > 0 ? (
              <SchemaTree
                fields={f.children}
                onRetype={onRetype}
                meta={meta}
                onMeta={onMeta}
                path={here}
                keyPrefix={kp}
              />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

function Row({
  field,
  keyPath,
  meta,
  onRetype,
  onMeta,
}: {
  field: SchemaField
  keyPath: string
  meta: FieldMeta
  onRetype: (type: FieldType) => void
  onMeta: (keyPath: string, patch: Partial<FieldMeta>) => void
}) {
  const [open, setOpen] = useState(false)
  const configured =
    !!meta.label || !!meta.help || !!meta.required || !!meta.preset || meta.editable === false || !!meta.pattern
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs">{field.key}</span>
        <Select value={field.type} onChange={(e) => onRetype(e.target.value as FieldType)}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {FIELD_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
        <button
          type="button"
          aria-label="Field settings"
          aria-pressed={open}
          className={`rounded p-1 hover:bg-muted ${configured ? 'text-primary' : 'text-muted-foreground'}`}
          onClick={() => setOpen((o) => !o)}
        >
          <Settings2 className="size-3.5" />
        </button>
      </div>
      {open ? (
        <FieldSettings field={field} meta={meta} onChange={(patch) => onMeta(keyPath, patch)} />
      ) : null}
    </>
  )
}
