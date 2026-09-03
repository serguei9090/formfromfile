import { create } from 'zustand'
import { api } from '@/api/client'
import type { SchemaKind, SchemaRecord, SchemaSummary, TemplateVersion } from '@/api/types'

export interface SchemaListFilter {
  folder?: string
  tag?: string
  q?: string
}

interface SchemasState {
  list: SchemaSummary[]
  loading: boolean
  error: string | null
  filter: SchemaListFilter
  setFilter: (f: SchemaListFilter) => void
  refresh: () => Promise<void>
  get: (id: string) => Promise<SchemaRecord>
  create: (input: NewSchema) => Promise<SchemaRecord>
  update: (id: string, input: NewSchema) => Promise<SchemaRecord>
  remove: (id: string) => Promise<void>
  publish: (id: string) => Promise<SchemaRecord>
  unpublish: (id: string) => Promise<SchemaRecord>
  fork: (id: string) => Promise<SchemaRecord>
  setApproval: (id: string, on: boolean) => Promise<SchemaRecord>
  versions: (id: string) => Promise<TemplateVersion[]>
  rollback: (id: string, n: number) => Promise<SchemaRecord>
}

export interface NewSchema {
  name: string
  kind: SchemaKind
  body: string
  formJson: string
  folder?: string
  tags?: string[]
  notes?: string
}

function qs(f: SchemaListFilter): string {
  const p = new URLSearchParams()
  if (f.folder) p.set('folder', f.folder)
  if (f.tag) p.set('tag', f.tag)
  if (f.q) p.set('q', f.q)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const useSchemasStore = create<SchemasState>((set, get) => ({
  list: [],
  loading: false,
  error: null,
  filter: {},

  setFilter: (f) => {
    set({ filter: f })
    void get().refresh()
  },

  refresh: async () => {
    set({ loading: true, error: null })
    try {
      const { schemas } = await api.get<{ schemas: SchemaSummary[] }>(`/schemas${qs(get().filter)}`)
      set({ list: schemas ?? [], loading: false })
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : 'Could not load your forms' })
    }
  },

  get: async (id) => {
    const { schema } = await api.get<{ schema: SchemaRecord }>(`/schemas/${id}`)
    return schema
  },

  create: async (input) => {
    const { schema } = await api.post<{ schema: SchemaRecord }>('/schemas', input)
    await get().refresh()
    return schema
  },

  update: async (id, input) => {
    const { schema } = await api.put<{ schema: SchemaRecord }>(`/schemas/${id}`, input)
    await get().refresh()
    return schema
  },

  remove: async (id) => {
    await api.del(`/schemas/${id}`)
    set({ list: get().list.filter((s) => s.id !== id) })
  },

  publish: async (id) => {
    const { schema } = await api.post<{ schema: SchemaRecord }>(`/schemas/${id}/publish`)
    await get().refresh()
    return schema
  },

  unpublish: async (id) => {
    const { schema } = await api.post<{ schema: SchemaRecord }>(`/schemas/${id}/unpublish`)
    await get().refresh()
    return schema
  },

  fork: async (id) => {
    const { schema } = await api.post<{ schema: SchemaRecord }>(`/schemas/${id}/fork`)
    await get().refresh()
    return schema
  },

  setApproval: async (id, on) => {
    const { schema } = await api.post<{ schema: SchemaRecord }>(`/schemas/${id}/approval`, {
      requiresApproval: on,
    })
    await get().refresh()
    return schema
  },

  versions: async (id) => {
    const { versions } = await api.get<{ versions: TemplateVersion[] }>(`/schemas/${id}/versions`)
    return versions ?? []
  },

  rollback: async (id, n) => {
    const { schema } = await api.post<{ schema: SchemaRecord }>(`/schemas/${id}/rollback/${n}`)
    await get().refresh()
    return schema
  },
}))
