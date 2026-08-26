import { useEffect, useState } from 'react'
import { Table, Button, Space, Modal, Tag, Popconfirm, message } from 'antd'
import { sessionsApi } from '../api/index.js'

type IncomingContent =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }
  | { type: 'media'; mediaId: string; kind: 'image' | 'file' | 'video'; status?: 'pending' | 'ready' | 'expired' }

interface SessionMessage { role: 'human' | 'ai'; content: string | IncomingContent[] | unknown; timestamp: number }
interface Session { botId: string; chatKey: string; contextId: string; contextName: string; messages: SessionMessage[]; lastActiveAt: number; expiresAt: number }

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Session | null>(null)

  const load = async () => {
    setLoading(true)
    try { setSessions(await sessionsApi.list()) } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (chatKey: string) => {
    await sessionsApi.delete(chatKey)
    message.success('会话已清除'); load()
  }

  const ttlRemaining = (expiresAt: number) => {
    const mins = Math.max(0, Math.floor((expiresAt - Date.now()) / 60_000))
    return `${mins} 分钟`
  }

  const columns = [
    { title: 'Chat Key', dataIndex: 'chatKey', key: 'chatKey' },
    { title: '绑定上下文名', dataIndex: 'contextName', key: 'contextName' },
    { title: '消息数', dataIndex: 'messages', key: 'msgCount', render: (m: SessionMessage[]) => m.length },
    { title: '剩余 TTL', dataIndex: 'expiresAt', key: 'ttl', render: ttlRemaining },
    {
      title: '最后活跃', dataIndex: 'lastActiveAt', key: 'lastActiveAt',
      render: (t: number) => new Date(t).toLocaleString()
    },
    {
      title: '操作', key: 'actions',
      render: (_: any, s: Session) => (
        <Space>
          <Button size="small" onClick={() => setSelected(s)}>查看对话</Button>
          <Popconfirm title="确认清除会话？" onConfirm={() => handleDelete(s.chatKey)}>
            <Button size="small" danger>清除</Button>
          </Popconfirm>
        </Space>
      )
    },
  ]

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>会话监控</h2>
      </div>
      <Table dataSource={sessions} columns={columns} rowKey="chatKey" loading={loading} />
      <Modal title={`对话历史：${selected?.chatKey}`} open={!!selected}
        onCancel={() => setSelected(null)} footer={null} width={700}>
        {(selected?.messages ?? []).map((m, i) => (
          <div key={i} className={`chat-row ${m.role === 'human' ? 'is-human' : 'is-ai'}`}>
            <Tag color={m.role === 'human' ? 'blue' : 'green'}>{m.role === 'human' ? '用户' : 'AI'}</Tag>
            <div className="chat-bubble">
              <MessageContent content={m.content} />
            </div>
          </div>
        ))}
      </Modal>
    </div>
  )
}

function MessageContent({ content }: { content: unknown }) {
  const normalized = normalizeContent(content)

  if (Array.isArray(normalized)) {
    return (
      <div className="chat-content-stack">
        {normalized.map((item, index) => {
          if (item.type === 'text') {
            return <div key={index}>{item.text}</div>
          }
          if (item.type === 'media') {
            if (item.status === 'expired') {
              return <div key={index}><span>媒体已过期</span></div>
            }
            if (item.status === 'pending') {
              return <div key={index}><span>媒体暂不可用，正在重试</span></div>
            }
            const token = localStorage.getItem('token') ?? ''
            const mediaUrl = `/api/media/${encodeURIComponent(item.mediaId)}?token=${encodeURIComponent(token)}`
            if (item.kind === 'image') {
              return (
                <div key={index}>
                  <img src={mediaUrl} alt="图片" style={{ maxWidth: 320, borderRadius: 6 }} />
                </div>
              )
            }
            const label = item.kind === 'video' ? '视频' : '文件'
            return (
              <div key={index}>
                <a href={mediaUrl} target="_blank" rel="noreferrer">下载{label}</a>
              </div>
            )
          }
          return (
            <div key={index}>
              {item.url ? (
                <a href={item.url} target="_blank" rel="noreferrer">
                  图片消息：{shortenUrl(item.url)}
                </a>
              ) : (
                <span>[图片]</span>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return <>{normalized}</>
}

function normalizeContent(content: unknown): string | IncomingContent[] {
  if (isIncomingContentArray(content)) return content

  if (typeof content === 'string') {
    const trimmed = content.trim()
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (isIncomingContentArray(parsed)) return parsed
      } catch {
        // Plain text that happens to start with '['.
      }
    }
    return content
  }

  if (content == null) return ''

  try {
    return JSON.stringify(content, null, 2)
  } catch {
    return String(content)
  }
}

function isIncomingContentArray(value: unknown): value is IncomingContent[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== 'object') return false
    const candidate = item as Record<string, unknown>
    return (
      (candidate.type === 'text' && typeof candidate.text === 'string') ||
      (candidate.type === 'image' && typeof candidate.url === 'string') ||
      (candidate.type === 'media' && typeof candidate.mediaId === 'string')
    )
  })
}

function shortenUrl(url: string): string {
  if (url.length <= 56) return url
  return `${url.slice(0, 34)}...${url.slice(-14)}`
}
