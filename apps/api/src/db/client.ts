import { createClient } from '@libsql/client'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

const DB_PATH = process.env.DB_PATH ?? './data/wecom-platform.db'

// Ensure data directory exists
mkdirSync(dirname(DB_PATH), { recursive: true })

export const db = createClient({ url: `file:${DB_PATH}` })

export async function initDb(): Promise<void> {
  await db.executeMultiple(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      wecom_bot_id TEXT NOT NULL,
      wecom_bot_secret TEXT NOT NULL,
      wecom_ws_url TEXT NOT NULL,
      llm_api_key TEXT NOT NULL,
      llm_base_url TEXT NOT NULL,
      llm_model TEXT NOT NULL DEFAULT 'MiniMax-M2.5',
      provider TEXT NOT NULL DEFAULT 'openai-compatible',
      streaming_mode TEXT NOT NULL DEFAULT 'none',
      dify_base_url TEXT,
      dify_api_key TEXT,
      dify_app_id TEXT,
      vision_enabled INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'stopped',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contexts (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      allowed_projects TEXT NOT NULL,
      skill_configs TEXT NOT NULL DEFAULT '[]',
      session_ttl_min INTEGER NOT NULL DEFAULT 30,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bindings (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      context_id TEXT NOT NULL REFERENCES contexts(id) ON DELETE CASCADE,
      chat_key TEXT NOT NULL,
      chat_name TEXT,
      chat_type TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(bot_id, chat_key)
    );

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      transport_type TEXT NOT NULL DEFAULT 'sse',
      enabled INTEGER NOT NULL DEFAULT 1,
      param_schema TEXT
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      manifest_json TEXT NOT NULL,
      param_schema TEXT,
      permission_policy TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skill_audit_logs (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      context_id TEXT,
      chat_key TEXT,
      status TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      input_preview TEXT,
      output_preview TEXT,
      error TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      chat_key TEXT NOT NULL,
      context_id TEXT NOT NULL,
      dify_conversation_id TEXT,
      last_active_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      cron_expr TEXT NOT NULL,
      prompt_template TEXT NOT NULL,
      target_chat_key TEXT NOT NULL,
      target_chat_id TEXT NOT NULL,
      target_chat_name TEXT,
      context_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at INTEGER,
      next_run_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    UPDATE bots SET status = 'stopped' WHERE status = 'running';
  `)

  // Migrate columns that may not exist in older DB versions
  await addColumnIfMissing('bots', 'provider', "TEXT NOT NULL DEFAULT 'openai-compatible'")
  await addColumnIfMissing('bots', 'streaming_mode', "TEXT NOT NULL DEFAULT 'none'")
  await addColumnIfMissing('bots', 'dify_base_url', 'TEXT')
  await addColumnIfMissing('bots', 'dify_api_key', 'TEXT')
  await addColumnIfMissing('bots', 'dify_app_id', 'TEXT')
  await addColumnIfMissing('bots', 'vision_enabled', 'INTEGER NOT NULL DEFAULT 0')
  await addColumnIfMissing('contexts', 'mcp_configs', "TEXT NOT NULL DEFAULT '[]'")
  await addColumnIfMissing('contexts', 'skill_configs', "TEXT NOT NULL DEFAULT '[]'")
  await addColumnIfMissing('mcp_servers', 'param_schema', 'TEXT')

  // Migrate allowed_projects → mcp_configs for existing contexts
  await migrateAllowedProjects()
}

async function addColumnIfMissing(table: string, column: string, definition: string): Promise<void> {
  const info = await db.execute(`PRAGMA table_info(${table})`)
  const exists = info.rows.some((r) => r.name === column)
  if (!exists) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

async function migrateAllowedProjects(): Promise<void> {
  // Find contexts that still have allowed_projects data but empty mcp_configs
  const contexts = await db.execute(
    `SELECT c.id, c.bot_id, c.allowed_projects, c.mcp_configs
     FROM contexts c
     WHERE c.allowed_projects IS NOT NULL AND c.allowed_projects != '[]' AND c.allowed_projects != ''
       AND (c.mcp_configs IS NULL OR c.mcp_configs = '[]')`
  )
  if (contexts.rows.length === 0) return

  for (const row of contexts.rows) {
    const botId = row.bot_id as string
    const allowedProjects = JSON.parse((row.allowed_projects as string) || '[]') as string[]
    if (allowedProjects.length === 0) continue

    // Find the gitnexus MCP server for this bot
    const mcpResult = await db.execute({
      sql: `SELECT id FROM mcp_servers WHERE bot_id = ? AND (name LIKE '%gitnexus%' OR name LIKE '%git%') LIMIT 1`,
      args: [botId],
    })

    const mcpServerId = mcpResult.rows[0]?.id as string | undefined
    if (!mcpServerId) continue

    const mcpConfigs = JSON.stringify([{
      mcpServerId,
      enabled: true,
      params: { allowedProjects },
    }])

    await db.execute({
      sql: 'UPDATE contexts SET mcp_configs = ? WHERE id = ?',
      args: [mcpConfigs, row.id as string],
    })
  }
}
