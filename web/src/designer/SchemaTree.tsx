import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Settings2 } from 'lucide-react'
import { Select } from '@/components/ui/select'
import { FIELD_TYPE_LABELS, type FieldType, type SchemaField } from '@/core/form_flow/schemaModel'
import { childPath, metaAt, walkPaths, type FieldMeta, type FieldMetaMap } from '@/formflow_ext/fieldMeta'
import { isStructuralKey } from '@/formflow_ext/xml/richXml'
import { FieldSettings } from './FieldSettings'

const TYPES: FieldType[] = ['text', 'number', 'boolean', 'object', 'array']

function matches(field: SchemaField, meta: FieldMeta, q: string): boolean {
  if (!q) return true
  const hay = `${field.key} ${meta.label ?? ''}`.toLowerCase()
  return hay.includes(q.toLowerCase())
}

/** true if `field` or anything under it matches the filter. */
function subtreeMatches(field: SchemaField, keyPrefix: string, meta: FieldMetaMap, q: string): boolean {
  if (matches(field, metaAt(meta, keyPrefix), q)) return true
  return field.children.some((c) =>
    subtreeMatches(c, childPath(keyPrefix, c.key), meta, q),
  )
}

function configuredCount(fields: SchemaField[], prefix: string, meta: FieldMetaMap): number {
  return walkPaths(fields, prefix).filter((p) => {
    const m = meta[p]
    return (
      m &&
      (!!m.label || !!m.help || !!m.required || !!m.preset || m.editable === false || !!m.pattern)
    )
  }).length
}

export function SchemaTree({
  fields,
  onRetype,
  meta,
  onMeta,
  filter = '',
  path = [],
  keyPrefix = '',
}: {
  fields: SchemaField[]
  onRetype: (path: number[], type: FieldType) => void
  meta: FieldMetaMap
  onMeta: (keyPath: string, patch: Partial<FieldMeta>) => void
  filter?: string
  path?: number[]
  keyPrefix?: string
}) {
  return (
    <ul className={path.length ? 'ml-4 space-y-1 border-l border-border/50 pl-3' : 'space-y-1'}>
      {fields.map((f, i) => {
        if (isStructuralKey(f.key)) return null
        const kp = childPath(keyPrefix, f.key)
        if (filter && !subtreeMatches(f, kp, meta, filter)) return null
        const here = [...path, i]
        const container = (f.type === 'object' || f.type === 'array') && f.children.length > 0
        return (
          <li key={f.key} className="space-y-1">
            <Row
              field={f}
              keyPath={kp}
              meta={metaAt(meta, kp)}
              container={container}
              childCount={container ? f.children.filter((c) => !isStructuralKey(c.key)).length : 0}
              configured={container ? configuredCount(f.children, kp, meta) : 0}
              forceOpen={!!filter}
              onRetype={(t) => onRetype(here, t)}
              onMeta={onMeta}
              renderChildren={() => (
                <SchemaTree
                  fields={f.children}
                  onRetype={onRetype}
                  meta={meta}
                  onMeta={onMeta}
                  filter={filter}
                  path={here}
                  keyPrefix={kp}
                />
              )}
            />
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
  container,
  childCount,
  configured,
  forceOpen,
  onRetype,
  onMeta,
  renderChildren,
}: {
  field: SchemaField
  keyPath: string
  meta: FieldMeta
  container: boolean
  childCount: number
  configured: number
  forceOpen: boolean
  onRetype: (type: FieldType) => void
  onMeta: (keyPath: string, patch: Partial<FieldMeta>) => void
  renderChildren: () => ReactNode
}) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const showChildren = container && (forceOpen || !collapsed)
  const isConfigured =
    !!meta.label || !!meta.help || !!meta.required || !!meta.preset || meta.editable === false || !!meta.pattern

  return (
    <>
      <div className="flex items-center gap-2">
        {container ? (
          <button
            type="button"
            aria-label={collapsed ? `Expand ${field.key}` : `Collapse ${field.key}`}
            aria-expanded={showChildren}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted"
            onClick={() => setCollapsed((c) => !c)}
          >
            {showChildren ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <span className="font-mono text-xs">{field.key}</span>
        <Select value={field.type} onChange={(e) => onRetype(e.target.value as FieldType)}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {FIELD_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
        {container ? (
          <span className="text-[10px] text-muted-foreground">
            {childCount} field{childCount === 1 ? '' : 's'}
            {configured > 0 ? ` · ${configured} set` : ''}
          </span>
        ) : null}
        <button
          type="button"
          aria-label={`Field settings for ${field.key}`}
          aria-expanded={settingsOpen}
          className={`ml-auto rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isConfigured ? 'text-primary' : 'text-muted-foreground'}`}
          onClick={() => setSettingsOpen((o) => !o)}
        >
          <Settings2 className="size-3.5" />
        </button>
      </div>
      {settingsOpen ? (
        <FieldSettings
          field={field}
          meta={meta}
          onChange={(patch) => onMeta(keyPath, patch)}
          autoFocus
        />
      ) : null}
      {showChildren ? renderChildren() : null}
    </>
  )
}
