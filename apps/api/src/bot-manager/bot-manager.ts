import { EventEmitter } from 'events'
import { BotInstance } from './bot-instance.js'
import { BotRepository } from '../db/bot-repository.js'
import { ContextRepository } from '../db/context-repository.js'
import { BindingRepository } from '../db/binding-repository.js'
import { McpServerRepository } from '../db/mcp-server-repository.js'
import { SkillRepository } from '../db/skill-repository.js'
import { db } from '../db/client.js'
import type { BotStatus, BotStatusEvent, ContextConfig } from '@wecom-platform/types'

export class BotManager extends EventEmitter {
  private instances = new Map<string, BotInstance>()
  private mcpRefreshInFlight: Promise<void> | null = null
  private mcpRefreshPending = false

  async start(botId: string): Promise<void> {
    if (this.instances.has(botId)) {
      throw new Error(`Bot ${botId} is already running`)
    }

    const bot = await BotRepository.findById(botId)
    if (!bot) throw new Error(`Bot ${botId} not found`)

    const contexts = await ContextRepository.findByBotId(botId)
    const bindings = await BindingRepository.findByBotId(botId)
    const mcpServers = await McpServerRepository.findAll()
    const skills = await SkillRepository.findAll()

    const instance = new BotInstance({ bot, contexts, bindings, mcpServers, skills, db })

    try {
      await instance.start()
      this.instances.set(botId, instance)
      await BotRepository.updateStatus(botId, 'running')
      this.emitStatus(botId, 'running')
    } catch (err) {
      await BotRepository.updateStatus(botId, 'error')
      this.emitStatus(botId, 'error', String(err))
      throw err
    }
  }

  async stop(botId: string): Promise<void> {
    const instance = this.instances.get(botId)
    if (!instance) return

    await instance.stop()
    this.instances.delete(botId)
    await BotRepository.updateStatus(botId, 'stopped')
    this.emitStatus(botId, 'stopped')
  }

  async restart(botId: string): Promise<void> {
    if (!this.instances.has(botId)) return
    await this.stop(botId)
    await this.start(botId)
  }

  isRunning(botId: string): boolean {
    return this.instances.has(botId)
  }

  getStatus(botId: string): BotStatus {
    return this.instances.has(botId) ? 'running' : 'stopped'
  }

  async getActiveSessions(botId: string) {
    return (await this.instances.get(botId)?.getActiveSessions()) ?? []
  }

  async getAllActiveSessions() {
    const all = []
    for (const [botId, instance] of this.instances) {
      for (const session of await instance.getActiveSessions()) {
        all.push({ botId, ...session })
      }
    }
    return all
  }

  deleteSession(botId: string, chatKey: string): void {
    this.instances.get(botId)?.deleteSession(chatKey)
  }

  getDiscoveredChats(botId: string) {
    return this.instances.get(botId)?.getDiscoveredChats() ?? []
  }

  addBinding(botId: string, chatKey: string, contextId: string): void {
    this.instances.get(botId)?.addBinding(chatKey, contextId)
  }

  removeBinding(botId: string, chatKey: string): void {
    this.instances.get(botId)?.removeBinding(chatKey)
  }

  updateBinding(botId: string, chatKey: string, contextId: string): void {
    this.instances.get(botId)?.updateBinding(chatKey, contextId)
  }

  upsertContext(botId: string, context: ContextConfig): void {
    this.instances.get(botId)?.upsertContext(context)
  }

  async refreshContexts(botId: string): Promise<void> {
    const instance = this.instances.get(botId)
    if (!instance) return
    instance.reloadContexts(await ContextRepository.findByBotId(botId))
  }

  async refreshBindings(botId: string): Promise<void> {
    const instance = this.instances.get(botId)
    if (!instance) return
    instance.reloadBindings(await BindingRepository.findByBotId(botId))
  }

  async refreshMcpServers(botId?: string): Promise<void> {
    if (this.mcpRefreshInFlight) {
      this.mcpRefreshPending = true
      return this.mcpRefreshInFlight
    }

    this.mcpRefreshInFlight = (async () => {
      try {
        await this.runMcpServersRefresh(botId)
        while (this.mcpRefreshPending) {
          this.mcpRefreshPending = false
          await this.runMcpServersRefresh()
        }
      } finally {
        this.mcpRefreshInFlight = null
        this.mcpRefreshPending = false
      }
    })()

    return this.mcpRefreshInFlight
  }

  private async runMcpServersRefresh(botId?: string): Promise<void> {
    const mcpServers = await McpServerRepository.findAll()
    const targets = botId
      ? [...this.instances].filter(([id]) => id === botId)
      : [...this.instances]
    await Promise.all(targets.map(([, instance]) => instance.reloadMcpServers(mcpServers)))
  }

  async refreshSkills(botId?: string): Promise<void> {
    const skills = await SkillRepository.findAll()
    const targets = botId
      ? [...this.instances].filter(([id]) => id === botId)
      : [...this.instances]
    for (const [, instance] of targets) {
      instance.reloadSkills(skills)
    }
  }

  async invokeForTask(botId: string, prompt: string, systemPrompt: string, targetChatId: string): Promise<string> {
    const instance = this.instances.get(botId)
    if (!instance) throw new Error(`Bot ${botId} is not running`)
    return instance.invokeForScheduledTask(prompt, systemPrompt, targetChatId)
  }

  async sendMessageForTask(botId: string, chatId: string, text: string): Promise<void> {
    const instance = this.instances.get(botId)
    if (!instance) throw new Error(`Bot ${botId} is not running`)
    await instance.sendMessage(chatId, text)
  }

  private emitStatus(botId: string, status: BotStatus, error?: string): void {
    const event: BotStatusEvent = { type: 'bot_status', botId, status, error }
    this.emit('status', event)
  }
}

export const botManager = new BotManager()
