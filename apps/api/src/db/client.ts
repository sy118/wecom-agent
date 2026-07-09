import { createClient } from '@libsql/client'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { getEnvDefaultSessionTtlMin } from '../config/session-ttl.js'

const DB_PATH = process.env.DB_PATH ?? './data/wecom-platform.db'

// Ensure data directory exists
mkdirSync(dirname(DB_PATH), { recursive: true })

export const db = createClient({ url: `file:${DB_PATH}` })

export async function initDb(): Promise<void> {
  await db.executeMultiple(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

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

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
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
      url TEXT,
      transport_type TEXT NOT NULL DEFAULT 'sse',
      enabled INTEGER NOT NULL DEFAULT 1,
      param_schema TEXT,
      command TEXT,
      args_json TEXT,
      env_json TEXT,
      headers_json TEXT
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
      timestamp INTEGER NOT NULL,
      response_run_id TEXT
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

    CREATE TABLE IF NOT EXISTS wecom_events (
      id TEXT PRIMARY KEY,
      msgid TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      bot_id TEXT,
      aibotid TEXT,
      chat_key TEXT,
      chatid TEXT,
      chattype TEXT,
      from_userid TEXT,
      from_corpid TEXT,
      response_url TEXT,
      raw_payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      create_time INTEGER,
      created_at INTEGER NOT NULL,
      processed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS bot_response_runs (
      id TEXT PRIMARY KEY,
      feedback_id TEXT UNIQUE,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      context_id TEXT,
      session_id TEXT,
      chat_key TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      user_id TEXT,
      question_preview TEXT,
      answer_preview TEXT,
      provider TEXT NOT NULL,
      model TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      dify_conversation_id TEXT,
      feedback_available INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS annotation_answers (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      namespace TEXT,
      context_id TEXT,
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_ref TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      hit_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wecom_users (
      id TEXT PRIMARY KEY,
      bot_id TEXT REFERENCES bots(id) ON DELETE CASCADE,
      wecom_user_id TEXT NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(bot_id, wecom_user_id)
    );

    CREATE TABLE IF NOT EXISTS context_access_grants (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      context_id TEXT NOT NULL REFERENCES contexts(id) ON DELETE CASCADE,
      wecom_user_id TEXT NOT NULL,
      access_level TEXT NOT NULL DEFAULT 'use',
      granted_by TEXT,
      expires_at INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(bot_id, context_id, wecom_user_id)
    );

    CREATE TABLE IF NOT EXISTS active_contexts (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      chat_key TEXT NOT NULL,
      wecom_user_id TEXT,
      scope TEXT NOT NULL DEFAULT 'user_in_chat',
      context_id TEXT NOT NULL REFERENCES contexts(id) ON DELETE CASCADE,
      activated_by TEXT NOT NULL,
      expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS command_permissions (
      id TEXT PRIMARY KEY,
      bot_id TEXT REFERENCES bots(id) ON DELETE CASCADE,
      command_key TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      enabled INTEGER NOT NULL DEFAULT 1,
      require_confirm INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS command_confirmations (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      chat_key TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      wecom_user_id TEXT NOT NULL,
      command_key TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      bot_id TEXT REFERENCES bots(id) ON DELETE CASCADE,
      actor_user_id TEXT,
      chat_key TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      result TEXT NOT NULL,
      reason TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_configs (
      id TEXT PRIMARY KEY,
      bot_id TEXT REFERENCES bots(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      model_name TEXT NOT NULL,
      capability TEXT NOT NULL,
      base_url TEXT,
      api_key TEXT,
      default_params TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      timeout_ms INTEGER,
      quota_per_user_daily INTEGER,
      max_concurrent INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generation_tasks (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      task_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      owner_user_id TEXT NOT NULL,
      chat_key TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      context_id TEXT,
      model_id TEXT,
      input_payload TEXT NOT NULL DEFAULT '{}',
      output_file_ids TEXT NOT NULL DEFAULT '[]',
      preview_summary TEXT,
      error TEXT,
      cost REAL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS generated_files (
      id TEXT PRIMARY KEY,
      task_id TEXT REFERENCES generation_tasks(id) ON DELETE SET NULL,
      bot_id TEXT REFERENCES bots(id) ON DELETE CASCADE,
      owner_user_id TEXT,
      chat_key TEXT,
      file_type TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER,
      access_token TEXT NOT NULL UNIQUE,
      expires_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_wecom_events_event_type_created
      ON wecom_events(event_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wecom_events_bot_created
      ON wecom_events(bot_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bot_response_runs_feedback_id
      ON bot_response_runs(feedback_id);
    CREATE INDEX IF NOT EXISTS idx_bot_response_runs_chat_created
      ON bot_response_runs(bot_id, chat_key, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_annotation_answers_scope
      ON annotation_answers(namespace, context_id, enabled);
    CREATE INDEX IF NOT EXISTS idx_wecom_users_identity
      ON wecom_users(bot_id, wecom_user_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wecom_users_identity_unique
      ON wecom_users(COALESCE(bot_id, ''), wecom_user_id);
    CREATE INDEX IF NOT EXISTS idx_context_access_user
      ON context_access_grants(bot_id, wecom_user_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_active_context_user_scope
      ON active_contexts(bot_id, chat_key, scope, COALESCE(wecom_user_id, ''));
    CREATE UNIQUE INDEX IF NOT EXISTS idx_command_permissions_unique
      ON command_permissions(COALESCE(bot_id, ''), command_key, role);
    CREATE INDEX IF NOT EXISTS idx_command_confirmations_token
      ON command_confirmations(token, expires_at, consumed_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created
      ON audit_logs(action, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_model_configs_capability
      ON model_configs(bot_id, capability, enabled);
    CREATE INDEX IF NOT EXISTS idx_generation_tasks_owner
      ON generation_tasks(bot_id, owner_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_generated_files_token
      ON generated_files(access_token, expires_at);

    UPDATE bots SET status = 'stopped' WHERE status = 'running';
  `)

  await addColumnIfMissing('mcp_servers', 'param_schema', 'TEXT')
  await addColumnIfMissing('mcp_servers', 'command', 'TEXT')
  await addColumnIfMissing('mcp_servers', 'args_json', 'TEXT')
  await addColumnIfMissing('mcp_servers', 'env_json', 'TEXT')
  await addColumnIfMissing('mcp_servers', 'headers_json', 'TEXT')
  await addColumnIfMissing('skills', 'type', "TEXT NOT NULL DEFAULT 'bundle'")
  await addColumnIfMissing('skills', 'manifest_json', "TEXT NOT NULL DEFAULT '{}'")
  await addColumnIfMissing('skills', 'param_schema', 'TEXT')
  await addColumnIfMissing('skills', 'bundle_path', 'TEXT')
  await addColumnIfMissing('skills', 'bundle_hash', 'TEXT')
  await addColumnIfMissing('skills', 'metadata_json', "TEXT NOT NULL DEFAULT '{}'")
  await addColumnIfMissing('skills', 'resource_index_json', "TEXT NOT NULL DEFAULT '{}'")
  await addColumnIfMissing('skills', 'permission_policy', "TEXT NOT NULL DEFAULT '{}'")
  await addColumnIfMissing('session_messages', 'response_run_id', 'TEXT')
  await addColumnIfMissing('generation_tasks', 'preview_summary', 'TEXT')
  await seedDefaultSessionTtlSetting()
  await migrateAllowedProjects()
  await migrateScheduledTasksBotIdNullable()
  await migrateMcpServersSchema()
  await migrateSkillsBotIdNullable()
  await removeWikiMcpServers()
}

async function seedDefaultSessionTtlSetting(): Promise<void> {
  const existing = await db.execute({
    sql: 'SELECT key FROM app_settings WHERE key = ?',
    args: ['default_session_ttl_min'],
  })
  if (existing.rows.length > 0) return
  await db.execute({
    sql: 'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)',
    args: ['default_session_ttl_min', String(getEnvDefaultSessionTtlMin()), Date.now()],
  })
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

async function migrateMcpServersSchema(): Promise<void> {
  const info = await db.execute('PRAGMA table_info(mcp_servers)')
  const urlColumn = info.rows.find((r) => r.name === 'url')
  const botIdColumn = info.rows.find((r) => r.name === 'bot_id')
  if (urlColumn?.notnull === 0 && (!botIdColumn || botIdColumn.notnull === 0)) return

  await db.execute(`
    CREATE TABLE IF NOT EXISTS mcp_servers_new (
      id TEXT PRIMARY KEY,
      bot_id TEXT REFERENCES bots(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      url TEXT,
      transport_type TEXT NOT NULL DEFAULT 'sse',
      enabled INTEGER NOT NULL DEFAULT 1,
      param_schema TEXT,
      command TEXT,
      args_json TEXT,
      env_json TEXT,
      headers_json TEXT
    )
  `)
  const newInfo = await db.execute('PRAGMA table_info(mcp_servers_new)')
  const existingColumns = info.rows.map((r) => r.name as string)
  const newColumns = new Set(newInfo.rows.map((r) => r.name as string))
  const sharedColumns = existingColumns.filter((column) => newColumns.has(column))
  await db.execute(`INSERT INTO mcp_servers_new (${sharedColumns.join(', ')}) SELECT ${sharedColumns.join(', ')} FROM mcp_servers`)
  await db.execute('DROP TABLE mcp_servers')
  await db.execute('ALTER TABLE mcp_servers_new RENAME TO mcp_servers')
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

async function removeWikiMcpServers(): Promise<void> {
  const legacyServers = await db.execute(`
    SELECT id FROM mcp_servers
    WHERE LOWER(name) LIKE '%wiki-mcp%'
       OR LOWER(name) LIKE '%wiki mcp%'
       OR LOWER(COALESCE(url, '')) LIKE '%wiki-mcp%'
       OR LOWER(COALESCE(url, '')) LIKE '%/wiki%'
       OR COALESCE(url, '') LIKE '%:3001%'
  `)
  const ids = legacyServers.rows.map((row) => String(row.id)).filter(Boolean)
  const legacyIds = new Set([...ids, 'wiki-mcp'])

  for (const id of ids) {
    await db.execute({ sql: 'DELETE FROM mcp_servers WHERE id = ?', args: [id] })
  }

  const contexts = await db.execute("SELECT id, mcp_configs FROM contexts WHERE mcp_configs IS NOT NULL AND mcp_configs != '[]'")
  for (const row of contexts.rows) {
    try {
      const configs = JSON.parse(String(row.mcp_configs ?? '[]')) as Array<{ mcpServerId?: string }>
      if (!Array.isArray(configs)) continue
      const filtered = configs.filter((cfg) => !cfg.mcpServerId || !legacyIds.has(cfg.mcpServerId))
      if (filtered.length === configs.length) continue
      await db.execute({
        sql: 'UPDATE contexts SET mcp_configs = ?, updated_at = ? WHERE id = ?',
        args: [JSON.stringify(filtered), Date.now(), String(row.id)],
      })
    } catch {
      // Leave malformed legacy JSON untouched so startup is not blocked.
    }
  }
}
