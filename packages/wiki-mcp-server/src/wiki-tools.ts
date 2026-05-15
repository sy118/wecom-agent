import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, normalize, relative, extname, basename } from 'path'
import { gitCommit, gitPull } from './git-sync.js'

export interface WikiFileNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  children?: WikiFileNode[]
}

export interface SearchResult {
  path: string
  namespace: string
  title: string
  excerpt: string
}

function resolveNamespacePath(wikiRoot: string, namespace?: string): string {
  if (!namespace) return wikiRoot
  return join(wikiRoot, 'namespaces', namespace)
}

function safePath(base: string, userPath: string): string | null {
  const normalized = normalize(userPath)
  if (normalized.includes('..') || normalized.startsWith('/') || normalized.startsWith('\\')) {
    return null
  }
  const full = join(base, normalized.endsWith('.md') ? normalized : `${normalized}.md`)
  const rel = relative(base, full)
  if (rel.startsWith('..')) return null
  return full
}

async function buildFileTree(dir: string, baseDir: string): Promise<WikiFileNode[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nodes: WikiFileNode[] = []
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    const relPath = relative(baseDir, fullPath)
    if (entry.isDirectory()) {
      const children = await buildFileTree(fullPath, baseDir)
      nodes.push({ name: entry.name, path: relPath, type: 'dir', children })
    } else if (entry.isFile() && extname(entry.name) === '.md') {
      const s = await stat(fullPath)
      nodes.push({ name: entry.name, path: relPath, type: 'file', size: s.size })
    }
  }
  return nodes
}

async function collectMdFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectMdFiles(full))
    } else if (entry.isFile() && extname(entry.name) === '.md') {
      files.push(full)
    }
  }
  return files
}

export async function wikiRead(
  wikiRoot: string,
  path: string,
  namespace?: string,
  maxChars?: number
): Promise<string> {
  const nsDir = resolveNamespacePath(wikiRoot, namespace)
  const full = safePath(nsDir, path)
  if (!full) return '错误: 非法路径'
  if (!existsSync(full)) return `页面不存在: ${path}`
  let content = await readFile(full, 'utf-8')
  if (maxChars && content.length > maxChars) {
    content = content.slice(0, maxChars) + '\n\n...(内容已截断)'
  }
  return content
}

export async function wikiSearch(
  wikiRoot: string,
  query: string,
  namespace?: string,
  crossNs?: boolean
): Promise<SearchResult[]> {
  const lowerQuery = query.toLowerCase()
  const results: SearchResult[] = []

  const searchInDir = async (dir: string, ns: string) => {
    if (!existsSync(dir)) return
    const files = await collectMdFiles(dir)
    for (const file of files) {
      const content = await readFile(file, 'utf-8')
      const fileName = basename(file, '.md')
      const relPath = relative(dir, file)
      if (!fileName.toLowerCase().includes(lowerQuery) && !content.toLowerCase().includes(lowerQuery)) continue
      const titleMatch = content.match(/^#\s+(.+)/m)
      const title = titleMatch ? titleMatch[1] : fileName
      const idx = content.toLowerCase().indexOf(lowerQuery)
      const start = Math.max(0, idx - 80)
      const end = Math.min(content.length, idx + 120)
      const excerpt = content.slice(start, end).replace(/\n/g, ' ').trim()
      results.push({ path: relPath, namespace: ns, title, excerpt })
    }
  }

  if (crossNs) {
    const nsRoot = join(wikiRoot, 'namespaces')
    if (existsSync(nsRoot)) {
      const entries = await readdir(nsRoot, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await searchInDir(join(nsRoot, entry.name), entry.name)
        }
      }
    }
    await searchInDir(wikiRoot, '_root')
  } else {
    const dir = resolveNamespacePath(wikiRoot, namespace)
    await searchInDir(dir, namespace ?? '_root')
  }

  return results
}

export async function wikiWrite(
  wikiRoot: string,
  path: string,
  content: string,
  namespace?: string
): Promise<string> {
  const nsDir = resolveNamespacePath(wikiRoot, namespace)
  const full = safePath(nsDir, path)
  if (!full) return '错误: 非法路径'
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, content, 'utf-8')
  const ns = namespace ?? '_root'
  await gitCommit(full, `wiki: update ${ns}/${path}`)
  return `已写入: ${path}`
}

export async function wikiAppend(
  wikiRoot: string,
  path: string,
  content: string,
  namespace?: string
): Promise<string> {
  const nsDir = resolveNamespacePath(wikiRoot, namespace)
  const full = safePath(nsDir, path)
  if (!full) return '错误: 非法路径'
  await mkdir(join(full, '..'), { recursive: true })
  const existing = existsSync(full) ? await readFile(full, 'utf-8') : ''
  const separator = existing && !existing.endsWith('\n') ? '\n\n' : existing ? '\n' : ''
  await writeFile(full, existing + separator + content, 'utf-8')
  const ns = namespace ?? '_root'
  await gitCommit(full, `wiki: append ${ns}/${path}`)
  return `已追加: ${path}`
}

export async function wikiList(
  wikiRoot: string,
  namespace?: string
): Promise<WikiFileNode[]> {
  if (!namespace) {
    const nsRoot = join(wikiRoot, 'namespaces')
    if (!existsSync(nsRoot)) return []
    const entries = await readdir(nsRoot, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, path: e.name, type: 'dir' as const }))
  }
  const dir = resolveNamespacePath(wikiRoot, namespace)
  if (!existsSync(dir)) return []
  return buildFileTree(dir, dir)
}

export async function wikiGitPull(): Promise<string> {
  return gitPull()
}
