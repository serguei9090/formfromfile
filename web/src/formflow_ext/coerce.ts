/**
 * `smartScalar` — the fix for review finding #8 (`"1.0"` → `1`, `"007"` → `7`).
 *
 * A `number`-typed field carries text from the form. Convert it to a real
 * number ONLY when doing so round-trips to the exact same text; otherwise keep
 * the string, so version fields (`"1.0"`), zero-padded values (`"007"`) and
 * oversized ids survive export. `"42"` still becomes `42`.
 */
export function smartScalar(raw: unknown): number | string | boolean {
  if (typeof raw === 'number' || typeof raw === 'boolean') return raw
  const text = raw == null ? '' : String(raw)
  if (text.trim() === '') return ''
  if (!/^-?\d+(\.\d+)?$/.test(text)) return text
  const n = Number(text)
  return Number.isFinite(n) && String(n) === text ? n : text
}
