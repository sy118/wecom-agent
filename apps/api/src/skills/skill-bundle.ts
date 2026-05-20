import { createHash, randomUUID } from 'crypto'
import { mkdir, rm, writeFile } from 'fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'path'
import type { SkillBundleMetadata, SkillDefinition, SkillPermissionPolicy, SkillResourceIndex } from '@wecom-platform/types'

const DEFAULT_SKILL_STORAGE_ROOT = './data/skills'
const MAX_FILES = 200
const MAX_TOTAL_BYTES = 10 * 1024 * 1024
const MAX_FILE_BYTES = 2 * 1024 * 1024
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/
const FRONTMATTER_ERROR = 'SKILL.md 必须以 YAML frontmatter 开头，例如：\n---\nname: my-skill\ndescription: 技能说明\n---'

export interface UploadedSkillFile {
  originalname: string
  buffer: Buffer
  size: number
}

export interface ValidatedSkillBundle {
  id: string
  metadata: SkillBundleMetadata
  resourceIndex: SkillResourceIndex
  files: Array<{ relativePath: string; buffer: Buffer; size: number }>
  bundleHash: string
  skillMd: string
}

function normalizeUploadPath(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.includes('\0') || normalized.startsWith('../') || normalized.includes('/../') || normalized === '..') {
    throw new Error(`Invalid file path: ${rawPath}`)
  }
  if (/^[a-zA-Z]:/.test(normalized) || isAbsolute(normalized)) {
    throw new Error(`Absolute file paths are not allowed: ${rawPath}`)
  }
  return normalized.split('/').filter(Boolean).join('/')
}

function stripCommonRoot(paths: string[]): Map<string, string> {
  if (paths.includes('SKILL.md')) return new Map(paths.map((p) => [p, p]))
  const firstSegments = new Set(paths.map((p) => p.split('/')[0]))
  if (firstSegments.size !== 1) return new Map(paths.map((p) => [p, p]))
  const root = [...firstSegments][0]
  const stripped = new Map<string, string>()
  for (const path of paths) {
    stripped.set(path, path.slice(root.length + 1))
  }
  return stripped
}

function parseFrontmatter(skillMd: string): SkillBundleMetadata {
  const normalizedSkillMd = skillMd.replace(/^\uFEFF/, '').replace(/^\s+(?=---\r?\n)/, '')
  const match = normalizedSkillMd.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) throw new Error(FRONTMATTER_ERROR)
  const metadata: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const next = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!next) continue
    const value = next[2].trim().replace(/^["']|["']$/g, '')
    metadata[next[1]] = value
  }
  const name = metadata.name
  const description = metadata.description
  if (!name || !SKILL_NAME_PATTERN.test(name)) {
    throw new Error('SKILL.md frontmatter 中的 name 只能使用小写字母、数字和连字符')
  }
  if (!description) throw new Error('SKILL.md frontmatter 必须包含 description')
  return { ...metadata, name, description }
}

function buildResourceIndex(files: Array<{ relativePath: string; size: number }>): SkillResourceIndex {
  const index: SkillResourceIndex = {
    skillMdPath: 'SKILL.md',
    scripts: [],
    references: [],
    assets: [],
    otherFiles: [],
    totalFiles: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
  }
  for (const file of files) {
    if (file.relativePath === 'SKILL.md') continue
    if (file.relativePath.startsWith('scripts/')) index.scripts.push(file.relativePath)
    else if (file.relativePath.startsWith('references/')) index.references.push(file.relativePath)
    else if (file.relativePath.startsWith('assets/')) index.assets.push(file.relativePath)
    else index.otherFiles.push(file.relativePath)
  }
  index.scripts.sort()
  index.references.sort()
  index.assets.sort()
  index.otherFiles.sort()
  return index
}

function hashBundle(files: Array<{ relativePath: string; buffer: Buffer }>): string {
  const hash = createHash('sha256')
  for (const file of [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    hash.update(file.relativePath)
    hash.update('\0')
    hash.update(file.buffer)
    hash.update('\0')
  }
  return hash.digest('hex')
}

export function validateSkillBundle(files: UploadedSkillFile[]): ValidatedSkillBundle {
  if (files.length === 0) throw new Error('Skill upload must include files')
  if (files.length > MAX_FILES) throw new Error(`Skill upload exceeds ${MAX_FILES} files`)

  const normalizedPaths = files.map((file) => normalizeUploadPath(file.originalname))
  const pathMap = stripCommonRoot(normalizedPaths)
  const seen = new Set<string>()
  const normalizedFiles = files.map((file, index) => {
    const relativePath = pathMap.get(normalizedPaths[index]) ?? normalizedPaths[index]
    if (!relativePath || relativePath.includes('..')) throw new Error(`Invalid file path: ${file.originalname}`)
    if (seen.has(relativePath)) throw new Error(`Duplicate file path: ${relativePath}`)
    if (file.size > MAX_FILE_BYTES) throw new Error(`File exceeds max size: ${relativePath}`)
    seen.add(relativePath)
    return { relativePath, buffer: file.buffer, size: file.size }
  })

  const totalBytes = normalizedFiles.reduce((sum, file) => sum + file.size, 0)
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`Skill upload exceeds ${MAX_TOTAL_BYTES} bytes`)

  const skillMdFile = normalizedFiles.find((file) => file.relativePath === 'SKILL.md')
  if (!skillMdFile) throw new Error('Skill upload must include a top-level SKILL.md')
  const skillMd = skillMdFile.buffer.toString('utf8')
  const metadata = parseFrontmatter(skillMd)

  return {
    id: randomUUID(),
    metadata,
    resourceIndex: buildResourceIndex(normalizedFiles),
    files: normalizedFiles,
    bundleHash: hashBundle(normalizedFiles),
    skillMd,
  }
}

export function skillStorageRoot(): string {
  return resolve(process.env.SKILL_STORAGE_ROOT ?? DEFAULT_SKILL_STORAGE_ROOT)
}

export function skillBundlePath(scope: string, skillId: string): string {
  return resolve(skillStorageRoot(), scope, skillId, 'current')
}

export async function installSkillBundle(scope: string, bundle: ValidatedSkillBundle): Promise<string> {
  const root = skillBundlePath(scope, bundle.id)
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  for (const file of bundle.files) {
    const target = resolve(root, ...file.relativePath.split('/'))
    const rel = relative(root, target)
    if (rel.startsWith('..') || rel === '' || rel.split(sep).includes('..')) {
      throw new Error(`Invalid install path: ${file.relativePath}`)
    }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, file.buffer)
  }
  return root
}

export async function removeSkillBundle(skill: SkillDefinition): Promise<void> {
  if (!skill.bundlePath) return
  const root = skillStorageRoot()
  const target = resolve(skill.bundlePath)
  const rel = relative(root, target)
  if (rel.startsWith('..') || isAbsolute(rel)) return
  await rm(target, { recursive: true, force: true })
}

export function defaultPermissionPolicy(overrides: SkillPermissionPolicy = {}): SkillPermissionPolicy {
  return {
    scriptsEnabled: false,
    timeoutMs: 30_000,
    maxOutputBytes: 64 * 1024,
    maxConcurrentRuns: 1,
    allowedEnvKeys: [],
    networkAccess: false,
    ...overrides,
  }
}
