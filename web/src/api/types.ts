export type Role = 'admin' | 'author' | 'user'

export interface User {
  id: string
  email: string
  role: Role
  disabled: boolean
  createdAt: number
}

/** Firebase Web SDK config, echoed by GET /config when Firebase sign-in is
 *  enabled server-side (FFF_FIREBASE_PROJECT_ID set). Not secret. */
export interface FirebaseWebConfig {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
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
  submissionCap: number
  brand?: string
  viewCount: number
  retentionDays: number
  /** "anyone" (default) or "authenticated" — meaningful only once published. */
  publicAccess: 'anyone' | 'authenticated'
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
  brand?: string
}

export interface AuditEntry {
  id: string
  actorEmail: string
  action: string
  target: string
  detail?: string
  createdAt: number
}

export interface DataOpEntry {
  id: string
  actor: string
  action: string
  subject: string
  detail?: string
  createdAt: number
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

export interface Comment {
  id: string
  authorId?: string
  authorName: string
  body: string
  createdAt: number
}

export interface Webhook {
  id: string
  url: string
  secret?: string
  events: string[]
  createdAt: number
}

export interface WebhookDelivery {
  id: string
  event: string
  statusCode: number
  error?: string
  attempts: number
  createdAt: number
}
