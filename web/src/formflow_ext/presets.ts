/**
 * Named validators — the friendly surface over raw regex. An author picks
 * "IPv4" from a list; the filler (F10) just sees "must be a valid IPv4
 * address" if they get it wrong. Raw `pattern` stays available as the
 * escape hatch in `FieldMeta`.
 *
 * `EDITOR_ATTR_TO_PRESET` maps the `editor="…"` attribute seen on real
 * templates (the ILS tool files use `editor="Toolname"` /
 * `editor="IPv4-or-Hostname"`) to a preset id, so detection can pre-fill
 * validation with zero authoring.
 */

export interface Preset {
  id: string
  label: string
  /** Applies to these field types (used to hide irrelevant presets in the UI). */
  types: ReadonlyArray<'text' | 'number'>
  test: (value: string) => boolean
  message: string
  example?: string
}

const OCTET = '(25[0-5]|2[0-4]\\d|1?\\d?\\d)'
const IPV4 = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`)
const HOSTNAME = /^(?=.{1,253}$)([a-zA-Z0-9](-?[a-zA-Z0-9])*)(\.[a-zA-Z0-9](-?[a-zA-Z0-9])*)*$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
const TOOLNAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export const PRESETS: readonly Preset[] = [
  {
    id: 'nonempty',
    label: 'Required text',
    types: ['text'],
    test: (v) => v.trim().length > 0,
    message: 'This field is required',
  },
  {
    id: 'ipv4',
    label: 'IPv4 address',
    types: ['text'],
    test: (v) => IPV4.test(v),
    message: 'Must be a valid IPv4 address',
    example: '10.0.0.5',
  },
  {
    id: 'hostname',
    label: 'Hostname',
    types: ['text'],
    test: (v) => HOSTNAME.test(v),
    message: 'Must be a valid hostname',
    example: 'tool-01.plant.local',
  },
  {
    id: 'ipv4-or-hostname',
    label: 'IPv4 or hostname',
    types: ['text'],
    test: (v) => IPV4.test(v) || HOSTNAME.test(v),
    message: 'Must be an IPv4 address or a hostname',
    example: '10.0.0.5 or tool-01.local',
  },
  {
    id: 'port',
    label: 'Port (1–65535)',
    types: ['text', 'number'],
    test: (v) => /^\d+$/.test(v) && +v >= 1 && +v <= 65535,
    message: 'Must be a port number between 1 and 65535',
    example: '9000',
  },
  {
    id: 'email',
    label: 'Email address',
    types: ['text'],
    test: (v) => EMAIL.test(v),
    message: 'Must be a valid email address',
  },
  {
    id: 'toolname',
    label: 'Tool name',
    types: ['text'],
    test: (v) => TOOLNAME.test(v),
    message: 'Letters, digits, dot, dash and underscore only; must start alphanumeric',
    example: 'PRESS-04',
  },
  {
    id: 'slug',
    label: 'Slug (kebab-case)',
    types: ['text'],
    test: (v) => SLUG.test(v),
    message: 'Lowercase letters, digits and single dashes only',
    example: 'north-line-2',
  },
  {
    id: 'integer',
    label: 'Whole number',
    types: ['text', 'number'],
    test: (v) => /^-?\d+$/.test(v),
    message: 'Must be a whole number',
  },
  {
    id: 'decimal',
    label: 'Decimal number',
    types: ['text', 'number'],
    test: (v) => /^-?\d+(\.\d+)?$/.test(v),
    message: 'Must be a number',
  },
]

const BY_ID = new Map(PRESETS.map((p) => [p.id, p]))

export function presetById(id: string | undefined): Preset | undefined {
  return id ? BY_ID.get(id) : undefined
}

/** `editor="…"` attribute value (case-insensitive) → preset id. */
export const EDITOR_ATTR_TO_PRESET: Record<string, string> = {
  toolname: 'toolname',
  'ipv4-or-hostname': 'ipv4-or-hostname',
  ipv4: 'ipv4',
  ip: 'ipv4',
  hostname: 'hostname',
  host: 'hostname',
  port: 'port',
  email: 'email',
  slug: 'slug',
  integer: 'integer',
  int: 'integer',
  number: 'decimal',
  decimal: 'decimal',
}

export function presetForEditorAttr(value: string | undefined): string | undefined {
  if (!value) return undefined
  return EDITOR_ATTR_TO_PRESET[value.trim().toLowerCase()]
}
