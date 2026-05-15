import { useEffect, useState } from 'react'
import { Table, Button, Space, Tag, Modal, Form, Input, InputNumber, Switch, message, Popconfirm, Card, Divider, Select, Alert } from 'antd'
import { PlusOutlined, ArrowLeftOutlined } from '@ant-design/icons'
import { useParams, useNavigate } from 'react-router-dom'
import { contextsApi, mcpServersApi, botsApi } from '../api/index.js'

interface ParamSchemaItem { key: string; label: string; type: 'string' | 'string[]' | 'number' | 'boolean'; description?: string }
interface McpConfig { mcpServerId: string; enabled: boolean; params: Record<string, any>; forceCall?: boolean }
interface McpServer { id: string; name: string; url: string; transportType: string; enabled: boolean; paramSchema?: ParamSchemaItem[] }
interface Bot { id: string; provider: 'openai-compatible' | 'anthropic' | 'dify' }
interface Context {
  id: string; botId: string; name: string; systemPrompt: string
  mcpConfigs: McpConfig[]; sessionTtlMin: number; isDefault: boolean
}

export default function ContextsPage() {
  const { botId } = useParams<{ botId: string }>()
  const navigate = useNavigate()
  const [contexts, setContexts] = useState<Context[]>([])
  const [mcpServers, setMcpServers] = useState<McpServer[]>([])
  const [bot, setBot] = useState<Bot | null>(null)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editCtx, setEditCtx] = useState<Context | null>(null)
  // Local state for MCP configs in the form (not using Form.Item for complex nested state)
  const [formMcpConfigs, setFormMcpConfigs] = useState<McpConfig[]>([])
  const [form] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try {
      const [ctxList, mcpList, botData] = await Promise.all([
        contextsApi.list(botId!),
        mcpServersApi.list(botId!),
        botsApi.get(botId!),
      ])
      setContexts(ctxList)
      setMcpServers(mcpList)
      setBot(botData)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [botId])

  const openModal = (ctx: Context | null) => {
    setEditCtx(ctx)
    if (ctx) {
      form.setFieldsValue({ name: ctx.name, systemPrompt: ctx.systemPrompt, sessionTtlMin: ctx.sessionTtlMin, isDefault: ctx.isDefault })
      setFormMcpConfigs(ctx.mcpConfigs ?? [])
    } else {
      form.resetFields()
      // Initialize mcpConfigs with all bot's MCP servers disabled
      setFormMcpConfigs(mcpServers.map((s) => ({ mcpServerId: s.id, enabled: false, params: {} })))
    }
    setModalOpen(true)
  }

  const handleSave = async (values: any) => {
    try {
      const payload = { ...values, mcpConfigs: formMcpConfigs }
      if (editCtx) {
        await contextsApi.update(botId!, editCtx.id, payload)
        message.success('已更新')
      } else {
        await contextsApi.create(botId!, payload)
        message.success('已创建')
      }
      setModalOpen(false); form.resetFields(); setEditCtx(null); load()
    } catch (err: any) {
      message.error(err?.response?.data?.error ?? '保存失败')
    }
  }

  const handleDelete = async (id: string) => {
    await contextsApi.delete(botId!, id)
    message.success('已删除'); load()
  }

  const updateMcpConfig = (mcpServerId: string, updater: (cfg: McpConfig) => McpConfig) => {
    setFormMcpConfigs((prev) => {
      const existing = prev.find((c) => c.mcpServerId === mcpServerId)
      if (existing) return prev.map((c) => c.mcpServerId === mcpServerId ? updater(c) : c)
      return [...prev, updater({ mcpServerId, enabled: false, params: {} })]
    })
  }

  const toggleMcp = (mcpServerId: string, enabled: boolean) => {
    updateMcpConfig(mcpServerId, (cfg) => ({ ...cfg, enabled }))
  }

  const setMcpParam = (mcpServerId: string, key: string, value: any) => {
    updateMcpConfig(mcpServerId, (cfg) => ({ ...cfg, params: { ...cfg.params, [key]: value } }))
  }

  const setForceCall = (mcpServerId: string, forceCall: boolean) => {
    updateMcpConfig(mcpServerId, (cfg) => ({ ...cfg, forceCall }))
  }

  const getMcpConfig = (mcpServerId: string): McpConfig =>
    formMcpConfigs.find((c) => c.mcpServerId === mcpServerId) ?? { mcpServerId, enabled: false, params: {} }

  const renderParamInput = (server: McpServer, cfg: McpConfig, item: ParamSchemaItem) => {
    const value = cfg.params[item.key]
    const commonProps = { style: { marginBottom: 8 }, extra: item.description }
    if (item.type === 'string[]') {
      return <Form.Item key={item.key} label={item.label} {...commonProps}>
        <Select mode="tags" value={value ?? []} onChange={(v) => setMcpParam(server.id, item.key, v)} />
      </Form.Item>
    }
    if (item.type === 'number') {
      return <Form.Item key={item.key} label={item.label} {...commonProps}>
        <InputNumber value={value} onChange={(v) => setMcpParam(server.id, item.key, v)} />
      </Form.Item>
    }
    if (item.type === 'boolean') {
      return <Form.Item key={item.key} label={item.label} {...commonProps}>
        <Switch checked={Boolean(value)} onChange={(v) => setMcpParam(server.id, item.key, v)} />
      </Form.Item>
    }
    return <Form.Item key={item.key} label={item.label} {...commonProps}>
      <Input value={value ?? ''} onChange={(e) => setMcpParam(server.id, item.key, e.target.value)} />
    </Form.Item>
  }

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    {
      title: 'MCP 能力', dataIndex: 'mcpConfigs', key: 'mcpConfigs',
      render: (cfgs: McpConfig[]) => {
        const enabled = cfgs.filter((c) => c.enabled)
        if (enabled.length === 0) return <Tag>无工具</Tag>
        return enabled.map((c) => {
          const server = mcpServers.find((s) => s.id === c.mcpServerId)
          return <Tag key={c.mcpServerId} color="blue">{server?.name ?? c.mcpServerId}</Tag>
        })
      }
    },
    { title: '会话超时(分)', dataIndex: 'sessionTtlMin', key: 'sessionTtlMin' },
    {
      title: '默认', dataIndex: 'isDefault', key: 'isDefault',
      render: (v: boolean) => v ? <Tag color="blue">默认</Tag> : null
    },
    {
      title: '操作', key: 'actions',
      render: (_: any, ctx: Context) => (
        <Space>
          <Button size="small" onClick={() => openModal(ctx)}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(ctx.id)}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      )
    },
  ]

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/bots')} />
          <h2 style={{ margin: 0 }}>上下文配置</h2>
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal(null)}>
          新建上下文
        </Button>
      </div>
      <Table dataSource={contexts} columns={columns} rowKey="id" loading={loading} />
      <Modal
        title={editCtx ? '编辑上下文' : '新建上下文'}
        open={modalOpen}
        width={720}
        onOk={() => form.submit()}
        onCancel={() => { setModalOpen(false); setEditCtx(null) }}
      >
        <Form form={form} onFinish={handleSave} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="systemPrompt" label="系统提示词" rules={[{ required: true }]}>
            <Input.TextArea rows={8} placeholder="输入系统提示词（支持 Markdown）" />
          </Form.Item>

          <Divider orientation="left" style={{ fontSize: 13 }}>MCP 能力配置</Divider>
          {bot?.provider === 'dify' ? (
            <Alert
              type="info"
              message="该 Bot 使用 Dify 工作流，知识库检索和工具调用由 Dify 内部处理"
              showIcon
              style={{ marginBottom: 16 }}
            />
          ) : mcpServers.length === 0 ? (
            <Alert
              type="info"
              message="该机器人尚未配置 MCP 服务器"
              description="请先在「MCP服务器」管理页添加 MCP 服务器，再配置上下文能力。"
              showIcon
              style={{ marginBottom: 16 }}
            />
          ) : (
            mcpServers.map((server) => {
              const cfg = getMcpConfig(server.id)
              return (
                <Card key={server.id} size="small" style={{ marginBottom: 8 }}
                  title={
                    <Space>
                      <Switch
                        size="small"
                        checked={cfg.enabled}
                        onChange={(v) => toggleMcp(server.id, v)}
                      />
                      <span style={{ fontWeight: 500 }}>{server.name}</span>
                      <Tag style={{ fontSize: 11 }}>{server.transportType}</Tag>
                    </Space>
                  }
                >
                  {cfg.enabled && (
                    <>
                      <Form.Item label="强制调用" style={{ marginBottom: 8 }} extra="每条消息处理前先调用该 MCP 工具并注入检索结果">
                        <Switch checked={Boolean(cfg.forceCall)} onChange={(v) => setForceCall(server.id, v)} />
                      </Form.Item>
                      {(server.paramSchema ?? []).map((item) => renderParamInput(server, cfg, item))}
                    </>
                  )}
                </Card>
              )
            })
          )}

          <Form.Item name="sessionTtlMin" label="会话超时（分钟）" initialValue={30}>
            <InputNumber min={1} max={1440} />
          </Form.Item>
          <Form.Item name="isDefault" label="设为默认上下文" valuePropName="checked" initialValue={false}>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
