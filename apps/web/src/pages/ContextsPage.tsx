import { useEffect, useState } from 'react'
import {
  Alert, Button, Card, Divider, Form, Input, InputNumber, Modal, Popconfirm, Radio, Select,
  Space, Switch, Table, Tag, message,
} from 'antd'
import { ArrowLeftOutlined, PlusOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { botsApi, contextsApi, mcpServersApi, skillsApi, wikiApi } from '../api/index.js'

interface ParamSchemaItem { key: string; label: string; type: 'string' | 'string[]' | 'number' | 'boolean'; description?: string }
interface McpConfig { mcpServerId: string; enabled: boolean; params: Record<string, any>; forceCall?: boolean }
interface McpServer { id: string; name: string; url: string; transportType: string; enabled: boolean; paramSchema?: ParamSchemaItem[] }
interface SkillConfig { skillId: string; enabled: boolean; params: Record<string, any>; forceUse?: boolean }
interface SkillDefinition { id: string; name: string; description: string; enabled: boolean; resourceIndex?: { scripts?: string[] } }
interface WikiNamespace { name: string; displayName: string }
interface Bot { id: string; provider: 'openai-compatible' | 'anthropic' | 'dify' }
interface Context {
  id: string
  botId: string
  name: string
  systemPrompt: string
  mcpConfigs: McpConfig[]
  skillConfigs: SkillConfig[]
  sessionTtlMin: number
  isDefault: boolean
}

function isWikiMcp(server: McpServer): boolean {
  return `${server.name} ${server.url}`.toLowerCase().includes('wiki')
}

function policyLabel(policy: string | undefined, forceCall?: boolean) {
  if (policy === 'fixedPage') return '固定页面'
  if (policy === 'autoSearch' || forceCall) return '自动搜索'
  return '手动'
}

export default function ContextsPage() {
  const { botId } = useParams<{ botId: string }>()
  const navigate = useNavigate()
  const [contexts, setContexts] = useState<Context[]>([])
  const [mcpServers, setMcpServers] = useState<McpServer[]>([])
  const [skills, setSkills] = useState<SkillDefinition[]>([])
  const [wikiNamespaces, setWikiNamespaces] = useState<WikiNamespace[]>([])
  const [bot, setBot] = useState<Bot | null>(null)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editCtx, setEditCtx] = useState<Context | null>(null)
  const [formMcpConfigs, setFormMcpConfigs] = useState<McpConfig[]>([])
  const [formSkillConfigs, setFormSkillConfigs] = useState<SkillConfig[]>([])
  const [skillParamDrafts, setSkillParamDrafts] = useState<Record<string, string>>({})
  const [form] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try {
      const [ctxList, mcpList, skillList, botData, wikiNsList] = await Promise.all([
        contextsApi.list(botId!),
        mcpServersApi.list(),
        skillsApi.list(),
        botsApi.get(botId!),
        wikiApi.listNamespaces().catch(() => []),
      ])
      setContexts(ctxList)
      setMcpServers(mcpList)
      setSkills(skillList)
      setBot(botData)
      setWikiNamespaces(wikiNsList)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [botId])

  const openModal = (ctx: Context | null) => {
    setEditCtx(ctx)
    if (ctx) {
      form.setFieldsValue({
        name: ctx.name,
        systemPrompt: ctx.systemPrompt,
        sessionTtlMin: ctx.sessionTtlMin,
        isDefault: ctx.isDefault,
      })
      setFormMcpConfigs(ctx.mcpConfigs ?? [])
    } else {
      form.resetFields()
      setFormMcpConfigs(mcpServers.map((server) => ({ mcpServerId: server.id, enabled: false, params: {} })))
    }

    const initialSkillConfigs = skills.map((skill) => {
      const existing = ctx?.skillConfigs?.find((cfg) => cfg.skillId === skill.id)
      return existing ?? { skillId: skill.id, enabled: false, params: {}, forceUse: false }
    })
    setFormSkillConfigs(initialSkillConfigs)
    setSkillParamDrafts(Object.fromEntries(initialSkillConfigs.map((cfg) => [cfg.skillId, JSON.stringify(cfg.params ?? {}, null, 2)])))
    setModalOpen(true)
  }

  const updateMcpConfig = (mcpServerId: string, updater: (cfg: McpConfig) => McpConfig) => {
    setFormMcpConfigs((prev) => {
      const existing = prev.find((cfg) => cfg.mcpServerId === mcpServerId)
      if (existing) return prev.map((cfg) => cfg.mcpServerId === mcpServerId ? updater(cfg) : cfg)
      return [...prev, updater({ mcpServerId, enabled: false, params: {} })]
    })
  }

  const getMcpConfig = (mcpServerId: string): McpConfig =>
    formMcpConfigs.find((cfg) => cfg.mcpServerId === mcpServerId) ?? { mcpServerId, enabled: false, params: {} }

  const setMcpParam = (mcpServerId: string, key: string, value: any) => {
    updateMcpConfig(mcpServerId, (cfg) => ({ ...cfg, params: { ...cfg.params, [key]: value } }))
  }

  const setWikiPolicy = (mcpServerId: string, policy: 'manual' | 'autoSearch' | 'fixedPage') => {
    updateMcpConfig(mcpServerId, (cfg) => ({ ...cfg, forceCall: policy !== 'manual', params: { ...cfg.params, retrievalPolicy: policy } }))
  }

  const updateSkillConfig = (skillId: string, updater: (cfg: SkillConfig) => SkillConfig) => {
    setFormSkillConfigs((prev) => {
      const existing = prev.find((cfg) => cfg.skillId === skillId)
      if (existing) return prev.map((cfg) => cfg.skillId === skillId ? updater(cfg) : cfg)
      return [...prev, updater({ skillId, enabled: false, params: {} })]
    })
  }

  const getSkillConfig = (skillId: string): SkillConfig =>
    formSkillConfigs.find((cfg) => cfg.skillId === skillId) ?? { skillId, enabled: false, params: {} }

  const buildSkillConfigsForSubmit = (): SkillConfig[] => {
    return formSkillConfigs.map((cfg) => {
      const raw = skillParamDrafts[cfg.skillId] ?? '{}'
      try {
        const params = raw.trim() ? JSON.parse(raw) : {}
        if (!params || Array.isArray(params) || typeof params !== 'object') throw new Error('params must be an object')
        return { ...cfg, params }
      } catch {
        const skill = skills.find((item) => item.id === cfg.skillId)
        throw new Error(`${skill?.name ?? cfg.skillId} 的参数不是合法 JSON 对象`)
      }
    })
  }

  const handleSave = async (values: any) => {
    try {
      const payload = { ...values, mcpConfigs: formMcpConfigs, skillConfigs: buildSkillConfigsForSubmit() }
      if (editCtx) {
        await contextsApi.update(botId!, editCtx.id, payload)
        message.success('已更新')
      } else {
        await contextsApi.create(botId!, payload)
        message.success('已创建')
      }
      setModalOpen(false)
      setEditCtx(null)
      form.resetFields()
      load()
    } catch (err: any) {
      message.error(err?.response?.data?.error ?? err?.message ?? '保存失败')
    }
  }

  const handleDelete = async (id: string) => {
    await contextsApi.delete(botId!, id)
    message.success('已删除')
    load()
  }

  const renderParamInput = (server: McpServer, cfg: McpConfig, item: ParamSchemaItem) => {
    const value = cfg.params[item.key]
    const commonProps = { style: { marginBottom: 8 }, extra: item.description }
    if (item.type === 'string[]') {
      return <Form.Item key={item.key} label={item.label} {...commonProps}><Select mode="tags" value={value ?? []} onChange={(v) => setMcpParam(server.id, item.key, v)} /></Form.Item>
    }
    if (item.type === 'number') {
      return <Form.Item key={item.key} label={item.label} {...commonProps}><InputNumber value={value} onChange={(v) => setMcpParam(server.id, item.key, v)} /></Form.Item>
    }
    if (item.type === 'boolean') {
      return <Form.Item key={item.key} label={item.label} {...commonProps}><Switch checked={Boolean(value)} onChange={(v) => setMcpParam(server.id, item.key, v)} /></Form.Item>
    }
    return <Form.Item key={item.key} label={item.label} {...commonProps}><Input value={value ?? ''} onChange={(event) => setMcpParam(server.id, item.key, event.target.value)} /></Form.Item>
  }

  const renderWikiConfig = (server: McpServer, cfg: McpConfig) => {
    const policy = cfg.params?.retrievalPolicy ?? (cfg.params?.forceCallPage ? 'fixedPage' : cfg.forceCall ? 'autoSearch' : 'manual')
    const standardKeys = new Set(['namespace', 'retrievalPolicy', 'forceCallPage', 'maxChars', 'crossNs'])
    const advancedParams = (server.paramSchema ?? []).filter((item) => !standardKeys.has(item.key))
    return (
      <>
        <Alert
          type="info"
          showIcon
          message="Wiki 知识库配置"
          description="常规场景只需要选择知识库空间和检索策略；高级参数会保留在 MCP 参数中。"
          style={{ marginBottom: 12 }}
        />
        {!server.enabled && (
          <Alert
            type="warning"
            showIcon
            message="该 wiki-mcp 在全局 MCP 服务器中未启用，机器人运行时不会加载它。"
            action={<Button size="small" onClick={() => navigate('/mcp-servers')}>去启用</Button>}
            style={{ marginBottom: 12 }}
          />
        )}
        <Form.Item label="知识库空间" style={{ marginBottom: 8 }}>
          <Select
            value={cfg.params?.namespace}
            placeholder="选择 Wiki 知识库空间"
            options={wikiNamespaces.map((ns) => ({ label: `${ns.displayName} (${ns.name})`, value: ns.name }))}
            onChange={(value) => setMcpParam(server.id, 'namespace', value)}
          />
        </Form.Item>
        <Form.Item label="检索策略" style={{ marginBottom: 8 }}>
          <Radio.Group value={policy} onChange={(event) => setWikiPolicy(server.id, event.target.value)}>
            <Radio.Button value="manual">手动工具调用</Radio.Button>
            <Radio.Button value="autoSearch">按问题自动搜索</Radio.Button>
            <Radio.Button value="fixedPage">固定页面注入</Radio.Button>
          </Radio.Group>
        </Form.Item>
        {policy === 'autoSearch' && (
          <Form.Item label="跨知识库空间搜索" style={{ marginBottom: 8 }}>
            <Switch checked={Boolean(cfg.params?.crossNs)} onChange={(value) => setMcpParam(server.id, 'crossNs', value)} />
          </Form.Item>
        )}
        {policy === 'fixedPage' && (
          <>
            <Form.Item label="固定页面路径" style={{ marginBottom: 8 }}>
              <Input value={cfg.params?.forceCallPage ?? ''} onChange={(event) => setMcpParam(server.id, 'forceCallPage', event.target.value)} placeholder="制度/服务规范.md" />
            </Form.Item>
            <Form.Item label="最大注入字符数" style={{ marginBottom: 8 }}>
              <InputNumber min={500} max={50000} value={cfg.params?.maxChars ?? 6000} onChange={(value) => setMcpParam(server.id, 'maxChars', value)} />
            </Form.Item>
          </>
        )}
        {advancedParams.length > 0 && (
          <>
            <Divider orientation="left" style={{ fontSize: 12 }}>高级参数</Divider>
            {advancedParams.map((item) => renderParamInput(server, cfg, item))}
          </>
        )}
      </>
    )
  }

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    {
      title: 'MCP 能力',
      dataIndex: 'mcpConfigs',
      key: 'mcpConfigs',
      render: (cfgs: McpConfig[] = []) => {
        const enabled = cfgs.filter((cfg) => cfg.enabled)
        if (enabled.length === 0) return <Tag>无工具</Tag>
        return enabled.map((cfg) => {
          const server = mcpServers.find((item) => item.id === cfg.mcpServerId)
          return (
            <Tag key={cfg.mcpServerId} color={server && isWikiMcp(server) ? 'geekblue' : 'blue'}>
              {server?.name ?? cfg.mcpServerId}
              {server && isWikiMcp(server) ? ` / ${policyLabel(cfg.params?.retrievalPolicy, cfg.forceCall)}` : ''}
            </Tag>
          )
        })
      },
    },
    {
      title: '技能包',
      dataIndex: 'skillConfigs',
      key: 'skillConfigs',
      render: (cfgs: SkillConfig[] = []) => {
        const enabled = cfgs.filter((cfg) => cfg.enabled)
        if (enabled.length === 0) return <Tag>无技能包</Tag>
        return enabled.map((cfg) => {
          const skill = skills.find((item) => item.id === cfg.skillId)
          return <Tag key={cfg.skillId} color="purple">{skill?.name ?? cfg.skillId}</Tag>
        })
      },
    },
    { title: '会话超时(分)', dataIndex: 'sessionTtlMin', key: 'sessionTtlMin' },
    { title: '默认', dataIndex: 'isDefault', key: 'isDefault', render: (v: boolean) => v ? <Tag color="blue">默认</Tag> : null },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, ctx: Context) => (
        <Space>
          <Button size="small" onClick={() => openModal(ctx)}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(ctx.id)}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/bots')} />
          <h2 style={{ margin: 0 }}>上下文配置</h2>
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal(null)}>新建上下文</Button>
      </div>

      <Table dataSource={contexts} columns={columns} rowKey="id" loading={loading} />

      <Modal
        title={editCtx ? '编辑上下文' : '新建上下文'}
        open={modalOpen}
        width={760}
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
            <Alert type="info" message="该机器人使用 Dify 工作流，知识库检索和工具调用由 Dify 内部处理" showIcon style={{ marginBottom: 16 }} />
          ) : mcpServers.length === 0 ? (
            <Alert type="info" message="尚未配置全局 MCP 服务器" description="请先在左侧「MCP 服务器」中添加全局 MCP 服务器，再配置上下文能力。" showIcon style={{ marginBottom: 16 }} />
          ) : (
            mcpServers.map((server) => {
              const cfg = getMcpConfig(server.id)
              return (
                <Card key={server.id} size="small" style={{ marginBottom: 8 }}
                  title={
                    <Space>
                      <Switch size="small" checked={cfg.enabled} onChange={(value) => updateMcpConfig(server.id, (current) => ({ ...current, enabled: value }))} />
                      <span style={{ fontWeight: 500 }}>{server.name}</span>
                      <Tag style={{ fontSize: 11 }}>{server.transportType}</Tag>
                      {cfg.enabled && cfg.params?.namespace && <Tag color="blue" style={{ fontSize: 11 }}>知识库：{cfg.params.namespace}</Tag>}
                    </Space>
                  }
                >
                  {cfg.enabled && (
                    isWikiMcp(server) ? renderWikiConfig(server, cfg) : (
                      <>
                        <Form.Item label="强制调用" style={{ marginBottom: 8 }} extra="每条消息处理前先调用该 MCP 工具并注入检索结果">
                          <Switch checked={Boolean(cfg.forceCall)} onChange={(value) => updateMcpConfig(server.id, (current) => ({ ...current, forceCall: value }))} />
                        </Form.Item>
                        {(server.paramSchema ?? []).map((item) => renderParamInput(server, cfg, item))}
                      </>
                    )
                  )}
                </Card>
              )
            })
          )}

          <Divider orientation="left" style={{ fontSize: 13 }}>技能包能力配置</Divider>
          {bot?.provider === 'dify' ? (
            <Alert type="info" message="该机器人使用 Dify 工作流，本地技能包与 MCP 工具不会注入运行时" showIcon style={{ marginBottom: 16 }} />
          ) : skills.length === 0 ? (
            <Alert type="info" message="尚未安装全局技能包" description="先到左侧「技能包」上传包含 SKILL.md 的文件夹，再回来为上下文启用。" action={<Button size="small" onClick={() => navigate('/skills')}>去上传</Button>} showIcon style={{ marginBottom: 16 }} />
          ) : (
            skills.map((skill) => {
              const cfg = getSkillConfig(skill.id)
              const scripts = skill.resourceIndex?.scripts ?? []
              return (
                <Card key={skill.id} size="small" style={{ marginBottom: 8 }}
                  title={
                    <Space>
                      <Switch size="small" checked={cfg.enabled} onChange={(value) => updateSkillConfig(skill.id, (current) => ({ ...current, enabled: value }))} />
                      <span style={{ fontWeight: 500 }}>{skill.name}</span>
                      {scripts.length > 0 && <Tag color="cyan">scripts {scripts.length}</Tag>}
                    </Space>
                  }
                >
                  <div style={{ color: '#666', marginBottom: cfg.enabled ? 12 : 0 }}>{skill.description}</div>
                  {cfg.enabled && (
                    <>
                      <Form.Item label="强制加载 SKILL.md" style={{ marginBottom: 8 }} extra="开启后即使用户未显式提到该技能包，也会把 SKILL.md 注入本次上下文">
                        <Switch checked={Boolean(cfg.forceUse)} onChange={(value) => updateSkillConfig(skill.id, (current) => ({ ...current, forceUse: value }))} />
                      </Form.Item>
                      <Form.Item label="参数 JSON" style={{ marginBottom: 0 }}>
                        <Input.TextArea
                          rows={3}
                          value={skillParamDrafts[skill.id] ?? '{}'}
                          onChange={(event) => setSkillParamDrafts((prev) => ({ ...prev, [skill.id]: event.target.value }))}
                          placeholder='{"key":"value"}'
                        />
                      </Form.Item>
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
