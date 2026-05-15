import { simpleGit, type SimpleGit } from 'simple-git'

let git: SimpleGit | null = null

export function initGit(wikiRoot: string): void {
  git = simpleGit(wikiRoot)
}

// Serialized write queue — prevents concurrent git operations
let writeQueue: Promise<void> = Promise.resolve()

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(fn)
  writeQueue = result.then(
    () => {},
    () => {}
  )
  return result
}

export async function gitPull(): Promise<string> {
  if (!git) return '未初始化 Git'
  try {
    const result = await git.pull()
    const changed = result.files.length
    return changed > 0 ? `已更新 ${changed} 个文件` : '已是最新'
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('no tracking information') || msg.includes('no remote')) {
      return '未配置 Git remote，跳过 pull'
    }
    throw err
  }
}

export async function gitCommit(filePath: string, message: string): Promise<void> {
  if (!git) return
  return enqueue(async () => {
    await git!.add(filePath)
    try {
      await git!.commit(message)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      // "nothing to commit" is not an error
      if (!msg.includes('nothing to commit')) throw err
    }
  })
}

export async function isGitRepo(wikiRoot: string): Promise<boolean> {
  try {
    const g = simpleGit(wikiRoot)
    await g.status()
    return true
  } catch {
    return false
  }
}
