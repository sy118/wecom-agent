export const FALLBACK_DEFAULT_SESSION_TTL_MIN = 30
export const MIN_SESSION_TTL_MIN = 1
export const MAX_SESSION_TTL_MIN = 1440

export function parseSessionTtlMin(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed)) return null
  if (parsed < MIN_SESSION_TTL_MIN || parsed > MAX_SESSION_TTL_MIN) return null
  return parsed
}

export function getEnvDefaultSessionTtlMin(): number {
  return parseSessionTtlMin(process.env.DEFAULT_SESSION_TTL_MIN) ?? FALLBACK_DEFAULT_SESSION_TTL_MIN
}
