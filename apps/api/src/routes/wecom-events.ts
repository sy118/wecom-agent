import { Router, type Request, type Response } from 'express'
import { createDecipheriv, createHash } from 'crypto'
import { BotRepository } from '../db/bot-repository.js'
import { ContextRepository } from '../db/context-repository.js'
import { botManager } from '../bot-manager/bot-manager.js'
import { handleIncomingWecomEvent, parseIncomingEventPayload } from '../services/wecom-event-service.js'

export const wecomEventsRouter: Router = Router()

interface CallbackSecrets {
  token: string | null
  aesKey: string | null
  corpId: string | null
}

function queryValue(value: unknown): string | null {
  if (Array.isArray(value)) return value[0] ? String(value[0]) : null
  return value === undefined || value === null ? null : String(value)
}

function requestBodyText(req: Request): string {
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8')
  if (typeof req.body === 'string') return req.body
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body)
  return ''
}

function parseMaybeJson(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return {}
  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}

function extractEncryptedPayload(input: unknown): string | null {
  if (!input) return null
  if (typeof input === 'object' && !Array.isArray(input)) {
    const body = input as Record<string, unknown>
    const encrypted = body.encrypt ?? body.Encrypt ?? body.encrypted ?? body.Encrypted
    return encrypted === undefined || encrypted === null ? null : String(encrypted)
  }
  if (typeof input !== 'string') return null
  const match = input.match(/<Encrypt><!\[CDATA\[([\s\S]+?)\]\]><\/Encrypt>|<Encrypt>([\s\S]+?)<\/Encrypt>/i)
  return match?.[1] ?? match?.[2] ?? null
}

function callbackSecrets(botSecret?: string | null): CallbackSecrets {
  const token = process.env.WECOM_CALLBACK_TOKEN?.trim() || botSecret || null
  const configuredAesKey = process.env.WECOM_CALLBACK_AES_KEY?.trim() || null
  const botSecretAsAesKey = botSecret && /^[A-Za-z0-9+/=-]{43,44}$/.test(botSecret) ? botSecret : null
  return {
    token,
    aesKey: configuredAesKey || botSecretAsAesKey,
    corpId: process.env.WECOM_CALLBACK_CORP_ID?.trim() || null,
  }
}

function sha1Signature(token: string, timestamp: string, nonce: string, encrypted: string): string {
  return createHash('sha1').update([token, timestamp, nonce, encrypted].sort().join('')).digest('hex')
}

function verifySignature(req: Request, encrypted: string, secrets: CallbackSecrets): void {
  const token = secrets.token
  const signature = queryValue(req.query.msg_signature ?? req.query.signature)
  const timestamp = queryValue(req.query.timestamp)
  const nonce = queryValue(req.query.nonce)
  if (!signature || !timestamp || !nonce) return
  if (!token) throw Object.assign(new Error('callback token is not configured'), { statusCode: 503 })
  const expected = sha1Signature(token, timestamp, nonce, encrypted)
  if (expected !== signature) throw Object.assign(new Error('invalid callback signature'), { statusCode: 401 })
}

function decodeAesKey(aesKey: string): Buffer {
  const normalized = aesKey.length === 43 ? `${aesKey}=` : aesKey
  const key = Buffer.from(normalized, 'base64')
  if (key.length !== 32) throw Object.assign(new Error('invalid callback aes key'), { statusCode: 503 })
  return key
}

function decryptCallbackPayload(encrypted: string, secrets: CallbackSecrets): unknown {
  if (!secrets.aesKey) throw Object.assign(new Error('callback aes key is not configured'), { statusCode: 503 })
  const key = decodeAesKey(secrets.aesKey)
  const iv = key.subarray(0, 16)
  const decipher = createDecipheriv('aes-256-cbc', key, iv)
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()])
  const messageLength = decrypted.readUInt32BE(16)
  const payload = decrypted.subarray(20, 20 + messageLength).toString('utf8')
  return parseMaybeJson(payload)
}

function resolveCallbackPayload(req: Request, secrets: CallbackSecrets): unknown {
  const echo = queryValue(req.query.echostr)
  const parsedBody = parseMaybeJson(echo ?? requestBodyText(req))
  const encrypted = extractEncryptedPayload(parsedBody)
  if (!encrypted) return parsedBody
  verifySignature(req, encrypted, secrets)
  return decryptCallbackPayload(encrypted, secrets)
}

async function handleGet(req: Request, res: Response): Promise<void> {
  try {
    const botId = queryValue(req.params.botId)
    const bot = botId ? await BotRepository.findById(botId) : null
    if (botId && !bot) { res.status(404).json({ error: 'bot not found' }); return }
    const payload = resolveCallbackPayload(req, callbackSecrets(bot?.wecomBotSecret))
    res.type('text/plain').send(typeof payload === 'string' ? payload : JSON.stringify(payload))
  } catch (err: any) {
    res.status(err.statusCode ?? 400).json({ error: err instanceof Error ? err.message : String(err) })
  }
}

async function handlePost(req: Request, res: Response): Promise<void> {
  try {
    const botId = queryValue(req.params.botId)
    const bot = botId ? await BotRepository.findById(botId) : null
    if (botId && !bot) { res.status(404).json({ error: 'bot not found' }); return }
    const payload = resolveCallbackPayload(req, callbackSecrets(bot?.wecomBotSecret))
    const event = parseIncomingEventPayload(payload)
    if (!event) { res.status(400).json({ error: 'invalid wecom event payload' }); return }
    const contexts = bot ? await ContextRepository.findByBotId(bot.id) : undefined
    const handledByRuntime = bot ? await botManager.handleWecomEvent(bot.id, event) : false
    if (!handledByRuntime) {
      await handleIncomingWecomEvent(event, { botId: bot?.id ?? null, contexts })
    }
    res.status(200).json({})
  } catch (err: any) {
    res.status(err.statusCode ?? 500).json({ error: err instanceof Error ? err.message : String(err) })
  }
}

wecomEventsRouter.get('/', handleGet)
wecomEventsRouter.get('/:botId', handleGet)
wecomEventsRouter.post('/', handlePost)
wecomEventsRouter.post('/:botId', handlePost)
