import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, Typography, message } from 'antd'
import { EditOutlined, PlusOutlined, ReloadOutlined, SafetyOutlined } from '@ant-design/icons'
import { bindingsApi, botsApi, contextsApi, wecomCommandConfigApi } from '../api/index.js'

interface BotOption {
  id: string
  name: string
}

interface ContextOption {
  id: string
  name: string
}

interface BindingOption {
  id: string
  chatKey: string
  chatName: string | null
  chatType: 'group' | 'user'
}

interface DiscoveredChat {
  chatKey: string
  chatType: 'group' | 'user'
  firstSeenAt: number
}

interface ChatReference {
  chatKey: string
  chatName: string | null
  chatType: 'group' | 'user'
  source: 'bound' | 'discovered'
}

interface WecomUser {
  id: string
  wecomUserId: string
  displayName: string | null
  role: 'user' | 'manager' | 'admin'
  status: 'active' | 'disabled'
  updatedAt: number
}

interface ContextGrant {
  id: string
  contextId: string
  wecomUserId: string
  accessLevel: 'use' | 'manage'
  status: 'active' | 'revoked'
  expiresAt: number | null
}

interface CommandPermission {
  id: string
  commandKey: string
  role: 'user' | 'manager' | 'admin'
  enabled: boolean
  requireConfirm: boolean
}

interface AuditLog {
  id: string
  action: string
  actorUserId: string | null
  targetType: string | null
  targetId: string | null
  result: 'success' | 'failure' | 'denied'
  reason: string | null
  createdAt: number
}

interface ModelConfig {
  id: string
  name: string
  provider: string
  modelName: string
  capability: string
  baseUrl: string | null
  apiKey: string | null
  defaultParams: Record<string, any>
  enabled: boolean
  timeoutMs: number | null
  quotaPerUserDaily: number | null
  maxConcurrent: number | null
}

const { Text } = Typography

const roleLabel: Record<WecomUser['role'], string> = {
  user: '普通用户',
  manager: '管理员',
  admin: '超级管理员',
}

const roleColor: Record<WecomUser['role'], string> = {
  user: 'default',
  manager: 'blue',
  admin: 'red',
}

const statusLabel: Record<WecomUser['status'] | ContextGrant['status'], string> = {
  active: '启用',
  disabled: '禁用',
  revoked: '已删除',
}

const accessLevelLabel: Record<ContextGrant['accessLevel'], string> = {
  use: '允许切换',
  manage: '允许切换与管理',
}

const auditResultLabel: Record<AuditLog['result'], string> = {
  success: '成功',
  failure: '失败',
  denied: '拒绝',
}

const commandLabel: Record<string, string> = {
  'ctx.current': '查看当前上下文',
  'ctx.list': '查看可切换上下文',
  'ctx.use': '切换上下文',
  'ctx.reset': '重置上下文',
  'image.generate': '生成图片',
  'task.status': '查询任务状态',
  'task.result': '获取任务结果',
  'admin.ctx.grant': '配置可切换上下文',
  'admin.ctx.revoke': '删除可切换上下文',
  'admin.user.upsert': '维护企微用户',
  'admin.command.set': '配置命令权限',
}

const roleOptions = Object.entries(roleLabel).map(([value, label]) => ({ label, value }))

const commandOptions = Object.entries(commandLabel).map(([value, label]) => ({
  label: `${label}（${value}）`,
  value,
}))

const statusOptions = [
  { label: '启用', value: 'active' },
  { label: '禁用', value: 'disabled' },
]

const accessLevelOptions = [
  { label: '允许切换', value: 'use' },
  { label: '允许切换与管理', value: 'manage' },
]

const selectFilter = (input: string, option?: { label?: unknown }) =>
  String(option?.label ?? '').toLowerCase().includes(input.trim().toLowerCase())

function buildWecomUserOptionLabel(user: WecomUser): string {
  return user.displayName ? `${user.displayName}（${user.wecomUserId}）` : user.wecomUserId
}

function inferWecomUserIdFromChatKey(chatKey: string): string | null {
  const prefix = 'wecom:user:'
  if (!chatKey.startsWith(prefix)) return null
  const userId = chatKey.slice(prefix.length).trim()
  return userId && userId !== 'unknown' ? userId : null
}

function mergeChatReferences(bindings: BindingOption[], discoveredChats: DiscoveredChat[]): ChatReference[] {
  const map = new Map<string, ChatReference>()
  for (const binding of bindings) {
    map.set(binding.chatKey, {
      chatKey: binding.chatKey,
      chatName: binding.chatName,
      chatType: binding.chatType,
      source: 'bound',
    })
  }
  for (const chat of discoveredChats) {
    if (!map.has(chat.chatKey)) {
      map.set(chat.chatKey, {
        chatKey: chat.chatKey,
        chatName: null,
        chatType: chat.chatType,
        source: 'discovered',
      })
    }
  }
  return [...map.values()].sort((left, right) => {
    if (left.chatType !== right.chatType) return left.chatType === 'user' ? -1 : 1
    if (left.source !== right.source) return left.source === 'bound' ? -1 : 1
    return left.chatKey.localeCompare(right.chatKey)
  })
}

export default function WecomCommandConfigPage() {
  const [bots, setBots] = useState<BotOption[]>([])
  const [botId, setBotId] = useState<string>()
  const [contexts, setContexts] = useState<ContextOption[]>([])
  const [users, setUsers] = useState<WecomUser[]>([])
  const [grants, setGrants] = useState<ContextGrant[]>([])
  const [permissions, setPermissions] = useState<CommandPermission[]>([])
  const [chatReferences, setChatReferences] = useState<ChatReference[]>([])
  const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(false)
  const [userModalOpen, setUserModalOpen] = useState(false)
  const [grantModalOpen, setGrantModalOpen] = useState(false)
  const [permissionModalOpen, setPermissionModalOpen] = useState(false)
  const [modelModalOpen, setModelModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<WecomUser | null>(null)
  const [editingPermission, setEditingPermission] = useState<CommandPermission | null>(null)
  const [editingModel, setEditingModel] = useState<ModelConfig | null>(null)
  const [userForm] = Form.useForm()
  const [grantForm] = Form.useForm()
  const [permissionForm] = Form.useForm()
  const [modelForm] = Form.useForm()

  const contextName = useMemo(() => new Map(contexts.map((context) => [context.id, context.name])), [contexts])
  const userById = useMemo(() => new Map(users.map((user) => [user.wecomUserId, user])), [users])
  const activeGrants = useMemo(() => grants.filter((grant) => grant.status === 'active'), [grants])
  const userSelectOptions = useMemo(
    () => users.map((user) => ({ label: buildWecomUserOptionLabel(user), value: user.wecomUserId })),
    [users],
  )
  const contextOptions = useMemo(
    () => contexts.map((context) => ({ label: `${context.name}（${context.id}）`, value: context.id })),
    [contexts],
  )
  const chatReferenceOptions = useMemo(
    () => chatReferences.map((chat) => {
      const inferredUserId = inferWecomUserIdFromChatKey(chat.chatKey)
      const chatTypeLabel = chat.chatType === 'user' ? '私聊' : '群聊'
      const sourceLabel = chat.source === 'bound' ? '已绑定' : '待绑定'
      const displayName = chat.chatName ? `${chat.chatName} / ` : ''
      const suffix = inferredUserId ? ` / 可带入 ${inferredUserId}` : ' / 仅作会话参考'
      return {
        label: `${chatTypeLabel} / ${sourceLabel} / ${displayName}${chat.chatKey}${suffix}`,
        value: chat.chatKey,
      }
    }),
    [chatReferences],
  )

  const loadBots = async () => {
    const data = await botsApi.list()
    setBots(data)
    if (!botId && data[0]) setBotId(data[0].id)
  }

  const loadConfig = async (currentBotId = botId) => {
    if (!currentBotId) return
    setLoading(true)
    try {
      const [contextData, userData, grantData, permissionData, auditData, modelData, bindingData, discoveredData] = await Promise.all([
        contextsApi.list(currentBotId),
        wecomCommandConfigApi.users(currentBotId),
        wecomCommandConfigApi.contextAccess(currentBotId),
        wecomCommandConfigApi.commandPermissions(currentBotId),
        wecomCommandConfigApi.auditLogs(currentBotId),
        wecomCommandConfigApi.modelConfigs(currentBotId, 'image_generation'),
        bindingsApi.list(currentBotId),
        bindingsApi.discovered(currentBotId),
      ])
      setContexts(contextData)
      setUsers(userData)
      setGrants(grantData)
      setPermissions(permissionData)
      setChatReferences(mergeChatReferences(bindingData, discoveredData))
      setAuditLogs(auditData)
      setModelConfigs(modelData)
    } catch (err: any) {
      message.error(err?.response?.data?.error ?? err?.message ?? '加载企微命令配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadBots() }, [])
  useEffect(() => { loadConfig(botId) }, [botId])

  const openUserModal = (user?: WecomUser) => {
    setEditingUser(user ?? null)
    userForm.resetFields()
    userForm.setFieldsValue(user
      ? {
          wecomUserId: user.wecomUserId,
          displayName: user.displayName,
          role: user.role,
          status: user.status,
        }
      : { role: 'user', status: 'active' })
    setUserModalOpen(true)
  }

  const openGrantModal = () => {
    grantForm.resetFields()
    grantForm.setFieldsValue({ accessLevel: 'use' })
    setGrantModalOpen(true)
  }

  const openPermissionModal = (permission?: CommandPermission) => {
    setEditingPermission(permission ?? null)
    permissionForm.resetFields()
    permissionForm.setFieldsValue(permission
      ? {
          commandKeys: [permission.commandKey],
          role: permission.role,
          enabled: permission.enabled,
          requireConfirm: permission.requireConfirm,
        }
      : { role: 'user', enabled: true, requireConfirm: false })
    setPermissionModalOpen(true)
  }

  const openModelModal = (model?: ModelConfig) => {
    setEditingModel(model ?? null)
    modelForm.resetFields()
    modelForm.setFieldsValue(model
      ? {
          name: model.name,
          provider: model.provider,
          modelName: model.modelName,
          baseUrl: model.baseUrl,
          apiKey: model.apiKey ?? undefined,
          timeoutMs: model.timeoutMs,
          quotaPerUserDaily: model.quotaPerUserDaily,
          maxConcurrent: model.maxConcurrent,
          defaultParams: JSON.stringify(model.defaultParams ?? {}, null, 2),
          enabled: model.enabled,
        }
      : {
          provider: 'openai-compatible-image',
          modelName: 'gpt-image2',
          enabled: true,
          timeoutMs: 120000,
        })
    setModelModalOpen(true)
  }

  const applyChatReferenceToUser = (chatKey: string) => {
    const userId = inferWecomUserIdFromChatKey(chatKey)
    if (!userId) {
      message.info('群聊 Chat Key 只能定位会话，不能反推出具体成员账号。请让成员私聊机器人，或从事件日志里的 from.userid 获取。')
      return
    }
    userForm.setFieldsValue({ wecomUserId: userId })
    message.success(`已从私聊 Chat Key 带入企微成员账号：${userId}`)
  }

  const saveUser = async (values: any) => {
    if (!botId) return
    try {
      const { chatKeyReference: _chatKeyReference, ...userValues } = values
      const payload = {
        ...userValues,
        displayName: userValues.displayName?.trim() || null,
      }
      if (editingUser) {
        await wecomCommandConfigApi.updateUser(botId, editingUser.wecomUserId, {
          displayName: payload.displayName,
          role: payload.role,
          status: payload.status,
        })
      } else {
        await wecomCommandConfigApi.saveUser(botId, payload)
      }
      userForm.resetFields()
      setUserModalOpen(false)
      setEditingUser(null)
      message.success(editingUser ? '企微用户已更新' : '企微用户已新增')
      loadConfig()
    } catch (err: any) {
      message.error(err?.response?.data?.error ?? '保存企微用户失败')
    }
  }

  const updateUserStatus = async (user: WecomUser, status: WecomUser['status']) => {
    if (!botId) return
    await wecomCommandConfigApi.updateUser(botId, user.wecomUserId, { status })
    message.success(status === 'active' ? '企微用户已启用' : '企微用户已禁用')
    loadConfig()
  }

  const deleteUser = async (user: WecomUser) => {
    if (!botId) return
    await wecomCommandConfigApi.deleteUser(botId, user.wecomUserId)
    message.success('企微用户已删除')
    loadConfig()
  }

  const grantContext = async (values: any) => {
    if (!botId) return
    try {
      const contextIds = Array.isArray(values.contextIds) ? values.contextIds : []
      await Promise.all(contextIds.map((contextId: string) => wecomCommandConfigApi.grantContext(botId, {
        wecomUserId: values.wecomUserId,
        contextId,
        accessLevel: values.accessLevel,
      })))
      grantForm.resetFields()
      setGrantModalOpen(false)
      message.success(`已保存 ${contextIds.length} 个可切换上下文`)
      loadConfig()
    } catch (err: any) {
      message.error(err?.response?.data?.error ?? '保存可切换上下文失败')
    }
  }

  const deleteContextAccess = async (grant: ContextGrant) => {
    if (!botId) return
    await wecomCommandConfigApi.deleteContextAccess(botId, grant.wecomUserId, grant.contextId)
    message.success('可切换上下文已删除')
    loadConfig()
  }

  const savePermission = async (values: any) => {
    if (!botId) return
    try {
      const commandKeys = Array.isArray(values.commandKeys) ? values.commandKeys : []
      await Promise.all(commandKeys.map((commandKey: string) => wecomCommandConfigApi.setCommandPermission(botId, {
        commandKey,
        role: values.role,
        enabled: values.enabled,
        requireConfirm: values.requireConfirm,
      })))
      permissionForm.resetFields()
      setPermissionModalOpen(false)
      setEditingPermission(null)
      message.success(`已保存 ${commandKeys.length} 条命令权限`)
      loadConfig()
    } catch (err: any) {
      message.error(err?.response?.data?.error ?? '保存命令权限失败')
    }
  }

  const deletePermission = async (permission: CommandPermission) => {
    if (!botId) return
    await wecomCommandConfigApi.deleteCommandPermission(botId, permission.id)
    message.success('命令权限配置已删除')
    loadConfig()
  }

  const saveModelConfig = async (values: any) => {
    if (!botId) return
    try {
      const defaultParams = values.defaultParams ? JSON.parse(values.defaultParams) : {}
      const payload = {
        ...values,
        capability: 'image_generation',
        provider: values.provider ?? 'openai-compatible-image',
        defaultParams,
      }
      if (!payload.apiKey) delete payload.apiKey
      if (editingModel) {
        await wecomCommandConfigApi.updateModelConfig(botId, editingModel.id, payload)
      } else {
        await wecomCommandConfigApi.createModelConfig(botId, payload)
      }
      modelForm.resetFields()
      setModelModalOpen(false)
      setEditingModel(null)
      message.success(editingModel ? '图片模型配置已更新' : '图片模型配置已新增')
      loadConfig()
    } catch (err: any) {
      message.error(err?.response?.data?.error ?? '保存图片模型配置失败，请检查默认参数 JSON')
    }
  }

  const deleteModelConfig = async (model: ModelConfig) => {
    if (!botId) return
    await wecomCommandConfigApi.deleteModelConfig(botId, model.id)
    message.success('图片模型配置已删除')
    loadConfig()
  }

  const renderWecomUser = (wecomUserId: string) => {
    const user = userById.get(wecomUserId)
    if (!user) return <Text>{wecomUserId}</Text>
    return (
      <Space direction="vertical" size={0}>
        <span>{user.displayName || user.wecomUserId}</span>
        {user.displayName && <Text type="secondary">{user.wecomUserId}</Text>}
      </Space>
    )
  }

  const renderCommand = (commandKey: string) => (
    <Space direction="vertical" size={0}>
      <span>{commandLabel[commandKey] ?? commandKey}</span>
      <Text type="secondary">{commandKey}</Text>
    </Space>
  )

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <Space>
          <SafetyOutlined />
          <h2 style={{ margin: 0 }}>企微命令与权限</h2>
        </Space>
        <Space>
          <Select
            showSearch
            style={{ width: 260 }}
            placeholder="选择机器人"
            value={botId}
            options={bots.map((bot) => ({ label: bot.name, value: bot.id }))}
            filterOption={selectFilter}
            onChange={setBotId}
          />
          <Button icon={<ReloadOutlined />} onClick={() => loadConfig()} loading={loading}>刷新</Button>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        message="这里控制企业微信内可用的命令、用户可切换的上下文和审计记录；群聊中切换上下文会对整个群立即生效。"
        style={{ marginBottom: 16 }}
      />

      <Tabs
        items={[
          {
            key: 'users',
            label: '企微用户',
            children: (
              <Card
                title="企微用户"
                loading={loading}
                extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openUserModal()}>新增用户</Button>}
              >
                <Table
                  rowKey="id"
                  loading={loading}
                  dataSource={users}
                  columns={[
                    { title: '企微用户ID', dataIndex: 'wecomUserId' },
                    { title: '姓名', dataIndex: 'displayName', render: (name: string | null) => name || '-' },
                    { title: '角色', dataIndex: 'role', render: (role: WecomUser['role']) => <Tag color={roleColor[role]}>{roleLabel[role]}</Tag> },
                    { title: '状态', dataIndex: 'status', render: (status: WecomUser['status']) => <Tag color={status === 'active' ? 'green' : 'default'}>{statusLabel[status]}</Tag> },
                    {
                      title: '操作',
                      render: (_: unknown, user: WecomUser) => (
                        <Space>
                          <Button size="small" icon={<EditOutlined />} onClick={() => openUserModal(user)}>编辑</Button>
                          <Button size="small" onClick={() => updateUserStatus(user, user.status === 'active' ? 'disabled' : 'active')}>
                            {user.status === 'active' ? '禁用' : '启用'}
                          </Button>
                          <Popconfirm
                            title="确认删除该企微用户？"
                            description="删除后会同步删除该用户可切换的上下文、当前激活上下文和待确认命令。历史任务和审计日志会保留。"
                            onConfirm={() => deleteUser(user)}
                          >
                            <Button size="small" danger>删除</Button>
                          </Popconfirm>
                        </Space>
                      ),
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'access',
            label: '可切换上下文',
            children: (
              <Card
                title="可切换上下文"
                loading={loading}
                extra={<Button type="primary" icon={<PlusOutlined />} onClick={openGrantModal}>新增可切换上下文</Button>}
              >
                <Table
                  rowKey="id"
                  loading={loading}
                  dataSource={activeGrants}
                  columns={[
                    { title: '企微用户', dataIndex: 'wecomUserId', render: renderWecomUser },
                    { title: '上下文', dataIndex: 'contextId', render: (id: string) => contextName.get(id) ?? id },
                    { title: '切换权限', dataIndex: 'accessLevel', render: (level: ContextGrant['accessLevel']) => <Tag color={level === 'manage' ? 'blue' : 'green'}>{accessLevelLabel[level]}</Tag> },
                    { title: '状态', dataIndex: 'status', render: (status: ContextGrant['status']) => <Tag color={status === 'active' ? 'green' : 'default'}>{statusLabel[status]}</Tag> },
                    {
                      title: '操作',
                      render: (_: unknown, grant: ContextGrant) => (
                        <Popconfirm title="确认删除该可切换上下文？" onConfirm={() => deleteContextAccess(grant)}>
                          <Button size="small" danger disabled={grant.status !== 'active'}>删除</Button>
                        </Popconfirm>
                      ),
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'commands',
            label: '命令权限',
            children: (
              <Card
                title="命令权限"
                loading={loading}
                extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openPermissionModal()}>批量配置权限</Button>}
              >
                <Table
                  rowKey="id"
                  loading={loading}
                  dataSource={permissions}
                  columns={[
                    { title: '命令', dataIndex: 'commandKey', render: renderCommand },
                    { title: '角色', dataIndex: 'role', render: (role: WecomUser['role']) => <Tag color={roleColor[role]}>{roleLabel[role]}</Tag> },
                    { title: '是否启用', dataIndex: 'enabled', render: (enabled: boolean) => <Tag color={enabled ? 'green' : 'default'}>{enabled ? '启用' : '禁用'}</Tag> },
                    { title: '二次确认', dataIndex: 'requireConfirm', render: (required: boolean) => required ? <Tag color="orange">需要确认</Tag> : <Tag>直接执行</Tag> },
                    {
                      title: '操作',
                      render: (_: unknown, permission: CommandPermission) => (
                        <Space>
                          <Button size="small" icon={<EditOutlined />} onClick={() => openPermissionModal(permission)}>编辑</Button>
                          <Popconfirm
                            title="确认删除该命令权限配置？"
                            description="删除后会回到系统默认权限；如果只是临时关闭，请改为禁用。"
                            onConfirm={() => deletePermission(permission)}
                          >
                            <Button size="small" danger>删除</Button>
                          </Popconfirm>
                        </Space>
                      ),
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'models',
            label: '图片模型',
            children: (
              <Card
                title="图片生成模型"
                loading={loading}
                extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openModelModal()}>新增模型</Button>}
              >
                <Table
                  rowKey="id"
                  loading={loading}
                  dataSource={modelConfigs}
                  columns={[
                    { title: '名称', dataIndex: 'name' },
                    { title: '模型', dataIndex: 'modelName' },
                    { title: '接口地址', dataIndex: 'baseUrl', render: (value: string | null) => value || '-' },
                    { title: '状态', dataIndex: 'enabled', render: (enabled: boolean) => <Tag color={enabled ? 'green' : 'default'}>{enabled ? '启用' : '禁用'}</Tag> },
                    { title: '每日额度', dataIndex: 'quotaPerUserDaily', render: (value: number | null) => value ?? '不限' },
                    { title: '并发数', dataIndex: 'maxConcurrent', render: (value: number | null) => value ?? '不限' },
                    {
                      title: '操作',
                      render: (_: unknown, model: ModelConfig) => (
                        <Space>
                          <Button size="small" icon={<EditOutlined />} onClick={() => openModelModal(model)}>编辑</Button>
                          <Popconfirm title="确认删除该图片模型配置？" onConfirm={() => deleteModelConfig(model)}>
                            <Button size="small" danger>删除</Button>
                          </Popconfirm>
                        </Space>
                      ),
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'audit',
            label: '审计日志',
            children: (
              <Table
                rowKey="id"
                loading={loading}
                dataSource={auditLogs}
                columns={[
                  { title: '时间', dataIndex: 'createdAt', render: (value: number) => new Date(value).toLocaleString() },
                  { title: '动作', dataIndex: 'action' },
                  { title: '操作者', dataIndex: 'actorUserId', render: (value: string | null) => value ? renderWecomUser(value) : '-' },
                  { title: '目标', render: (_: unknown, log: AuditLog) => [log.targetType, log.targetId].filter(Boolean).join(': ') || '-' },
                  { title: '结果', dataIndex: 'result', render: (result: AuditLog['result']) => <Tag color={result === 'success' ? 'green' : result === 'denied' ? 'red' : 'orange'}>{auditResultLabel[result]}</Tag> },
                  { title: '原因', dataIndex: 'reason', render: (value: string | null) => value || '-' },
                ]}
              />
            ),
          },
        ]}
      />

      <Modal
        title={editingUser ? '编辑企微用户' : '新增企微用户'}
        open={userModalOpen}
        width={560}
        onOk={() => userForm.submit()}
        onCancel={() => { setUserModalOpen(false); setEditingUser(null) }}
        destroyOnClose
      >
        <Form form={userForm} layout="vertical" onFinish={saveUser}>
          <Form.Item name="wecomUserId" label="企微用户ID" rules={[{ required: true, message: '请输入企微用户ID' }]}>
            <Input disabled={Boolean(editingUser)} placeholder="例如：zhangsan" />
          </Form.Item>
          {!editingUser && (
            <Form.Item
              name="chatKeyReference"
              label="从会话 Chat Key 参考"
              extra="私聊 Chat Key 形如 wecom:user:zhangsan，可自动带入成员账号；群聊 Chat Key 只能作为会话参考。"
            >
              <Select
                allowClear
                showSearch
                placeholder="选择已绑定或待绑定会话"
                options={chatReferenceOptions}
                filterOption={selectFilter}
                onChange={(value) => value && applyChatReferenceToUser(value)}
                notFoundContent="暂无可参考的会话，请先让成员向机器人发一条消息"
              />
            </Form.Item>
          )}
          <Form.Item name="displayName" label="姓名">
            <Input placeholder="用于后台搜索和识别" />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
            <Select options={roleOptions} />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
            <Select options={statusOptions} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="新增可切换上下文"
        open={grantModalOpen}
        width={560}
        onOk={() => grantForm.submit()}
        onCancel={() => setGrantModalOpen(false)}
        destroyOnClose
      >
        <Form form={grantForm} layout="vertical" onFinish={grantContext}>
          <Form.Item name="wecomUserId" label="企微用户" rules={[{ required: true, message: '请选择企微用户' }]}>
            <Select
              showSearch
              placeholder="按姓名或企微用户ID搜索"
              options={userSelectOptions}
              filterOption={selectFilter}
              notFoundContent="暂无企微用户，请先新增用户"
            />
          </Form.Item>
          <Form.Item
            name="contextIds"
            label="可切换上下文"
            rules={[{ required: true, message: '请选择至少一个上下文' }]}
            extra="可一次选择多个上下文；群聊中切换后会对整个群生效。"
          >
            <Select
              mode="multiple"
              allowClear
              showSearch
              placeholder="按上下文名称或ID搜索，可多选"
              options={contextOptions}
              filterOption={selectFilter}
            />
          </Form.Item>
          <Form.Item name="accessLevel" label="切换权限">
            <Select options={accessLevelOptions} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingPermission ? '编辑命令权限' : '批量配置命令权限'}
        open={permissionModalOpen}
        width={560}
        onOk={() => permissionForm.submit()}
        onCancel={() => { setPermissionModalOpen(false); setEditingPermission(null) }}
        destroyOnClose
      >
        <Form form={permissionForm} layout="vertical" onFinish={savePermission}>
          <Form.Item
            name="commandKeys"
            label="命令"
            rules={[{ required: true, message: '请选择至少一个命令' }]}
            extra="可一次选择多个命令，并为它们设置相同的角色、启用状态和二次确认策略。"
          >
            <Select
              mode="multiple"
              allowClear
              showSearch
              placeholder="搜索命令，可多选"
              options={commandOptions}
              filterOption={selectFilter}
            />
          </Form.Item>
          <Form.Item name="role" label="适用角色" rules={[{ required: true, message: '请选择角色' }]}>
            <Select options={roleOptions} />
          </Form.Item>
          <Form.Item name="enabled" label="是否启用" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
          <Form.Item name="requireConfirm" label="是否需要二次确认" valuePropName="checked">
            <Switch checkedChildren="需要确认" unCheckedChildren="直接执行" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingModel ? '编辑图片生成模型' : '新增图片生成模型'}
        open={modelModalOpen}
        width={720}
        onOk={() => modelForm.submit()}
        onCancel={() => { setModelModalOpen(false); setEditingModel(null) }}
        destroyOnClose
      >
        <Form form={modelForm} layout="vertical" onFinish={saveModelConfig}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}><Input /></Form.Item>
          <Form.Item name="modelName" label="模型名称" rules={[{ required: true, message: '请输入模型名称' }]}><Input /></Form.Item>
          <Form.Item name="baseUrl" label="接口地址" rules={[{ required: true, message: '请输入接口地址' }]}><Input /></Form.Item>
          <Form.Item
            name="apiKey"
            label="密钥"
            rules={editingModel ? [] : [{ required: true, message: '请输入密钥' }]}
            extra={editingModel ? '保留 ****** 或留空都表示不修改已有密钥。' : undefined}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item name="timeoutMs" label="超时时间（毫秒）"><Input type="number" /></Form.Item>
          <Form.Item name="quotaPerUserDaily" label="单用户每日额度"><Input type="number" placeholder="留空表示不限" /></Form.Item>
          <Form.Item name="maxConcurrent" label="最大并发数"><Input type="number" placeholder="留空表示不限" /></Form.Item>
          <Form.Item name="defaultParams" label="默认参数 JSON">
            <Input.TextArea rows={3} placeholder='{"size":"1024x1024"}' />
          </Form.Item>
          <Form.Item name="enabled" label="是否启用" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
