#!/usr/bin/env node
// wiki-compiler: extract candidate knowledge and create reviewable Wiki drafts.

import { createInterface } from 'readline'
import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'

async function readStdin() {
  const rl = createInterface({ input: process.stdin })
  return new Promise((resolve, reject) => {
    let data = ''
    rl.on('line', (line) => { data += line })
    rl.on('error', reject)
    rl.on('close', () => {
      try { resolve(JSON.parse(data || '{}')) } catch (err) { reject(err) }
    })
  })
}

function postJson(baseUrl, path, body, token) {
  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  const payload = JSON.stringify(body)
  const requester = url.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    const req = requester({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : null
          if (res.statusCode >= 400) reject(new Error(parsed?.error ?? `HTTP ${res.statusCode}`))
          else resolve(parsed)
        } catch (err) {
          reject(err)
        }
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function extractKnowledge(conversation) {
  const pairs = []
  for (let i = 0; i < conversation.length - 1; i++) {
    const current = conversation[i]
    const next = conversation[i + 1]
    if (current.role !== 'user' || next.role !== 'assistant') continue
    const question = typeof current.content === 'string' ? current.content.trim() : ''
    const answer = typeof next.content === 'string' ? next.content.trim() : ''
    if (question && answer.length > 100 && !answer.includes('抱歉') && !answer.includes('无法')) {
      pairs.push({ question, answer })
    }
  }
  return pairs
}

function slugify(text) {
  return text
    .slice(0, 40)
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-') || 'knowledge'
}

async function main() {
  const input = await readStdin()
  const {
    conversation = [],
    namespace = 'general',
    wiki_api_url = 'http://localhost:3000/api',
    wiki_api_token,
  } = input

  const pairs = await extractKnowledge(conversation)
  if (pairs.length === 0) {
    process.stdout.write(JSON.stringify({ draft_pages: [], summary: '无新知识草稿' }))
    return
  }

  const draftPages = []
  for (const pair of pairs) {
    const targetPath = `auto/${Date.now()}-${slugify(pair.question)}.md`
    const content = `## Q: ${pair.question}\n\n${pair.answer}\n`
    try {
      await postJson(wiki_api_url, `wiki/${namespace}/drafts`, {
        targetPath,
        content,
        sourceType: 'wiki-compiler',
        sourceRef: pair.question,
      }, wiki_api_token)
      draftPages.push(targetPath)
    } catch (err) {
      process.stderr.write(`create draft failed: ${err.message}\n`)
    }
  }

  process.stdout.write(JSON.stringify({
    draft_pages: draftPages,
    summary: `提炼 ${draftPages.length} 条知识草稿到 namespace "${namespace}"，等待管理员审核`,
  }))
}

main().catch((err) => {
  process.stderr.write(`wiki-compiler error: ${err.message}\n`)
  process.stdout.write(JSON.stringify({ draft_pages: [], summary: `错误: ${err.message}` }))
})
