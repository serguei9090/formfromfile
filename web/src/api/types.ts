export type Role = 'admin' | 'user'

export interface User {
  id: string
  email: string
  role: Role
  disabled: boolean
  createdAt: number
}

export type SchemaKind = 'xml' | 'yaml' | 'json' | 'toml' | 'ini' | 'csv' | 'dotenv'

export type Visibility = 'private' | 'shared'
export type TemplateStatus = 'draft' | 'published'

export interface SchemaSummary {
  id: string
  name: string
  kind: SchemaKind
  visibility: Visibility
  shareSlug?: string
  publishedAt?: number
  currentVersion: number
  status: TemplateStatus
  folder: string
  tags: string[]
  forkedFrom?: string
  requiresApproval: boolean
  createdAt: number
  updatedAt: number
}

export interface SchemaRecord extends SchemaSummary {
  body: string
  formJson: string
}

export interface TemplateVersion {
  id: string
  version: number
  body?: string
  formJson?: string
  notes: string
  createdBy?: string
  createdAt: number
}

/** The trimmed template a filler gets from `/api/public/templates/{slug}`. */
export interface PublicTemplate {
  name: string
  kind: SchemaKind
  body: string
  formJson: string
}

export type SubmissionStatus = 'pending' | 'approved' | 'rejected'

export interface SubmissionSummary {
  id: string
  templateId: string
  templateVersion?: number
  filledBy?: string
  submitter: string
  status: SubmissionStatus
  createdAt: number
}

export interface SubmissionRecord extends SubmissionSummary {
  valuesJson: string
  output: string
  reviewNote?: string
}
