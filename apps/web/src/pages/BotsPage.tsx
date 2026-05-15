import { useEffect, useState } from 'react'
import { Table, Button, Space, Tag, Modal, Form, Input, Select, Switch, message, Popconfirm } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { botsApi } from '../api/index.js'

type BotStatus = 'running' | 'stopped' | 'error'
type BotProvider = 'openai-compatible' | 'anthropic' | 'dify'
type StreamingMode = 'none' | 'progressive' | 'typewriter'

interface Bot {
  id: string; name: string; status: BotStatus; wecomBotId: string; llmModel: string
  provider: BotProvider; streamingMode: StreamingMode; visionEnabled: boolean
  difyBaseUrl?: string | null; difyApiKey?: string | null; difyAppId?: string | null
}

const STATUS_COLOR: Record<BotStatus, string> = { running: 'green', stopped: 'default', error: 'red' }
const STATUS_LABEL: Record<BotStatus, string> = { running: '运行中', stopped: '已停止', error: '错误' }

export default function BotsPage() {
  const [bots, setBots] = useState<Bot[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editBot, setEditBot] = useState<Bot | null>(null)
  const [form] = Form.useForm()
  const navigate = useNavigate()

  const load = async () => {
    setLoading(true)
    try { setBots(await botsApi.list()) } finally { setLoading(false) }
  }

  useEffect(() => {
    load()
    const token = localStorage.getItem('token')
    const es = new EventSource(`/api/bots/events?token=${token}`)
    es.onmessage = (e) => {
      const event = JSON.parse(e.data)
      if (event.type === 'bot_status') {
        setBots((prev) => prev.map((b) => b.id === event.botId ? { ...b, status: event.status } : b))
      }
    }
    return () => es.close()
  }, [])

  const handleStartStop = async (bot: Bot) => {
    try {
      if (bot.status === 'running') {
        await botsApi.stop(bot.id)
        message.success('已停止')
      } else {
        await botsApi.start(bot.id)
        message.success('已启动')
      }
      load()
    } catch (err: any) {
      message.error(err?.response?.data?.error ?? '操作失败')
    }
  }

  const handleSave = async (values: any) => {
    try {
      if (editBot) {
        await botsApi.update(editBot.id, values)
        message.success('已更新')
      } else {
        await botsApi.create(values)
        message.success('已创建')
      }
      setModalOpen(false)
      form.resetFields()
      setEditBot(null)
      load()
    } catch {
      message.error('保存失败')
    }
  }

  const handleDelete = async (id: string) => {
    await botsApi.delete(id)
    message.success('已删除')
    load()
  }

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '机器人ID', dataIndex: 'wecomBotId', key: 'wecomBotId' },
    {
      title: '模型/Provider', key: 'provider',
      render: (_: any, bot: Bot) => bot.provider === 'dify'
        ? <Tag color="purple">Dify</Tag>
        : <span>{bot.llmModel}</span>
    },
    {
      title: '流式回复', dataIndex: 'streamingMode', key: 'streamingMode',
      render: (m: StreamingMode) => m === 'none' ? null : <Tag color="blue">{m}</Tag>
    },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (s: BotStatus) => <Tag color={STATUS_COLOR[s]}>{STATUS_LABEL[s]}</Tag>
    },
    {
      title: '操作', key: 'actions',
      render: (_: any, bot: Bot) => (
        <Space>
          <Button size="small" type={bot.status === 'running' ? 'default' : 'primary'}
            onClick={() => handleStartStop(bot)}>
            {bot.status === 'running' ? '停止' : '启动'}
          </Button>
          <Button size="small" onClick={() => navigate(`/bots/${bot.id}/contexts`)}>上下文</Button>
          <Button size="small" onClick={() => navigate(`/bots/${bot.id}/bindings`)}>绑定</Button>
          <Button size="small" onClick={() => { setEditBot(bot); form.setFieldsValue(bot); setModalOpen(true) }}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(bot.id)}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      )
    },
  ]

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>机器人管理</h2>
        <Button type="primary" icon={<PlusOutlined />}
          onClick={() => { setEditBot(null); form.resetFields(); setModalOpen(true) }}>
          新建机器人
        </Button>
      </div>
      <Table dataSource={bots} columns={columns} rowKey="id" loading={loading} />
      <Modal title={editBot ? '编辑机器人' : '新建机器人'} open={modalOpen} width={600}
        onOk={() => form.submit()} onCancel={() => { setModalOpen(false); setEditBot(null) }}>
        <BotForm form={form} onFinish={handleSave} />
      </Modal>
    </div>
  )
}

function BotForm({ form, onFinish }: { form: any; onFinish: (v: any) => void }) {
  const provider = Form.useWatch('provider', form) ?? 'openai-compatible'
  const isDify = provider === 'dify'

  return (
    <Form form={form} onFinish={onFinish} layout="vertical"
      initialValues={{ provider: 'openai-compatible', streamingMode: 'none', visionEnabled: false }}>
      <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
      <Form.Item name="wecomBotId" label="企业微信 Bot ID" rules={[{ required: true }]}><Input /></Form.Item>
      <Form.Item name="wecomBotSecret" label="Bot Secret" rules={[{ required: true }]}><Input.Password /></Form.Item>
      <Form.Item name="wecomWsUrl" label="WebSocket URL" initialValue="wss://openws.work.weixin.qq.com"
        extra="企业微信官方固定地址，通常无需修改" rules={[{ required: true }]}>
        <Input />
      </Form.Item>
      <Form.Item name="provider" label="LLM Provider" rules={[{ required: true }]}>
        <Select options={[
          { label: 'OpenAI 兼容（MiniMax / DeepSeek / Qwen 等）', value: 'openai-compatible' },
          { label: 'Anthropic (Claude)', value: 'anthropic' },
          { label: 'Dify 工作流', value: 'dify' },
        ]} />
      </Form.Item>
      {!isDify && (
        <>
          <Form.Item name="llmApiKey" label="LLM API Key" rules={[{ required: true }]}><Input.Password /></Form.Item>
          <Form.Item name="llmBaseUrl" label="LLM Base URL" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="llmModel" label="模型名称" initialValue="MiniMax-M2.5" rules={[{ required: true }]}><Input /></Form.Item>
        </>
      )}
      {isDify && (
        <>
          <Form.Item name="difyBaseUrl" label="Dify Base URL" rules={[{ required: true }]}
            extra="例如：https://api.dify.ai"><Input /></Form.Item>
          <Form.Item name="difyApiKey" label="Dify API Key" rules={[{ required: true }]}><Input.Password /></Form.Item>
          <Form.Item name="difyAppId" label="Dify App ID（可选）"><Input /></Form.Item>
          <Form.Item name="llmApiKey" hidden initialValue=""><Input /></Form.Item>
          <Form.Item name="llmBaseUrl" hidden initialValue=""><Input /></Form.Item>
          <Form.Item name="llmModel" hidden initialValue="dify"><Input /></Form.Item>
        </>
      )}
      <Form.Item name="streamingMode" label="流式回复模式">
        <Select options={[
          { label: '关闭（等待完整回复后发送）', value: 'none' },
          { label: 'Progressive（替换思考中消息）', value: 'progressive' },
          { label: 'Typewriter（逐字打字机效果）', value: 'typewriter' },
        ]} />
      </Form.Item>
      <Form.Item name="visionEnabled" label="启用视觉模式" valuePropName="checked"
        extra="需要视觉模型支持（GPT-4o、Claude 3 等），开启后图片消息将传给 LLM">
        <Switch />
      </Form.Item>
    </Form>
  )
}
