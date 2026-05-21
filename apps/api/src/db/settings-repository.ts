import { db } from './client.js'
import { getEnvDefaultSessionTtlMin, parseSessionTtlMin } from '../config/session-ttl.js'

const DEFAULT_SESSION_TTL_KEY = 'default_session_ttl_min'

export const SettingsRepository = {
  async getDefaultSessionTtlMin(): Promise<number> {
    const result = await db.execute({
      sql: 'SELECT value FROM app_settings WHERE key = ?',
      args: [DEFAULT_SESSION_TTL_KEY],
    })
    const stored = result.rows[0]?.value
    return parseSessionTtlMin(stored) ?? getEnvDefaultSessionTtlMin()
  },

  async updateDefaultSessionTtlMin(value: unknown): Promise<number | null> {
    if (typeof value !== 'number') return null
    const parsed = parseSessionTtlMin(value)
    if (parsed === null) return null
    await db.execute({
      sql: `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      args: [DEFAULT_SESSION_TTL_KEY, String(parsed), Date.now()],
    })
    return parsed
  },
}
