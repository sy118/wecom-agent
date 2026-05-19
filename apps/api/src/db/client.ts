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
      mcp_configs TEXT NOT NULL DEFAULT '[]',
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
      bot_id TEXT REFERENCES bots(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      transport_type TEXT NOT NULL DEFAULT 'sse',
      enabled INTEGER NOT NULL DEFAULT 1,
      param_schema TEXT
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      bot_id TEXT REFERENCES bots(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'bundle',
      enabled INTEGER NOT NULL DEFAULT 1,
      manifest_json TEXT NOT NULL DEFAULT '{}',
      param_schema TEXT,
      bundle_path TEXT,
      bundle_hash TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      resource_index_json TEXT NOT NULL DEFAULT '{}',
      permission_policy TEXT NOT NULL DEFAULT '{}',
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
      bot_id TEXT REFERENCES bots(id) ON DELETE CASCADE,
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

    CREATE TABLE IF NOT EXISTS wiki_namespaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      path TEXT NOT NULL,
      description TEXT,
      git_enabled INTEGER NOT NULL DEFAULT 1,
      auto_compile INTEGER NOT NULL DEFAULT 0,
      compile_schedule TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wiki_knowledge_drafts (
      id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      target_path TEXT NOT NULL,
      content TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_ref TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      review_reason TEXT,
      reviewed_by TEXT,
      reviewed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    UPDATE bots SET status = 'stopped' WHERE status = 'running';
  `)

  await addColumnIfMissing('mcp_servers', 'param_schema', 'TEXT')
  await addColumnIfMissing('skills', 'type', "TEXT NOT NULL DEFAULT 'bundle'")
  await addColumnIfMissing('skills', 'manifest_json', "TEXT NOT NULL DEFAULT '{}'")
  await addColumnIfMissing('skills', 'param_schema', 'TEXT')
  await addColumnIfMissing('skills', 'bundle_path', 'TEXT')
  await addColumnIfMissing('skills', 'bundle_hash', 'TEXT')
  await addColumnIfMissing('skills', 'metadata_json', "TEXT NOT NULL DEFAULT '{}'")
  await addColumnIfMissing('skills', 'resource_index_json', "TEXT NOT NULL DEFAULT '{}'")
  await addColumnIfMissing('skills', 'permission_policy', "TEXT NOT NULL DEFAULT '{}'")
  await migrateAllowedProjects()
  await migrateScheduledTasksBotIdNullable()
  await migrateMcpServersBotIdNullable()
  await migrateSkillsBotIdNullable()
  await seedBuiltinMcpServers()
}

async function addColumnIfMissing(table: string, column: string, definition: string): Promise<void> {
  const info = await db.execute(`PRAGMA table_info(${table})`)
  const exists = info.rows.some((r) => r.name === column)
  if (!exists) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

async function migrateAllowedProjects(): Promise<void> {
  const info = await db.execute('PRAGMA table_info(contexts)')
  const columns = new Set(info.rows.map((r) => r.name))
  if (!columns.has('allowed_projects')) return

  if (columns.has('mcp_configs')) {
    const contexts = await db.execute(
      `SELECT id, bot_id, allowed_projects, mcp_configs FROM contexts
       WHERE allowed_projects IS NOT NULL AND allowed_projects != '[]' AND allowed_projects != ''
         AND (mcp_configs IS NULL OR mcp_configs = '[]')`
    )
    for (const row of contexts.rows) {
      const botId = row.bot_id as string
      const allowedProjects = JSON.parse((row.allowed_projects as string) || '[]') as string[]
      if (allowedProjects.length === 0) continue
      const mcpResult = await db.execute({
        sql: `SELECT id FROM mcp_servers WHERE bot_id = ? AND (name LIKE '%gitnexus%' OR name LIKE '%git%') LIMIT 1`,
        args: [botId],
      })
      const mcpServerId = mcpResult.rows[0]?.id as string | undefined
      if (!mcpServerId) continue
      await db.execute({
        sql: 'UPDATE contexts SET mcp_configs = ? WHERE id = ?',
        args: [JSON.stringify([{ mcpServerId, enabled: true, params: { allowedProjects } }]), row.id as string],
      })
    }
  }

  const existingColumns = info.rows.map((r) => r.name as string).filter((c) => c !== 'allowed_projects')
  await db.execute(`
    CREATE TABLE IF NOT EXISTS contexts_new (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      mcp_configs TEXT NOT NULL DEFAULT '[]',
      skill_configs TEXT NOT NULL DEFAULT '[]',
      session_ttl_min INTEGER NOT NULL DEFAULT 30,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  const newInfo = await db.execute('PRAGMA table_info(contexts_new)')
  const newColumns = new Set(newInfo.rows.map((r) => r.name as string))
  const shared = existingColumns.filter((c) => newColumns.has(c))
  await db.execute(`INSERT INTO contexts_new (${shared.join(', ')}) SELECT ${shared.join(', ')} FROM contexts`)
  await db.execute('DROP TABLE contexts')
  await db.execute('ALTER TABLE contexts_new RENAME TO contexts')
}

async function migrateTableBotIdNullable(table: string, createSql: string): Promise<void> {
  const info = await db.execute(`PRAGMA table_info(${table})`)
  const botIdCol = info.rows.find((r) => r.name === 'bot_id')
  if (!botIdCol || botIdCol.notnull === 0) return
  await db.execute(createSql)
  const newInfo = await db.execute(`PRAGMA table_info(${table}_new)`)
  const existingColumns = info.rows.map((r) => r.name as string)
  const newColumns = new Set(newInfo.rows.map((r) => r.name as string))
  const sharedColumns = existingColumns.filter((column) => newColumns.has(column))
  await db.execute(`INSERT INTO ${table}_new (${sharedColumns.join(', ')}) SELECT ${sharedColumns.join(', ')} FROM ${table}`)
  await db.execute(`DROP TABLE ${table}`)
  await db.execute(`ALTER TABLE ${table}_new RENAME TO ${table}`)
}

async function migrateScheduledTasksBotIdNullable(): Promise<void> {
  await migrateTableBotIdNullable('scheduled_tasks', `
    CREATE TABLE IF NOT EXISTS scheduled_tasks_new (
      id TEXT PRIMARY KEY,
      bot_id TEXT REFERENCES bots(id) ON DELETE CASCADE,
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
    )
  `)
}

async function migrateMcpServersBotIdNullable(): Promise<void> {
  await migrateTableBotIdNullable('mcp_servers', `
    CREATE TABLE IF NOT EXISTS mcp_servers_new (
      id TEXT PRIMARY KEY,
      bot_id TEXT REFERENCES bots(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      transport_type TEXT NOT NULL DEFAULT 'sse',
      enabled INTEGER NOT NULL DEFAULT 1,
      param_schema TEXT
    )
  `)
}

async function migrateSkillsBotIdNullable(): Promise<void> {
  await migrateTableBotIdNullable('skills', `
    CREATE TABLE IF NOT EXISTS skills_new (
      id TEXT PRIMARY KEY,
      bot_id TEXT REFERENCES bots(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'bundle',
      enabled INTEGER NOT NULL DEFAULT 1,
      manifest_json TEXT NOT NULL DEFAULT '{}',
      param_schema TEXT,
      bundle_path TEXT,
      bundle_hash TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      resource_index_json TEXT NOT NULL DEFAULT '{}',
      permission_policy TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
}

async function seedBuiltinMcpServers(): Promise<void> {
  const wikiMcpUrl = wikiMcpSseUrl()
  const existing = await db.execute({
    sql: `SELECT id FROM mcp_servers WHERE name = 'wiki-mcp (内置)'`,
    args: [],
  })
  if (existing.rows.length > 0) return
  const { randomUUID } = await import('crypto')
  await db.execute({
    sql: `INSERT INTO mcp_servers (id, bot_id, name, url, transport_type, enabled) VALUES (?, NULL, ?, ?, 'sse', 0)`,
    args: [randomUUID(), 'wiki-mcp (内置)', wikiMcpUrl],
  })
}

function wikiMcpSseUrl(): string {
  const configured = process.env.WIKI_MCP_URL?.trim()
  const baseUrl = configured || `http://localhost:${process.env.WIKI_MCP_PORT ?? 3001}`
  const normalized = baseUrl.replace(/\/+$/, '')
  return normalized.endsWith('/sse') ? normalized : `${normalized}/sse`
}
