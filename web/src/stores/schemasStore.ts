import { create } from 'zustand'
import { api } from '@/api/client'
import type { SchemaKind, SchemaRecord, SchemaSummary } from '@/api/types'

interface SchemasState {
  list: SchemaSummary[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  get: (id: string) => Promise<SchemaRecord>
  create: (input: NewSchema) => Promise<SchemaRecord>
  update: (id: string, input: NewSchema) => Promise<SchemaRecord>
  remove: (id: string) => Promise<void>
  publish: (id: string) => Promise<SchemaRecord>
  unpublish: (id: string) => Promise<SchemaRecord>
}

export interface NewSchema {
  name: string
  kind: SchemaKind
  body: string
  formJson: string
}

export const useSchemasStore = create<SchemasState>((set, get) => ({
  list: [],
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true, error: null })
    try {
      const { schemas } = await api.get<{ schemas: SchemaSummary[] }>('/schemas')
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
}))
