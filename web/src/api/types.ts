export type Role = 'admin' | 'user'

export interface User {
  id: string
  email: string
  role: Role
  disabled: boolean
  createdAt: number
}

export type SchemaKind = 'xml' | 'yaml' | 'json'

export interface SchemaSummary {
  id: string
  name: string
  kind: SchemaKind
  createdAt: number
  updatedAt: number
}

export interface SchemaRecord extends SchemaSummary {
  body: string
  formJson: string
}
