export type Role = 'admin' | 'user'

export interface User {
  id: string
  email: string
  role: Role
  disabled: boolean
  createdAt: number
}

export type SchemaKind = 'xml' | 'yaml' | 'json'

export type Visibility = 'private' | 'shared'

export interface SchemaSummary {
  id: string
  name: string
  kind: SchemaKind
  visibility: Visibility
  shareSlug?: string
  publishedAt?: number
  createdAt: number
  updatedAt: number
}

export interface SchemaRecord extends SchemaSummary {
  body: string
  formJson: string
}

/** The trimmed template a filler gets from `/api/public/templates/{slug}`. */
export interface PublicTemplate {
  name: string
  kind: SchemaKind
  body: string
  formJson: string
}

export interface SubmissionSummary {
  id: string
  templateId: string
  filledBy?: string
  submitter: string
  createdAt: number
}

export interface SubmissionRecord extends SubmissionSummary {
  valuesJson: string
  output: string
}
