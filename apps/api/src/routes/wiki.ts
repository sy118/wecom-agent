import { Router, type Request } from 'express'
import multer from 'multer'
import { readdir, stat, readFile, writeFile, mkdir, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { dirname, extname, join, normalize, relative } from 'path'
import { simpleGit } from 'simple-git'
import type { ContextConfig, McpConfig, McpServerConfig } from '@wecom-platform/types'
import { BotRepository } from '../db/bot-repository.js'
import { ContextRepository } from '../db/context-repository.js'
import { McpServerRepository } from '../db/mcp-server-repository.js'
import { WikiDraftRepository } from '../db/wiki-draft-repository.js'
import { WikiNamespaceRepository, type WikiNamespace } from '../db/wiki-namespace-repository.js'
import { WikiRetrievalLogRepository } from '../db/wiki-retrieval-log-repository.js'

export const wikiRouter: Router = Router()

const WIKI_ROOT = process.env.WIKI_ROOT ?? ''
const WIKI_MCP_HEALTH_URL = wikiMcpBaseUrl()
const DEFAULT_METRICS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

type HealthStatus = 'ok' | 'warning' | 'error' | 'unknown'
type RetrievalPolicy = 'manual' | 'autoSearch' | 'fixedPage'
type MergeStrategy = 'append' | 'replace' | 'createOnly'

interface FileNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  updatedAt?: number
  children?: FileNode[]
}

interface SearchResult {
  path: string
  title: string
  excerpt: string
  size: number
  updatedAt: number
}

const lastSearchTests = new Map<string, { status: HealthStatus; testedAt: number; query: string; hitCount: number }>()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 50, fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (extname(file.originalname).toLowerCase() === '.md') {
      cb(null, true)
    } else {
      cb(new Error('Only .md files are supported'))
    }
  },
})

function nsParam(req: Request): string {
  const v = req.params['namespace']
  return Array.isArray(v) ? v[0] : v
}

function wildcardParam(req: Request, key: string): string {
  const rawPath = req.params as unknown as Record<string, string | string[]>
  const value = rawPath[key] ?? ''
  return Array.isArray(value) ? value.join('/') : value
}

function wikiRootRequired(res: import('express').Response): boolean {
  if (!WIKI_ROOT) {
    res.status(503).json({ error: 'WIKI_ROOT is not configured' })
    return false
  }
  return true
}

function safeRelativePath(userPath: string, addMd = false): string | null {
  const normalized = normalize(userPath).replace(/\\/g, '/')
  if (
    !normalized ||
    normalized.includes('..') ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    return null
  }
  return addMd && extname(normalized) !== '.md' ? `${normalized}.md` : normalized
}

function namespaceDir(ns: WikiNamespace): string {
  return join(WIKI_ROOT, 'namespaces', ns.path)
}

async function findNamespaceOr404(namespace: string, res: import('express').Response): Promise<WikiNamespace | null> {
  const ns = await WikiNamespaceRepository.findByName(namespace)
  if (!ns) {
    res.status(404).json({ error: 'namespace not found' })
    return null
  }
  return ns
}

async function buildTree(dir: string, baseDir: string): Promise<FileNode[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nodes: FileNode[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    const rel = relative(baseDir, full)
    if (entry.isDirectory()) {
      nodes.push({ name: entry.name, path: rel, type: 'dir', children: await buildTree(full, baseDir) })
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
      const s = await stat(full)
      nodes.push({ name: entry.name, path: rel, type: 'file', size: s.size, updatedAt: s.mtimeMs })
    }
  }
  return nodes.sort((a, b) => Number(a.type === 'file') - Number(b.type === 'file') || a.name.localeCompare(b.name))
}

async function collectMdFiles(dir: string, baseDir = dir): Promise<Array<{ full: string; path: string; size: number; updatedAt: number }>> {
  if (!existsSync(dir)) return []
  const entries = await readdir(dir, { withFileTypes: true })
  const files: Array<{ full: string; path: string; size: number; updatedAt: number }> = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectMdFiles(full, baseDir))
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
      const s = await stat(full)
      files.push({ full, path: relative(baseDir, full), size: s.size, updatedAt: s.mtimeMs })
    }
  }
  return files
}

async function searchNamespace(ns: WikiNamespace, query: string): Promise<SearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []
  const lowerQuery = trimmed.toLowerCase()
  const dir = namespaceDir(ns)
  const files = await collectMdFiles(dir)
  const results: SearchResult[] = []

  for (const file of files) {
    const content = await readFile(file.full, 'utf-8')
    const lowerContent = content.toLowerCase()
    const lowerPath = file.path.toLowerCase()
    if (!lowerPath.includes(lowerQuery) && !lowerContent.includes(lowerQuery)) continue

    const titleMatch = content.match(/^#\s+(.+)$/m)
    const idx = lowerContent.indexOf(lowerQuery)
    const start = idx >= 0 ? Math.max(0, idx - 80) : 0
    const end = idx >= 0 ? Math.min(content.length, idx + 160) : Math.min(content.length, 220)
    results.push({
      path: file.path,
      title: titleMatch?.[1] ?? file.path.replace(/\.md$/i, ''),
      excerpt: content.slice(start, end).replace(/\s+/g, ' ').trim(),
      size: file.size,
      updatedAt: file.updatedAt,
    })
  }

  return results
}

function isWikiMcpServer(server: McpServerConfig): boolean {
  const haystack = `${server.name} ${server.url}`.toLowerCase()
  return haystack.includes('wiki-mcp') || haystack.includes('/wiki') || haystack.includes(':3001')
}

function namespacesFromConfig(cfg: McpConfig): string[] {
  const value = cfg.params?.namespace
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  return typeof value === 'string' && value ? [value] : []
}

function policyFromConfig(cfg: McpConfig): RetrievalPolicy {
  const policy = cfg.params?.retrievalPolicy
  if (policy === 'manual' || policy === 'autoSearch' || policy === 'fixedPage') return policy
  if (cfg.params?.forceCallPage) return 'fixedPage'
  return cfg.forceCall ? 'autoSearch' : 'manual'
}

function buildWikiConfig(existing: McpConfig | undefined, mcpServerId: string, namespace: string, body: Record<string, unknown>): McpConfig {
  const policy = (body.policy === 'autoSearch' || body.policy === 'fixedPage' || body.policy === 'manual')
    ? body.policy as RetrievalPolicy
    : 'manual'
  const params: Record<string, unknown> = { ...(existing?.params ?? {}), namespace, retrievalPolicy: policy }
  if (policy === 'fixedPage') {
    params.forceCallPage = String(body.forceCallPage ?? params.forceCallPage ?? '')
    params.maxChars = Number(body.maxChars ?? params.maxChars ?? 6000)
  } else {
    delete params.forceCallPage
    delete params.maxChars
  }
  if (body.crossNs !== undefined) params.crossNs = Boolean(body.crossNs)
  return { mcpServerId, enabled: true, params, forceCall: policy !== 'manual' }
}

async function bindingSummary(namespace: string) {
  const [bots, contexts, servers] = await Promise.all([
    BotRepository.findAll(),
    ContextRepository.findAll(),
    McpServerRepository.findAll(),
  ])
  const botById = new Map(bots.map((bot) => [bot.id, bot]))
  const serverById = new Map(servers.map((server) => [server.id, server]))
  const wikiServerIds = new Set(servers.filter(isWikiMcpServer).map((server) => server.id))

  return contexts.flatMap((ctx) => {
    return (ctx.mcpConfigs ?? [])
      .filter((cfg) => cfg.enabled && wikiServerIds.has(cfg.mcpServerId) && namespacesFromConfig(cfg).includes(namespace))
      .map((cfg) => ({
        botId: ctx.botId,
        botName: botById.get(ctx.botId)?.name ?? ctx.botId,
        contextId: ctx.id,
        contextName: ctx.name,
        mcpServerId: cfg.mcpServerId,
        mcpServerName: serverById.get(cfg.mcpServerId)?.name ?? cfg.mcpServerId,
        policy: policyFromConfig(cfg),
        params: cfg.params ?? {},
      }))
  })
}

function healthItem(status: HealthStatus, message: string) {
  return { status, message }
}

function parseNumberQuery(value: unknown): number | undefined {
  if (Array.isArray(value)) value = value[0]
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function queryWindow(req: Request): { since: number; until?: number } {
  const since = parseNumberQuery(req.query.since) ?? Date.now() - DEFAULT_METRICS_WINDOW_MS
  const until = parseNumberQuery(req.query.until)
  return until === undefined ? { since } : { since, until }
}

function mergeStrategy(value: unknown, fallback: string | undefined = 'append'): MergeStrategy {
  if (value === 'replace' || value === 'createOnly' || value === 'append') return value
  if (fallback === 'replace' || fallback === 'createOnly' || fallback === 'append') return fallback
  return 'append'
}

function mergedContent(existing: string, content: string, strategy: MergeStrategy): string {
  if (strategy === 'replace' || !existing) return content
  const separator = existing && !existing.endsWith('\n') ? '\n\n' : existing ? '\n' : ''
  return `${existing}${separator}${content}`
}

function textDiff(before: string, after: string): string[] {
  if (before === after) return ['  (no changes)']
  const beforeLines = before.split(/\r?\n/)
  const afterLines = after.split(/\r?\n/)
  const max = Math.max(beforeLines.length, afterLines.length)
  const lines: string[] = []
  for (let i = 0; i < max; i += 1) {
    const oldLine = beforeLines[i]
    const newLine = afterLines[i]
    if (oldLine === newLine) {
      if (oldLine !== undefined) lines.push(`  ${oldLine}`)
    } else {
      if (oldLine !== undefined) lines.push(`- ${oldLine}`)
      if (newLine !== undefined) lines.push(`+ ${newLine}`)
    }
  }
  return lines
}

function wikiMcpBaseUrl(): string {
  const configured = process.env.WIKI_MCP_URL?.trim()
  const baseUrl = configured || `http://localhost:${process.env.WIKI_MCP_PORT ?? 3001}`
  return baseUrl.replace(/\/+$/, '').replace(/\/sse$/i, '')
}

async function getGlobalHealth() {
  const rootExists = Boolean(WIKI_ROOT && existsSync(WIKI_ROOT))
  let gitRepo = healthItem('unknown' as const, 'not checked')
  let gitRemote = healthItem('unknown' as const, 'not checked')
  if (!WIKI_ROOT) {
    gitRepo = healthItem('error', 'WIKI_ROOT is not configured')
    gitRemote = healthItem('unknown', 'WIKI_ROOT is not configured')
  } else if (!rootExists) {
    gitRepo = healthItem('error', 'WIKI_ROOT directory does not exist')
    gitRemote = healthItem('unknown', 'WIKI_ROOT directory does not exist')
  } else {
    try {
      const git = simpleGit(WIKI_ROOT)
      await git.status()
      gitRepo = healthItem('ok', 'Git repository is available')
      const remotes = await git.getRemotes(true)
      gitRemote = remotes.length > 0 ? healthItem('ok', `${remotes.length} remote(s) configured`) : healthItem('warning', 'No Git remote configured')
    } catch (err) {
      gitRepo = healthItem('warning', err instanceof Error ? err.message : String(err))
      gitRemote = healthItem('unknown', 'Git repository unavailable')
    }
  }

  let wikiMcp = healthItem('unknown' as const, 'not checked')
  try {
    const response = await fetch(`${WIKI_MCP_HEALTH_URL.replace(/\/$/, '')}/health`)
    wikiMcp = response.ok ? healthItem('ok', 'wiki-mcp health endpoint is reachable') : healthItem('warning', `wiki-mcp returned ${response.status}`)
  } catch (err) {
    wikiMcp = healthItem('warning', err instanceof Error ? err.message : String(err))
  }

  const [namespaces, servers, contexts, bots] = await Promise.all([
    WikiNamespaceRepository.findAll(),
    McpServerRepository.findAll(),
    ContextRepository.findAll(),
    BotRepository.findAll(),
  ])
  const wikiServers = servers.filter(isWikiMcpServer)
  const enabledWikiServers = wikiServers.filter((server) => server.enabled)
  const wikiServerIds = new Set(enabledWikiServers.map((server) => server.id))
  const wikiContextBindings = contexts.filter((ctx) =>
    (ctx.mcpConfigs ?? []).some((cfg) => cfg.enabled && wikiServerIds.has(cfg.mcpServerId) && namespacesFromConfig(cfg).length > 0)
  )
  const boundBotIds = new Set(wikiContextBindings.map((ctx) => ctx.botId))
  const boundBots = bots.filter((bot) => boundBotIds.has(bot.id))
  const runningBoundBots = boundBots.filter((bot) => bot.status === 'running')
  const mcpServer = enabledWikiServers.length > 0
    ? healthItem('ok', `${enabledWikiServers.length} enabled wiki-mcp server(s)`)
    : wikiServers.length > 0
      ? healthItem('warning', 'wiki-mcp server exists but is disabled')
      : healthItem('error', 'wiki-mcp server is not configured')
  const namespaceStatus = namespaces.length > 0
    ? healthItem('ok', `${namespaces.length} namespace(s) configured`)
    : healthItem('warning', 'No Wiki namespace configured')
  const contextBindings = wikiContextBindings.length > 0
    ? healthItem('ok', `${wikiContextBindings.length} context binding(s) configured`)
    : healthItem('warning', 'No Context is bound to Wiki')
  const botRuntime = boundBots.length === 0
    ? healthItem('unknown', 'No Wiki-bound Bot to check')
    : runningBoundBots.length > 0
      ? healthItem('ok', `${runningBoundBots.length}/${boundBots.length} Wiki-bound Bot(s) running`)
      : healthItem('warning', 'Wiki-bound Bot(s) are not running or may need restart')

  return {
    wikiRoot: WIKI_ROOT,
    wikiMcpUrl: WIKI_MCP_HEALTH_URL,
    diagnostics: {
      namespaceCount: namespaces.length,
      wikiMcpServerCount: wikiServers.length,
      enabledWikiMcpServerCount: enabledWikiServers.length,
      wikiContextBindingCount: wikiContextBindings.length,
      wikiBoundBotCount: boundBots.length,
      runningWikiBoundBotCount: runningBoundBots.length,
    },
    items: {
      rootConfigured: healthItem(WIKI_ROOT ? 'ok' : 'error', WIKI_ROOT ? 'WIKI_ROOT configured' : 'WIKI_ROOT is missing'),
      rootExists: healthItem(rootExists ? 'ok' : 'error', rootExists ? 'Directory exists' : 'Directory missing'),
      gitRepo,
      gitRemote,
      wikiMcp,
      mcpServer,
      namespaces: namespaceStatus,
      contextBindings,
      botRuntime,
    },
  }
}

// GET /api/wiki/health
wikiRouter.get('/health', async (_req, res) => {
  res.json(await getGlobalHealth())
})

// GET /api/wiki/namespaces
wikiRouter.get('/namespaces', async (_req, res) => {
  res.json(await WikiNamespaceRepository.findAll())
})

// POST /api/wiki/namespaces
wikiRouter.post('/namespaces', async (req, res) => {
  const { name, display_name, path, description } = req.body as Record<string, string>
  if (!name || !display_name || !path) {
    res.status(400).json({ error: 'name, display_name and path are required' })
    return
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    res.status(400).json({ error: 'name must use kebab-case lowercase letters, numbers and dashes' })
    return
  }
  const safePath = safeRelativePath(path)
  if (!safePath) {
    res.status(400).json({ error: 'invalid namespace path' })
    return
  }
  const existing = await WikiNamespaceRepository.findByName(name)
  if (existing) {
    res.status(409).json({ error: 'namespace already exists' })
    return
  }
  if (WIKI_ROOT) {
    await mkdir(join(WIKI_ROOT, 'namespaces', safePath), { recursive: true })
  }
  const ns = await WikiNamespaceRepository.create({
    name,
    displayName: display_name,
    path: safePath,
    description: description ?? null,
    gitEnabled: true,
    autoCompile: false,
    compileSchedule: null,
  })
  res.status(201).json(ns)
})

// PUT /api/wiki/namespaces/:id
wikiRouter.put('/namespaces/:id', async (req, res) => {
  const { id } = req.params
  const { display_name, path, description, git_enabled, auto_compile, compile_schedule } = req.body as Record<string, unknown>
  const updated = await WikiNamespaceRepository.update(id, {
    displayName: display_name as string | undefined,
    path: path as string | undefined,
    description: description as string | undefined,
    gitEnabled: git_enabled !== undefined ? Boolean(git_enabled) : undefined,
    autoCompile: auto_compile !== undefined ? Boolean(auto_compile) : undefined,
    compileSchedule: compile_schedule as string | undefined,
  })
  if (!updated) { res.status(404).json({ error: 'namespace not found' }); return }
  res.json(updated)
})

// DELETE /api/wiki/namespaces/:id
wikiRouter.delete('/namespaces/:id', async (req, res) => {
  const ns = await WikiNamespaceRepository.findById(req.params.id)
  if (!ns) { res.status(404).json({ error: 'namespace not found' }); return }
  await WikiNamespaceRepository.delete(req.params.id)
  res.json({ message: 'namespace deleted; disk files were kept' })
})

// POST /api/wiki/git-pull
wikiRouter.post('/git-pull', async (_req, res) => {
  if (!wikiRootRequired(res)) return
  try {
    const git = simpleGit(WIKI_ROOT)
    const result = await git.pull()
    const changed = result.files.length
    res.json({ message: changed > 0 ? `Updated ${changed} file(s)` : 'Already up to date', files: result.files })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('no tracking information') || msg.includes('no remote')) {
      res.json({ message: 'No Git remote configured; skipped pull' })
      return
    }
    res.status(500).json({ error: msg })
  }
})

// GET /api/wiki/:namespace/search?q=
wikiRouter.get('/:namespace/search', async (req, res) => {
  if (!wikiRootRequired(res)) return
  const ns = await findNamespaceOr404(nsParam(req), res)
  if (!ns) return
  const query = String(req.query.q ?? req.query.query ?? '')
  const startedAt = Date.now()
  const results = await searchNamespace(ns, query)
  const durationMs = Date.now() - startedAt
  lastSearchTests.set(ns.name, {
    status: results.length > 0 ? 'ok' : 'warning',
    testedAt: Date.now(),
    query,
    hitCount: results.length,
  })
  res.json({ query, results, hitCount: results.length, durationMs })
})

// GET /api/wiki/:namespace/health
wikiRouter.get('/:namespace/health', async (req, res) => {
  if (!wikiRootRequired(res)) return
  const ns = await findNamespaceOr404(nsParam(req), res)
  if (!ns) return
  const files = await collectMdFiles(namespaceDir(ns))
  const bindings = await bindingSummary(ns.name)
  const pendingDraftCount = await WikiDraftRepository.countPendingByNamespace(ns.name)
  const recent = await WikiRetrievalLogRepository.countByNamespace(ns.name, Date.now() - DEFAULT_METRICS_WINDOW_MS)
  const latestModifiedAt = files.reduce<number | null>((latest, file) => latest === null ? file.updatedAt : Math.max(latest, file.updatedAt), null)
  res.json({
    namespace: ns.name,
    fileCount: files.length,
    latestModifiedAt,
    bindingCount: bindings.length,
    pendingDraftCount,
    recentMissCount: recent.misses,
    lastSearchTest: lastSearchTests.get(ns.name) ?? null,
  })
})

// GET /api/wiki/:namespace/retrieval-logs
wikiRouter.get('/:namespace/retrieval-logs', async (req, res) => {
  const ns = await findNamespaceOr404(nsParam(req), res)
  if (!ns) return
  const { since, until } = queryWindow(req)
  const logs = await WikiRetrievalLogRepository.findByNamespace(ns.name, {
    since,
    until,
    missesOnly: req.query.missesOnly === 'true' || req.query.missesOnly === '1',
    limit: parseNumberQuery(req.query.limit),
  })
  res.json({ namespace: ns.name, since, until: until ?? null, logs })
})

// GET /api/wiki/:namespace/misses
wikiRouter.get('/:namespace/misses', async (req, res) => {
  const ns = await findNamespaceOr404(nsParam(req), res)
  if (!ns) return
  const { since, until } = queryWindow(req)
  const misses = until === undefined
    ? await WikiRetrievalLogRepository.summarizeMisses(ns.name, since, parseNumberQuery(req.query.limit) ?? 20)
    : (await WikiRetrievalLogRepository.findByNamespace(ns.name, { since, until, missesOnly: true, limit: 500 }))
      .reduce((map, log) => {
        const item = map.get(log.query) ?? { query: log.query, count: 0, latestAt: 0, contextIds: [] as string[], chatKeys: [] as string[] }
        item.count += 1
        item.latestAt = Math.max(item.latestAt, log.createdAt)
        if (log.contextId && !item.contextIds.includes(log.contextId)) item.contextIds.push(log.contextId)
        if (log.chatKey && !item.chatKeys.includes(log.chatKey)) item.chatKeys.push(log.chatKey)
        map.set(log.query, item)
        return map
      }, new Map<string, { query: string; count: number; latestAt: number; contextIds: string[]; chatKeys: string[] }>())
  const list = Array.isArray(misses)
    ? misses
    : [...misses.values()].sort((a, b) => b.count - a.count || b.latestAt - a.latestAt).slice(0, parseNumberQuery(req.query.limit) ?? 20)
  res.json({ namespace: ns.name, since, until: until ?? null, misses: list })
})

// GET /api/wiki/:namespace/metrics
wikiRouter.get('/:namespace/metrics', async (req, res) => {
  if (!wikiRootRequired(res)) return
  const ns = await findNamespaceOr404(nsParam(req), res)
  if (!ns) return
  const { since, until } = queryWindow(req)
  const [files, bindings, pendingDraftCount, retrievalCounts, hotDocuments, topMisses] = await Promise.all([
    collectMdFiles(namespaceDir(ns)),
    bindingSummary(ns.name),
    WikiDraftRepository.countPendingByNamespace(ns.name),
    WikiRetrievalLogRepository.countByNamespace(ns.name, since),
    WikiRetrievalLogRepository.hotDocuments(ns.name, since, 10),
    WikiRetrievalLogRepository.summarizeMisses(ns.name, since, 10),
  ])
  const latestModifiedAt = files.reduce<number | null>((latest, file) => latest === null ? file.updatedAt : Math.max(latest, file.updatedAt), null)
  res.json({
    namespace: ns.name,
    since,
    until: until ?? null,
    fileCount: files.length,
    bindingCount: bindings.length,
    pendingDraftCount,
    latestModifiedAt,
    retrievalCount: retrievalCounts.total,
    missCount: retrievalCounts.misses,
    hotDocuments,
    topMisses,
  })
})

// GET /api/wiki/:namespace/bindings
wikiRouter.get('/:namespace/bindings', async (req, res) => {
  const ns = await findNamespaceOr404(nsParam(req), res)
  if (!ns) return
  res.json(await bindingSummary(ns.name))
})

// POST /api/wiki/:namespace/bindings
wikiRouter.post('/:namespace/bindings', async (req, res) => {
  const ns = await findNamespaceOr404(nsParam(req), res)
  if (!ns) return
  const body = req.body as Record<string, unknown>
  const contextId = String(body.contextId ?? '')
  if (!contextId) { res.status(400).json({ error: 'contextId is required' }); return }
  const context = await ContextRepository.findById(contextId)
  if (!context) { res.status(404).json({ error: 'context not found' }); return }
  if (body.botId && context.botId !== body.botId) { res.status(400).json({ error: 'context does not belong to botId' }); return }

  const servers = await McpServerRepository.findAll()
  const mcpServer = body.mcpServerId
    ? servers.find((server) => server.id === body.mcpServerId)
    : servers.find((server) => server.enabled && isWikiMcpServer(server))
  if (!mcpServer) { res.status(400).json({ error: 'wiki-mcp server is not configured' }); return }
  if (!isWikiMcpServer(mcpServer)) { res.status(400).json({ error: 'selected MCP server is not wiki-mcp' }); return }
  if (!mcpServer.enabled) { res.status(400).json({ error: 'wiki-mcp server is disabled' }); return }

  const existing = (context.mcpConfigs ?? []).find((cfg) => cfg.mcpServerId === mcpServer.id)
  const nextConfig = buildWikiConfig(existing, mcpServer.id, ns.name, body)
  const mcpConfigs = existing
    ? context.mcpConfigs.map((cfg) => cfg.mcpServerId === mcpServer.id ? nextConfig : cfg)
    : [...(context.mcpConfigs ?? []), nextConfig]
  const updated = await ContextRepository.update(context.id, { mcpConfigs })
  res.status(201).json(updated)
})

// PUT /api/wiki/:namespace/bindings/:contextId/policy
wikiRouter.put('/:namespace/bindings/:contextId/policy', async (req, res) => {
  const ns = await findNamespaceOr404(nsParam(req), res)
  if (!ns) return
  const context = await ContextRepository.findById(req.params.contextId)
  if (!context) { res.status(404).json({ error: 'context not found' }); return }
  const servers = await McpServerRepository.findAll()
  const wikiIds = new Set(servers.filter(isWikiMcpServer).map((server) => server.id))
  const target = context.mcpConfigs.find((cfg) => wikiIds.has(cfg.mcpServerId) && namespacesFromConfig(cfg).includes(ns.name))
  if (!target) { res.status(404).json({ error: 'binding not found' }); return }
  const next = buildWikiConfig(target, target.mcpServerId, ns.name, req.body as Record<string, unknown>)
  const updated = await ContextRepository.update(context.id, {
    mcpConfigs: context.mcpConfigs.map((cfg) => cfg === target ? next : cfg),
  })
  res.json(updated)
})

// DELETE /api/wiki/:namespace/bindings/:contextId
wikiRouter.delete('/:namespace/bindings/:contextId', async (req, res) => {
  const ns = await findNamespaceOr404(nsParam(req), res)
  if (!ns) return
  const context = await ContextRepository.findById(req.params.contextId)
  if (!context) { res.status(404).json({ error: 'context not found' }); return }
  const servers = await McpServerRepository.findAll()
  const wikiIds = new Set(servers.filter(isWikiMcpServer).map((server) => server.id))
  const mcpConfigs = context.mcpConfigs.map((cfg) => {
    if (!wikiIds.has(cfg.mcpServerId) || !namespacesFromConfig(cfg).includes(ns.name)) return cfg
    const params = { ...(cfg.params ?? {}) }
    const namespaces = namespacesFromConfig(cfg).filter((item) => item !== ns.name)
    if (namespaces.length === 0) {
      delete params.namespace
      return { ...cfg, enabled: false, params, forceCall: false }
    }
    params.namespace = Array.isArray(cfg.params?.namespace) ? namespaces : namespaces[0]
    return { ...cfg, params }
  })
  await ContextRepository.update(context.id, { mcpConfigs })
  res.status(204).send()
})

// GET /api/wiki/:namespace/drafts
wikiRouter.get('/:namespace/drafts', async (req, res) => {
  const ns = await findNamespaceOr404(nsParam(req), res)
  if (!ns) return
  res.json(await WikiDraftRepository.findByNamespace(ns.name))
})

// POST /api/wiki/:namespace/drafts
wikiRouter.post('/:namespace/drafts', async (req, res) => {
  const ns = await findNamespaceOr404(nsParam(req), res)
  if (!ns) return
  const body = req.body as Record<string, unknown>
  const targetPath = String(body.targetPath ?? body.target_path ?? '')
  const content = String(body.content ?? '')
  if (!safeRelativePath(targetPath, true) || !content.trim()) {
    res.status(400).json({ error: 'targetPath and content are required' })
    return
  }
  const draft = await WikiDraftRepository.create({
    namespace: ns.name,
    targetPath,
    content,
    sourceType: String(body.sourceType ?? 'manual'),
    sourceRef: body.sourceRef ? String(body.sourceRef) : null,
    mergeStrategy: mergeStrategy(body.mergeStrategy),
  })
  res.status(201).json(draft)
})

// PUT /api/wiki/:namespace/drafts/:id
wikiRouter.put('/:namespace/drafts/:id', async (req, res) => {
  const ns = await findNamespaceOr404(nsParam(req), res)
  if (!ns) return
  const draft = await WikiDraftRepository.findById(req.params.id)
  if (!draft || draft.namespace !== ns.name) { res.status(404).json({ error: 'draft not found' }); return }
  if (draft.status !== 'pending') { res.status(409).json({ error: 'draft is not pending' }); return }
  const body = req.body as Record<string, unknown>
  const nextTarget = body.targetPath !== undefined ? String(body.targetPath) : undefined
  const nextContent = body.content !== undefined ? String(body.content) : undefined
  if (nextTarget !== undefined && !safeRelativePath(nextTarget, true)) {
    res.status(400).json({ error: 'invalid target path' })
    return
  }
  if (nextContent !== undefined && !nextContent.trim()) {
    res.status(400).json({ error: 'content is required' })
    return
  }
  const updated = await WikiDraftRepository.update(draft.id, {
    targetPath: nextTarget,
    content: nextContent,
    sourceRef: body.sourceRef !== undefined ? String(body.sourceRef ?? '') || null : undefined,
    mergeStrategy: body.mergeStrategy !== undefined ? mergeStrategy(body.mergeStrategy) : undefined,
    reviewReason: body.reviewReason !== undefined ? String(body.reviewReason ?? '') || null : undefined,
  })
  res.json(updated)
})

// GET /api/wiki/:namespace/drafts/:id/diff
wikiRouter.get('/:namespace/drafts/:id/diff', async (req, res) => {
  if (!wikiRootRequired(res)) return
  const ns = await findNamespaceOr404(nsParam(req), res)
  if (!ns) return
  const draft = await WikiDraftRepository.findById(req.params.id)
  if (!draft || draft.namespace !== ns.name) { res.status(404).json({ error: 'draft not found' }); return }
  const strategy = mergeStrategy(req.query.strategy, draft.mergeStrategy)
  const safeTarget = safeRelativePath(draft.targetPath, true)
  if (!safeTarget) { res.status(400).json({ error: 'invalid target path' }); return }
  const full = join(namespaceDir(ns), safeTarget)
  const targetExists = existsSync(full)
  const currentContent = targetExists ? await readFile(full, 'utf-8') : ''
  const nextContent = strategy === 'createOnly' && targetExists ? currentContent : mergedContent(currentContent, draft.content, strategy)
  res.json({
    draftId: draft.id,
    namespace: ns.name,
    targetPath: safeTarget,
    strategy,
    targetExists,
    currentContent,
    nextContent,
    diff: targetExists ? textDiff(currentContent, nextContent) : [`+ ${draft.content}`],
    error: strategy === 'createOnly' && targetExists ? 'target file already exists' : null,
  })
})

// POST /api/wiki/:namespace/drafts/:id/approve
wikiRouter.post('/:namespace/drafts/:id/approve', async (req, res) => {
  if (!wikiRootRequired(res)) return
  const ns = await findNamespaceOr404(nsParam(req), res)
  if (!ns) return
  const draft = await WikiDraftRepository.findById(req.params.id)
  if (!draft || draft.namespace !== ns.name) { res.status(404).json({ error: 'draft not found' }); return }
  if (draft.status !== 'pending') { res.status(409).json({ error: 'draft is not pending' }); return }

  const safeTarget = safeRelativePath(draft.targetPath, true)
  if (!safeTarget) { res.status(400).json({ error: 'invalid target path' }); return }
  const full = join(namespaceDir(ns), safeTarget)
  const strategy = mergeStrategy((req.body as Record<string, unknown>)?.mergeStrategy, draft.mergeStrategy)
  try {
    await mkdir(dirname(full), { recursive: true })
    const targetExists = existsSync(full)
    const existing = targetExists ? await readFile(full, 'utf-8') : ''
    if (strategy === 'createOnly' && targetExists) {
      res.status(409).json({ error: 'target file already exists' })
      return
    }
    await writeFile(full, mergedContent(existing, draft.content, strategy), 'utf-8')
    const git = simpleGit(WIKI_ROOT)
    await git.add(full)
    await git.commit(`wiki: approve draft ${draft.id} to ${ns.name}/${safeTarget} (${strategy})`)
    const merged = await WikiDraftRepository.markMerged(draft.id, String((req.body as Record<string, unknown>)?.reviewedBy ?? 'admin'))
    res.json(merged)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// POST /api/wiki/:namespace/drafts/:id/reject
wikiRouter.post('/:namespace/drafts/:id/reject', async (req, res) => {
  const ns = await findNamespaceOr404(nsParam(req), res)
  if (!ns) return
  const draft = await WikiDraftRepository.findById(req.params.id)
  if (!draft || draft.namespace !== ns.name) { res.status(404).json({ error: 'draft not found' }); return }
  if (draft.status !== 'pending') { res.status(409).json({ error: 'draft is not pending' }); return }
  const body = req.body as Record<string, unknown>
  const rejected = await WikiDraftRepository.markRejected(draft.id, body.reason ? String(body.reason) : null, String(body.reviewedBy ?? 'admin'))
  res.json(rejected)
})

// GET /api/wiki/:namespace/files - directory tree
wikiRouter.get('/:namespace/files', async (req, res) => {
  if (!wikiRootRequired(res)) return
  const ns = await findNamespaceOr404(nsParam(req), res)
  if (!ns) return
  const dir = namespaceDir(ns)
  if (!existsSync(dir)) { res.json([]); return }
  res.json(await buildTree(dir, dir))
})

// GET /api/wiki/:namespace/files/*filePath - file content and metadata
wikiRouter.get('/:namespace/files/*filePath', async (req, res) => {
  if (!wikiRootRequired(res)) return
  const ns = await findNamespaceOr404(nsParam(req), res)
  if (!ns) return
  const safePath = safeRelativePath(wildcardParam(req, 'filePath'))
  if (!safePath) { res.status(400).json({ error: 'invalid path' }); return }
  const full = join(namespaceDir(ns), safePath)
  if (!existsSync(full)) { res.status(404).json({ error: 'file not found' }); return }
  const s = await stat(full)
  const content = await readFile(full, 'utf-8')
  res.json({ path: safePath, content, size: s.size, updatedAt: s.mtimeMs })
})

// POST /api/wiki/:namespace/upload
wikiRouter.post('/:namespace/upload', upload.array('files'), async (req, res) => {
  if (!wikiRootRequired(res)) return
  const ns = await findNamespaceOr404(nsParam(req), res)
  if (!ns) return
  const nsDir = namespaceDir(ns)
  await mkdir(nsDir, { recursive: true })

  const files = (req.files ?? []) as Express.Multer.File[]
  const uploaded: string[] = []

  for (const file of files) {
    const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf8')
    const safeName = safeRelativePath(decodedName)
    if (!safeName || extname(safeName).toLowerCase() !== '.md') continue
    const dest = join(nsDir, safeName)
    await mkdir(dirname(dest), { recursive: true })
    await writeFile(dest, file.buffer)
    uploaded.push(safeName)
  }

  if (uploaded.length > 0) {
    try {
      const git = simpleGit(WIKI_ROOT)
      await git.add(uploaded.map((file) => join(nsDir, file)))
      await git.commit(`wiki: upload ${uploaded.length} file(s) to ${ns.name}`)
    } catch {
      // Git commit failure is non-fatal for manual uploads.
    }
  }

  res.json({ uploaded })
})

// DELETE /api/wiki/:namespace/files/*filePath
wikiRouter.delete('/:namespace/files/*filePath', async (req, res) => {
  if (!wikiRootRequired(res)) return
  const ns = await findNamespaceOr404(nsParam(req), res)
  if (!ns) return
  const safePath = safeRelativePath(wildcardParam(req, 'filePath'))
  if (!safePath) { res.status(400).json({ error: 'invalid path' }); return }
  const full = join(namespaceDir(ns), safePath)
  if (!existsSync(full)) { res.status(404).json({ error: 'file not found' }); return }
  await unlink(full)
  try {
    const git = simpleGit(WIKI_ROOT)
    await git.add(full)
    await git.commit(`wiki: delete ${ns.name}/${safePath}`)
  } catch {
    // Git commit failure is non-fatal for manual deletes.
  }
  res.json({ deleted: safePath })
})
