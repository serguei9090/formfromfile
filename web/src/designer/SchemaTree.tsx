import { Select } from '@/components/ui/select'
import { FIELD_TYPE_LABELS, type FieldType, type SchemaField } from '@/core/form_flow/schemaModel'

const TYPES: FieldType[] = ['text', 'number', 'boolean', 'object', 'array']

export function SchemaTree({
  fields,
  onRetype,
  path = [],
}: {
  fields: SchemaField[]
  onRetype: (path: number[], type: FieldType) => void
  path?: number[]
}) {
  return (
    <ul className={path.length ? 'ml-4 space-y-1 border-l border-border/50 pl-3' : 'space-y-1'}>
      {fields.map((f, i) => {
        const here = [...path, i]
        return (
          <li key={f.key} className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs">{f.key}</span>
              <Select value={f.type} onChange={(e) => onRetype(here, e.target.value as FieldType)}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {FIELD_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </div>
            {(f.type === 'object' || f.type === 'array') && f.children.length > 0 ? (
              <SchemaTree fields={f.children} onRetype={onRetype} path={here} />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
