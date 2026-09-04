import { useEffect, useState } from 'react'
import { Table, Button, Space, Modal, Form, Input, Select, message, Popconfirm, Card, Tag, Tooltip, Switch, Alert } from 'antd'
import { PlusOutlined, ArrowLeftOutlined, ReloadOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { useParams, useNavigate } from 'react-router-dom'
import { bindingsApi, contextsApi } from '../api/index.js'

interface Binding { id: string; chatKey: string; chatName: string | null; chatType: string; contextId: string }
interface Context { id: string; name: string; isDefault?: boolean }
interface DiscoveredChat { chatKey: string; chatType: 'group' | 'user'; firstSeenAt: number; accessStatus?: 'allowed' | 'needs-binding' }

export default function BindingsPage() {
  const { botId } = useParams<{ botId: string }>()
  const navigate = useNavigate()
  const [bindings, setBindings] = useState<Binding[]>([])
  const [contexts, setContexts] = useState<Context[]>([])
  const [discovered, setDiscovered] = useState<DiscoveredChat[]>([])
  const [allowUnboundAccess, setAllowUnboundAccess] = useState(true)
  const [policySaving, setPolicySaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingBinding, setEditingBinding] = useState<Binding | null>(null)
  const [form] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try {
      const [b, c, d, settings] = await Promise.all([
        bindingsApi.list(botId!),
        contextsApi.list(botId!),
        bindingsApi.discovered(botId!),
        bindingsApi.settings(botId!),
      ])
      setBindings(b); setContexts(c); setDiscovered(d); setAllowUnboundAccess(settings.allowUnboundAccess !== false)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [botId])

  const handlePolicyChange = async (checked: boolean) => {
    setPolicySaving(true)
    try {
      const settings = await bindingsApi.updateSettings(botId!, { allowUnboundAccess: checked })
      setAllowUnboundAccess(settings.allowUnboundAccess !== false)
      message.success('未绑定访问策略已更新')
      await load()
    } catch (err: any) {
      message.error(err?.response?.data?.error ?? '更新访问策略失败')
    } finally { setPolicySaving(false) }
  }

  const handleSave = async (values: any) => {
    try {
      if (editingBinding) {
        await bindingsApi.update(botId!, editingBinding.id, {
          chatName: values.chatName,
          chatType: values.chatType,
          contextId: values.contextId,
        })
        message.success('已更新')
      } else {
        await bindingsApi.create(botId!, values)
        message.success('绑定成功')
      }
      setModalOpen(false); setEditingBinding(null); form.resetFields(); load()
    } catch { message.error('保存失败') }
  }

  const handleDelete = async (id: string) => {
    await bindingsApi.delete(botId!, id)
    message.success('已删除'); load()
  }

  // Pre-fill form from a discovered chat
  const handleBindDiscovered = (chat: DiscoveredChat) => {
    setEditingBinding(null)
    form.setFieldsValue({ chatKey: chat.chatKey, chatType: chat.chatType, chatName: '' })
    setModalOpen(true)
  }

  const handleEdit = (binding: Binding) => {
    setEditingBinding(binding)
    form.setFieldsValue({
      chatKey: binding.chatKey,
      chatName: binding.chatName ?? '',
      chatType: binding.chatType,
      contextId: binding.contextId,
    })
    setModalOpen(true)
  }

  const contextName = (id: string) => contexts.find((c) => c.id === id)?.name ?? id

  const bindingColumns = [
    { title: '显示名称', dataIndex: 'chatName', key: 'chatName', render: (v: string | null) => v ?? '-' },
    { title: 'Chat Key', dataIndex: 'chatKey', key: 'chatKey', render: (v: string) => <code style={{ fontSize: 12 }}>{v}</code> },
    { title: '类型', dataIndex: 'chatType', key: 'chatType', render: (v: string) => <Tag>{v === 'group' ? '群聊' : '私聊'}</Tag> },
    { title: '绑定上下文', dataIndex: 'contextId', key: 'contextId', render: contextName },
    {
      title: '操作', key: 'actions',
      render: (_: any, b: Binding) => (
        <Space>
          <Button size="small" onClick={() => handleEdit(b)}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(b.id)}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      )
    },
  ]

  const discoveredColumns = [
    {
      title: 'Chat Key', dataIndex: 'chatKey', key: 'chatKey',
      render: (v: string) => <code style={{ fontSize: 12 }}>{v}</code>
    },
    {
      title: '类型', dataIndex: 'chatType', key: 'chatType',
      render: (v: string) => <Tag color={v === 'group' ? 'blue' : 'purple'}>{v === 'group' ? '群聊' : '私聊'}</Tag>
    },
    {
      title: '访问状态', dataIndex: 'accessStatus', key: 'accessStatus',
      render: (v: string) => <Tag color={v === 'allowed' ? 'green' : 'orange'}>{v === 'allowed' ? '已放行' : '需要绑定'}</Tag>
    },
    {
      title: '首次发现', dataIndex: 'firstSeenAt', key: 'firstSeenAt',
      render: (t: number) => new Date(t).toLocaleString()
    },
    {
      title: '操作', key: 'actions',
      render: (_: any, chat: DiscoveredChat) => (
        <Button size="small" type="primary" onClick={() => handleBindDiscovered(chat)}>
          绑定
        </Button>
      )
    },
  ]

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/bots')} />
          <h2 style={{ margin: 0 }}>绑定管理</h2>
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingBinding(null); form.resetFields(); setModalOpen(true) }}>
            手动新建绑定
          </Button>
        </Space>
      </div>

      <Card title="未绑定会话访问" size="small" style={{ marginBottom: 16 }}>
        <Space align="start">
          <Switch checked={allowUnboundAccess} loading={policySaving} onChange={handlePolicyChange} />
          <div>
            <div>{allowUnboundAccess ? '允许所有未绑定私聊和群聊访问' : '未绑定会话必须先绑定上下文'}</div>
            <div style={{ color: '#888', fontSize: 12 }}>允许访问时使用机器人的默认上下文；静态绑定和运行时上下文优先。</div>
          </div>
        </Space>
        {!contexts.some((context) => (context as any).isDefault) && allowUnboundAccess && (
          <Alert type="warning" showIcon message="当前没有默认上下文，未绑定会话仍无法访问。" style={{ marginTop: 12 }} />
        )}
      </Card>

      {/* Discovered chats — waiting to be bound */}
      {discovered.length > 0 && (
        <Card
          title={
            <Space>
              <span>待绑定会话</span>
              <Tag color="orange">{discovered.length}</Tag>
              <Tooltip title="这些群/用户向机器人发过消息，但尚未绑定上下文。点击「绑定」为其分配上下文。">
                <QuestionCircleOutlined style={{ color: '#999' }} />
              </Tooltip>
            </Space>
          }
          style={{ marginBottom: 16 }}
          size="small"
        >
          <Table
            dataSource={discovered}
            columns={discoveredColumns}
            rowKey="chatKey"
            pagination={false}
            size="small"
          />
        </Card>
      )}

      {/* Existing bindings */}
      <Card title="已绑定会话" size="small">
        <Table dataSource={bindings} columns={bindingColumns} rowKey="id" loading={loading} size="small" />
      </Card>

      <Modal
        title={editingBinding ? '编辑绑定' : '新建绑定'}
        open={modalOpen}
        onOk={() => form.submit()}
        onCancel={() => { setModalOpen(false); setEditingBinding(null); form.resetFields() }}
      >
        <Form form={form} onFinish={handleSave} layout="vertical">
          <Form.Item name="chatKey" label="Chat Key" rules={[{ required: true }]}
            extra={editingBinding ? 'Chat Key 是绑定身份，编辑时不可修改' : '群聊或用户的唯一标识，从「待绑定会话」点击绑定时自动填入'}>
            <Input disabled={Boolean(editingBinding)} placeholder="wecom:group:xxx 或 wecom:user:xxx" />
          </Form.Item>
          <Form.Item name="chatName" label="显示名称" extra="便于识别，例如「库存异常群」">
            <Input placeholder="可选" />
          </Form.Item>
          <Form.Item name="chatType" label="类型" initialValue="group" rules={[{ required: true }]}>
            <Select options={[{ label: '群聊', value: 'group' }, { label: '私聊', value: 'user' }]} />
          </Form.Item>
          <Form.Item name="contextId" label="绑定上下文" rules={[{ required: true }]}>
            <Select
              options={contexts.map((c) => ({ label: c.name, value: c.id }))}
              placeholder="选择该会话使用的上下文"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
