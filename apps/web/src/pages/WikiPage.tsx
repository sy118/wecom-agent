import { useEffect, useMemo, useState } from 'react'
import {
  Alert, Button, Card, Col, Descriptions, Divider, Empty, Form, Input, InputNumber, List, Modal,
  Popconfirm, Radio, Row, Select, Space, Statistic, Steps, Tabs, Tag, Tree, Typography, Upload, message,
} from 'antd'
import {
  ApiOutlined, BookOutlined, CheckCircleOutlined, CloudSyncOutlined, DeleteOutlined, ExperimentOutlined,
  FileMarkdownOutlined, FolderOutlined, LinkOutlined, PlusOutlined, SearchOutlined, UploadOutlined,
} from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import { useNavigate } from 'react-router-dom'
import { botsApi, contextsApi, mcpServersApi, wikiApi } from '../api/index.js'

const { Paragraph, Text, Title } = Typography

type RetrievalPolicy = 'manual' | 'autoSearch' | 'fixedPage'
type HealthStatus = 'ok' | 'warning' | 'error' | 'unknown'

interface WikiNamespace {
  id: string
  name: string
  displayName: string
  path: string
  description: string | null
  gitEnabled: boolean
  autoCompile: boolean
  createdAt: number
}

interface FileNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  updatedAt?: number
  children?: FileNode[]
}

interface WikiFile {
  path: string
  content: string
  size: number
  updatedAt: number
}

interface SearchResult {
  path: string
  title: string
  excerpt: string
  size: number
  updatedAt: number
}

interface WikiBinding {
  botId: string
  botName: string
  contextId: string
  contextName: string
  mcpServerId: string
  mcpServerName: string
  policy: RetrievalPolicy
  params: Record<string, unknown>
}

interface WikiDraft {
  id: string
  namespace: string
  targetPath: string
  content: string
  sourceType: string
  sourceRef: string | null
  status: 'pending' | 'merged' | 'rejected'
  reviewReason: string | null
  createdAt: number
}

interface McpServer { id: string; name: string; url: string; transportType: string; enabled: boolean; paramSchema?: unknown[] }
interface Bot { id: string; name: string; provider: string }
interface Context { id: string; name: string }

function isWikiMcpServer(server: McpServer): boolean {
  const haystack = `${server.name} ${server.url}`.toLowerCase()
  return haystack.includes('wiki-mcp') || haystack.includes('/wiki') || haystack.includes(':3001')
}

function policyLabel(policy: RetrievalPolicy | string) {
  if (policy === 'autoSearch') return '按问题自动搜索'
  if (policy === 'fixedPage') return '固定页面注入'
  return '手动工具调用'
}

function healthColor(status: HealthStatus) {
  if (status === 'ok') return 'green'
  if (status === 'warning') return 'gold'
  if (status === 'error') return 'red'
  return 'default'
}

function formatTime(value?: number | null) {
  return value ? new Date(value).toLocaleString() : '暂无'
}

function fileNodesToTreeData(nodes: FileNode[], onDelete: (path: string) => void): DataNode[] {
  return nodes.map((node) => ({
    key: node.path,
    title: node.type === 'file' ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span>{node.name}</span>
        <Popconfirm title="确认删除此文件？" onConfirm={(event) => { event?.stopPropagation(); onDelete(node.path) }}>
          <Button
            size="small"
            danger
            type="text"
            icon={<DeleteOutlined />}
            style={{ padding: '0 2px', height: 18, lineHeight: '18px' }}
            onClick={(event) => event.stopPropagation()}
          />
        </Popconfirm>
      </span>
    ) : node.name,
    icon: node.type === 'dir' ? <FolderOutlined /> : <FileMarkdownOutlined />,
    isLeaf: node.type === 'file',
    children: node.children ? fileNodesToTreeData(node.children, onDelete) : undefined,
  }))
}

function countFiles(nodes: FileNode[]): number {
  return nodes.reduce((sum, node) => sum + (node.type === 'file' ? 1 : countFiles(node.children ?? [])), 0)
}

export default function WikiPage() {
  const navigate = useNavigate()
  const [namespaces, setNamespaces] = useState<WikiNamespace[]>([])
  const [selected, setSelected] = useState<WikiNamespace | null>(null)
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [selectedFile, setSelectedFile] = useState<WikiFile | null>(null)
  const [health, setHealth] = useState<any>(null)
  const [namespaceHealth, setNamespaceHealth] = useState<any>(null)
  const [bindings, setBindings] = useState<WikiBinding[]>([])
  const [drafts, setDrafts] = useState<WikiDraft[]>([])
  const [mcpServers, setMcpServers] = useState<McpServer[]>([])
  const [bots, setBots] = useState<Bot[]>([])
  const [allBindingCount, setAllBindingCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [treeLoading, setTreeLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState(0)
  const [bindOpen, setBindOpen] = useState(false)
  const [bindContexts, setBindContexts] = useState<Context[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchAttempted, setSearchAttempted] = useState(false)
  const [testQuery, setTestQuery] = useState('')
  const [testResults, setTestResults] = useState<SearchResult[]>([])
  const [testPreview, setTestPreview] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('documents')
  const [createForm] = Form.useForm()
  const [wizardForm] = Form.useForm()
  const [bindForm] = Form.useForm()
  const [draftForm] = Form.useForm()

  const wikiMcp = useMemo(() => mcpServers.find((server) => server.enabled && isWikiMcpServer(server)), [mcpServers])
  const wikiMcpCandidate = useMemo(() => mcpServers.find(isWikiMcpServer), [mcpServers])
  const shouldShowWizard = namespaces.length === 0 || !wikiMcp || allBindingCount === 0

  const refreshAll = async () => {
    setLoading(true)
    try {
      const [nsList, healthData, mcpList, botList] = await Promise.all([
        wikiApi.listNamespaces(),
        wikiApi.health(),
        mcpServersApi.list(),
        botsApi.list(),
      ])
      setNamespaces(nsList)
      setHealth(healthData)
      setMcpServers(mcpList)
      setBots(botList)
      const summaries = await Promise.all(nsList.map((ns: WikiNamespace) => wikiApi.bindings(ns.name).catch(() => [])))
      setAllBindingCount(summaries.reduce((sum, item) => sum + item.length, 0))
    } finally {
      setLoading(false)
    }
  }

  const refreshNamespace = async (ns: WikiNamespace) => {
    setTreeLoading(true)
    try {
      const [tree, nsHealth, bindingList, draftList] = await Promise.all([
        wikiApi.listFiles(ns.name),
        wikiApi.namespaceHealth(ns.name),
        wikiApi.bindings(ns.name),
        wikiApi.listDrafts(ns.name),
      ])
      setFileTree(tree)
      setNamespaceHealth(nsHealth)
      setBindings(bindingList)
      setDrafts(draftList)
    } finally {
      setTreeLoading(false)
    }
  }

  useEffect(() => { refreshAll() }, [])

  const handleSelectNamespace = (ns: WikiNamespace) => {
    setSelected(ns)
    setSelectedFile(null)
    setSearchResults([])
    setSearchAttempted(false)
    setTestResults([])
    setTestPreview(null)
    setActiveTab('documents')
    refreshNamespace(ns)
  }

  const handleCreate = async (values: { name: string; display_name: string; path: string; description?: string }) => {
    try {
      const ns = await wikiApi.createNamespace(values)
      message.success('Namespace 已创建')
      setCreateOpen(false)
      createForm.resetFields()
      await refreshAll()
      handleSelectNamespace(ns)
    } catch (err: any) {
      message.error(err?.response?.data?.error ?? '创建失败')
    }
  }

  const handleDeleteNamespace = async (ns: WikiNamespace) => {
    await wikiApi.deleteNamespace(ns.id)
    message.success('已删除，磁盘文件保留')
    if (selected?.id === ns.id) {
      setSelected(null)
      setFileTree([])
      setSelectedFile(null)
    }
    refreshAll()
  }

  const handleGitPull = async () => {
    try {
      const result = await wikiApi.gitPull()
      message.success(result.message)
      refreshAll()
      if (selected) refreshNamespace(selected)
    } catch {
      message.error('Git Pull 失败')
    }
  }

  const handleUpload = async (file: File) => {
    if (!selected) return false
    const fd = new FormData()
    fd.append('files', file)
    try {
      const result = await wikiApi.uploadFiles(selected.name, fd)
      message.success(`已上传 ${result.uploaded.length} 个文件`)
      setSearchAttempted(false)
      refreshNamespace(selected)
    } catch {
      message.error('上传失败')
    }
    return false
  }

  const handleDeleteFile = async (filePath: string) => {
    if (!selected) return
    try {
      await wikiApi.deleteFile(selected.name, filePath)
      message.success('文件已删除')
      if (selectedFile?.path === filePath) setSelectedFile(null)
      refreshNamespace(selected)
    } catch {
      message.error('删除失败')
    }
  }

  const handleFileSelect = async (keys: React.Key[]) => {
    if (!selected || keys.length === 0) return
    const filePath = String(keys[0])
    if (!filePath.endsWith('.md')) return
    try {
      setSelectedFile(await wikiApi.getFile(selected.name, filePath))
    } catch {
      message.error('读取文件失败')
    }
  }

  const handleSearch = async (query = searchQuery) => {
    if (!selected || !query.trim()) return
    const result = await wikiApi.search(selected.name, query)
    setSearchAttempted(true)
    setSearchResults(result.results ?? [])
    refreshNamespace(selected)
  }

  const handleTestSearch = async () => {
    if (!selected) return
    const fixedPageBinding = bindings.find((binding) => {
      const path = binding.params.forceCallPage
      return binding.policy === 'fixedPage' && typeof path === 'string' && path.trim()
    })
    if (fixedPageBinding) {
      try {
        const path = String(fixedPageBinding.params.forceCallPage)
        const maxChars = Number(fixedPageBinding.params.maxChars ?? 6000)
        const file = await wikiApi.getFile(selected.name, path)
        setTestResults([])
        setTestPreview(String(file.content ?? '').slice(0, maxChars))
        refreshNamespace(selected)
      } catch (err: any) {
        message.error(err?.response?.data?.error ?? '固定页面读取失败')
      }
      return
    }
    if (!testQuery.trim()) return
    const result = await wikiApi.search(selected.name, testQuery)
    setTestResults(result.results ?? [])
    setTestPreview(null)
    refreshNamespace(selected)
  }

  const handleBindBotChange = async (botId: string) => {
    bindForm.setFieldsValue({ contextId: undefined })
    setBindContexts(await contextsApi.list(botId))
  }

  const openBind = () => {
    if (!wikiMcp) {
      message.warning('请先启用 wiki-mcp，再绑定 Context')
      return
    }
    setBindOpen(true)
    setBindContexts([])
    bindForm.resetFields()
    bindForm.setFieldsValue({ policy: 'autoSearch', mcpServerId: wikiMcp?.id })
  }

  const handleBind = async (values: any) => {
    if (!selected) return
    try {
      await wikiApi.bindContext(selected.name, values)
      message.success('绑定已保存')
      setBindOpen(false)
      refreshAll()
      refreshNamespace(selected)
    } catch (err: any) {
      message.error(err?.response?.data?.error ?? '绑定失败')
    }
  }

  const handleUnbind = async (binding: WikiBinding) => {
    if (!selected) return
    await wikiApi.unbindContext(selected.name, binding.contextId)
    message.success('已解绑')
    refreshAll()
    refreshNamespace(selected)
  }

  const registerWikiMcp = async () => {
    const recommendedParamSchema = [
      { key: 'namespace', label: 'Wiki Namespace', type: 'string', description: '要查询的 Wiki namespace' },
      { key: 'retrievalPolicy', label: '检索策略', type: 'string', description: 'manual / autoSearch / fixedPage' },
      { key: 'forceCallPage', label: '固定页面', type: 'string', description: 'fixedPage 策略使用' },
      { key: 'maxChars', label: '最大字符数', type: 'number', description: '固定页面注入截断长度' },
      { key: 'crossNs', label: '跨 namespace', type: 'boolean', description: 'autoSearch 是否跨 namespace' },
    ]
    const created = wikiMcpCandidate ? await mcpServersApi.update(wikiMcpCandidate.id, {
      enabled: true,
      paramSchema: wikiMcpCandidate.paramSchema?.length ? wikiMcpCandidate.paramSchema : recommendedParamSchema,
    }) : await mcpServersApi.create({
      name: 'wiki-mcp',
      url: 'http://localhost:3001/sse',
      transportType: 'sse',
      enabled: true,
      paramSchema: recommendedParamSchema,
    })
    message.success(wikiMcpCandidate ? 'wiki-mcp 已启用' : 'wiki-mcp 已注册')
    await refreshAll()
    return created
  }

  const runWizardPrimary = async () => {
    if (wizardStep === 0) {
      const values = await wizardForm.validateFields(['name', 'display_name', 'path', 'description'])
      const ns = await wikiApi.createNamespace(values)
      setSelected(ns)
      await refreshAll()
      await refreshNamespace(ns)
      setWizardStep(1)
      return
    }
    if (wizardStep === 1) {
      if (!wikiMcp) await registerWikiMcp()
      setWizardStep(2)
      return
    }
    if (wizardStep === 2) {
      const values = await wizardForm.validateFields(['botId', 'contextId', 'policy', 'forceCallPage', 'maxChars'])
      const targetNs = selected ?? namespaces[0]
      if (!targetNs) return
      const targetMcp = wikiMcp ?? await registerWikiMcp()
      await wikiApi.bindContext(targetNs.name, { ...values, mcpServerId: targetMcp.id })
      await refreshAll()
      await refreshNamespace(targetNs)
      setWizardStep(3)
      return
    }
    if (wizardStep === 3) {
      const values = wizardForm.getFieldsValue(['policy', 'forceCallPage', 'maxChars', 'testQuery'])
      const targetNs = selected ?? namespaces[0]
      if (targetNs) {
        if (values.policy === 'fixedPage' && values.forceCallPage) {
          const file = await wikiApi.getFile(targetNs.name, values.forceCallPage)
          setTestResults([])
          setTestPreview(String(file.content ?? '').slice(0, Number(values.maxChars ?? 6000)))
        } else {
          await wizardForm.validateFields(['testQuery'])
          const result = await wikiApi.search(targetNs.name, values.testQuery)
          setTestResults(result.results ?? [])
          setTestPreview(null)
        }
      }
      setWizardOpen(false)
      setWizardStep(0)
    }
  }

  const handleCreateDraft = async (values: any) => {
    if (!selected) return
    await wikiApi.createDraft(selected.name, { ...values, sourceType: 'manual' })
    message.success('草稿已创建')
    draftForm.resetFields()
    refreshNamespace(selected)
  }

  const approveDraft = async (draft: WikiDraft) => {
    if (!selected) return
    try {
      await wikiApi.approveDraft(selected.name, draft.id)
      message.success('草稿已合并')
      refreshNamespace(selected)
    } catch (err: any) {
      message.error(err?.response?.data?.error ?? '合并失败')
    }
  }

  const rejectDraft = async (draft: WikiDraft) => {
    if (!selected) return
    await wikiApi.rejectDraft(selected.name, draft.id, { reason: '管理员拒绝' })
    message.success('草稿已拒绝')
    refreshNamespace(selected)
  }

  const renderHealthItems = () => {
    const items = health?.items ?? {}
    return (
      <Row gutter={[12, 12]}>
        {Object.entries(items).map(([key, value]: [string, any]) => (
          <Col key={key} xs={24} md={12} xl={8}>
            <Card size="small">
              <Space direction="vertical" size={2}>
                <Text strong>{key}</Text>
                <Tag color={healthColor(value.status)}>{value.status}</Tag>
                <Text type="secondary" style={{ fontSize: 12 }}>{value.message}</Text>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>
    )
  }

  const documentsTab = (
    <Row gutter={16}>
      <Col xs={24} xl={9}>
        <Card
          size="small"
          title="文档树"
          extra={
            <Space>
              <Upload beforeUpload={handleUpload} showUploadList={false} multiple accept=".md">
                <Button icon={<UploadOutlined />} size="small">上传</Button>
              </Upload>
              <Button size="small" onClick={() => selected && refreshNamespace(selected)}>刷新</Button>
            </Space>
          }
        >
          {treeLoading ? (
            <Text type="secondary">加载中...</Text>
          ) : fileTree.length === 0 ? (
            <Empty description="暂无 Markdown 文件" />
          ) : (
            <Tree showIcon defaultExpandAll treeData={fileNodesToTreeData(fileTree, handleDeleteFile)} onSelect={handleFileSelect} />
          )}
        </Card>
      </Col>
      <Col xs={24} xl={15}>
        <Card size="small" title="搜索与预览">
          <Input.Search
            allowClear
            placeholder="搜索文件名或正文"
            enterButton={<SearchOutlined />}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onSearch={handleSearch}
            style={{ marginBottom: 12 }}
          />
          {searchResults.length > 0 && (
            <List
              size="small"
              dataSource={searchResults}
              style={{ marginBottom: 16 }}
              renderItem={(item) => (
                <List.Item onClick={() => handleFileSelect([item.path])} style={{ cursor: 'pointer' }}>
                  <List.Item.Meta title={<Space><FileMarkdownOutlined />{item.title}<Tag>{item.path}</Tag></Space>} description={item.excerpt || '匹配文件名'} />
                </List.Item>
              )}
            />
          )}
          {searchAttempted && searchResults.length === 0 && (
            <Empty description="没有找到匹配文档" style={{ marginBottom: 16 }}>
              <Space>
                <Upload beforeUpload={handleUpload} showUploadList={false} multiple accept=".md">
                  <Button icon={<UploadOutlined />}>上传文档</Button>
                </Upload>
                <Button onClick={() => setActiveTab('drafts')}>新建草稿</Button>
              </Space>
            </Empty>
          )}
          {selectedFile ? (
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              <Descriptions size="small" column={2}>
                <Descriptions.Item label="路径">{selectedFile.path}</Descriptions.Item>
                <Descriptions.Item label="大小">{selectedFile.size} bytes</Descriptions.Item>
                <Descriptions.Item label="最近修改">{formatTime(selectedFile.updatedAt)}</Descriptions.Item>
              </Descriptions>
              <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 16, maxHeight: 520, overflow: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                {selectedFile.content}
              </div>
            </Space>
          ) : (
            <Empty description="选择一个 Markdown 文件查看预览" />
          )}
        </Card>
      </Col>
    </Row>
  )

  const bindingTab = (
    <Card size="small" title="绑定到 Bot/Context" extra={<Button type="primary" icon={<LinkOutlined />} onClick={openBind}>新增绑定</Button>}>
      {bindings.length === 0 ? (
        <Alert type="warning" showIcon message="此 namespace 尚未绑定任何 Context" />
      ) : (
        <List
          dataSource={bindings}
          renderItem={(item) => (
            <List.Item actions={[<Button key="unbind" size="small" danger onClick={() => handleUnbind(item)}>解绑</Button>]}>
              <List.Item.Meta
                title={<Space>{item.botName}<Tag>{item.contextName}</Tag><Tag color="blue">{policyLabel(item.policy)}</Tag></Space>}
                description={`MCP: ${item.mcpServerName}`}
              />
            </List.Item>
          )}
        />
      )}
    </Card>
  )

  const healthTab = (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Row gutter={16}>
        <Col xs={24} md={6}><Card><Statistic title="文件数" value={namespaceHealth?.fileCount ?? countFiles(fileTree)} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="绑定数" value={namespaceHealth?.bindingCount ?? bindings.length} /></Card></Col>
        <Col xs={24} md={12}><Card><Statistic title="最近修改" value={formatTime(namespaceHealth?.latestModifiedAt)} /></Card></Col>
      </Row>
      <Card size="small" title="测试检索" extra={<Button icon={<ExperimentOutlined />} onClick={handleTestSearch}>测试</Button>}>
        <Input value={testQuery} onChange={(event) => setTestQuery(event.target.value)} placeholder="输入一个业务问题" style={{ marginBottom: 12 }} />
        {testPreview ? (
          <Paragraph style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto', marginBottom: 0 }}>{testPreview}</Paragraph>
        ) : testResults.length > 0 ? (
          <List size="small" dataSource={testResults} renderItem={(item) => <List.Item><List.Item.Meta title={`${item.title} (${item.path})`} description={item.excerpt} /></List.Item>} />
        ) : (
          <Text type="secondary">自动搜索会展示命中摘要；固定页面策略会展示读取预览。</Text>
        )}
      </Card>
      <Card size="small" title="全局健康状态">{renderHealthItems()}</Card>
    </Space>
  )

  const draftsTab = (
    <Row gutter={16}>
      <Col xs={24} xl={9}>
        <Card size="small" title="新建草稿">
          <Form form={draftForm} layout="vertical" onFinish={handleCreateDraft}>
            <Form.Item name="targetPath" label="建议页面" rules={[{ required: true }]}>
              <Input placeholder="faq/refund.md" />
            </Form.Item>
            <Form.Item name="content" label="Markdown 内容" rules={[{ required: true }]}>
              <Input.TextArea rows={8} />
            </Form.Item>
            <Form.Item name="sourceRef" label="来源引用">
              <Input placeholder="会话、任务或备注" />
            </Form.Item>
            <Button type="primary" htmlType="submit">保存草稿</Button>
          </Form>
        </Card>
      </Col>
      <Col xs={24} xl={15}>
        <Card size="small" title="待审核知识">
          {drafts.length === 0 ? <Empty description="暂无草稿" /> : (
            <List
              dataSource={drafts}
              renderItem={(draft) => (
                <List.Item
                  actions={draft.status === 'pending' ? [
                    <Button key="approve" size="small" type="primary" onClick={() => approveDraft(draft)}>合并</Button>,
                    <Button key="reject" size="small" danger onClick={() => rejectDraft(draft)}>拒绝</Button>,
                  ] : [<Tag key="status">{draft.status}</Tag>]}
                >
                  <List.Item.Meta
                    title={<Space>{draft.targetPath}<Tag color={draft.status === 'pending' ? 'gold' : draft.status === 'merged' ? 'green' : 'red'}>{draft.status}</Tag></Space>}
                    description={
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <Text type="secondary">来源：{draft.sourceType}{draft.sourceRef ? ` / ${draft.sourceRef}` : ''}</Text>
                        <Paragraph ellipsis={{ rows: 4, expandable: true }}>{draft.content}</Paragraph>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </Card>
      </Col>
    </Row>
  )

  return (
    <div style={{ padding: 24 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}><BookOutlined style={{ marginRight: 8 }} />Wiki 知识库</Title>
        <Space>
          <Button icon={<CloudSyncOutlined />} onClick={handleGitPull}>同步最新</Button>
          <Button icon={<CheckCircleOutlined />} onClick={() => setWizardOpen(true)}>使用向导</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建 Namespace</Button>
        </Space>
      </Row>

      {shouldShowWizard && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Wiki 尚未完成完整配置"
          description="按向导完成 namespace、wiki-mcp、Context 绑定和测试检索后，Bot 才能稳定使用知识库。"
          action={<Button size="small" onClick={() => setWizardOpen(true)}>开始向导</Button>}
        />
      )}

      <Row gutter={16}>
        <Col xs={24} xl={7}>
          <Card title="Namespace" loading={loading}>
            <Space direction="vertical" style={{ width: '100%' }}>
              {namespaces.map((ns) => (
                <Card
                  key={ns.id}
                  size="small"
                  hoverable
                  style={{ borderColor: selected?.id === ns.id ? '#1677ff' : undefined }}
                  onClick={() => handleSelectNamespace(ns)}
                  extra={
                    <Popconfirm title="确认删除？磁盘文件会保留" onConfirm={(event) => { event?.stopPropagation(); handleDeleteNamespace(ns) }}>
                      <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={(event) => event.stopPropagation()} />
                    </Popconfirm>
                  }
                >
                  <Card.Meta
                    title={<Space>{ns.displayName}<Tag>{ns.name}</Tag></Space>}
                    description={<Space direction="vertical" size={2}><Text type="secondary">{ns.path}</Text>{ns.description && <Text type="secondary">{ns.description}</Text>}</Space>}
                  />
                </Card>
              ))}
              {namespaces.length === 0 && <Empty description="暂无 Namespace" />}
            </Space>
          </Card>
        </Col>

        <Col xs={24} xl={17}>
          {selected ? (
            <Space direction="vertical" style={{ width: '100%' }} size={16}>
              <Card>
                <Row gutter={16}>
                  <Col xs={24} md={8}><Statistic title="文档数" value={namespaceHealth?.fileCount ?? countFiles(fileTree)} /></Col>
                  <Col xs={24} md={8}><Statistic title="绑定 Context" value={bindings.length} /></Col>
                  <Col xs={24} md={8}><Statistic title="最近修改" value={formatTime(namespaceHealth?.latestModifiedAt)} /></Col>
                </Row>
              </Card>
              <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                items={[
                  { key: 'documents', label: '文档', children: documentsTab },
                  { key: 'bindings', label: '绑定', children: bindingTab },
                  { key: 'health', label: '健康状态', children: healthTab },
                  { key: 'drafts', label: '知识草稿', children: draftsTab },
                ]}
              />
            </Space>
          ) : (
            <Card><Empty description="选择一个 Namespace 查看详情" /></Card>
          )}
        </Col>
      </Row>

      <Modal title="新建 Namespace" open={createOpen} onCancel={() => { setCreateOpen(false); createForm.resetFields() }} onOk={() => createForm.submit()} okText="创建">
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="标识符" rules={[{ required: true }, { pattern: /^[a-z0-9-]+$/, message: '只允许小写字母、数字和短横线' }]}>
            <Input placeholder="product-kb" />
          </Form.Item>
          <Form.Item name="display_name" label="展示名称" rules={[{ required: true }]}>
            <Input placeholder="产品知识库" />
          </Form.Item>
          <Form.Item name="path" label="目录路径" rules={[{ required: true }]}>
            <Input placeholder="product" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="绑定到 Bot/Context" open={bindOpen} onCancel={() => setBindOpen(false)} onOk={() => bindForm.submit()} okText="保存绑定">
        <Form form={bindForm} layout="vertical" onFinish={handleBind}>
          <Form.Item name="botId" label="Bot" rules={[{ required: true }]}>
            <Select options={bots.map((bot) => ({ label: bot.name, value: bot.id }))} onChange={handleBindBotChange} />
          </Form.Item>
          <Form.Item name="contextId" label="Context" rules={[{ required: true }]}>
            <Select options={bindContexts.map((ctx) => ({ label: ctx.name, value: ctx.id }))} />
          </Form.Item>
          <Form.Item name="mcpServerId" label="Wiki MCP Server" rules={[{ required: true }]}>
            <Select options={mcpServers.filter((server) => server.enabled && isWikiMcpServer(server)).map((server) => ({ label: server.name, value: server.id }))} />
          </Form.Item>
          <Form.Item name="policy" label="检索策略" rules={[{ required: true }]}>
            <Radio.Group>
              <Radio.Button value="manual">手动</Radio.Button>
              <Radio.Button value="autoSearch">自动搜索</Radio.Button>
              <Radio.Button value="fixedPage">固定页面</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="forceCallPage" label="固定页面路径">
            <Input placeholder="rules/sop.md" />
          </Form.Item>
          <Form.Item name="maxChars" label="最大注入字符数" initialValue={6000}>
            <InputNumber min={500} max={50000} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="Wiki 使用向导" open={wizardOpen} width={760} onCancel={() => setWizardOpen(false)} onOk={runWizardPrimary} okText={wizardStep === 3 ? '完成' : '下一步'}>
        <Steps current={wizardStep} items={[
          { title: '创建知识库' },
          { title: '注册 MCP' },
          { title: '绑定 Context' },
          { title: '测试检索' },
        ]} style={{ marginBottom: 24 }} />
        <Form form={wizardForm} layout="vertical">
          {wizardStep === 0 && (
            <>
              <Form.Item name="name" label="Namespace 标识符" rules={[{ required: true }, { pattern: /^[a-z0-9-]+$/ }]}>
                <Input placeholder="product-kb" />
              </Form.Item>
              <Form.Item name="display_name" label="展示名称" rules={[{ required: true }]}>
                <Input placeholder="产品知识库" />
              </Form.Item>
              <Form.Item name="path" label="目录路径" rules={[{ required: true }]}>
                <Input placeholder="product" />
              </Form.Item>
              <Form.Item name="description" label="描述"><Input.TextArea rows={2} /></Form.Item>
            </>
          )}
          {wizardStep === 1 && (
            <Alert
              showIcon
              type={wikiMcp ? 'success' : 'warning'}
              message={wikiMcp ? `已检测到 ${wikiMcp.name}` : wikiMcpCandidate ? `已检测到 ${wikiMcpCandidate.name}，但尚未启用` : '未检测到 wiki-mcp'}
              description={wikiMcp ? wikiMcp.url : '下一步会自动启用或注册推荐配置，也可以去 MCP 服务器页面手动配置。'}
              action={<Button size="small" icon={<ApiOutlined />} onClick={() => navigate('/mcp-servers')}>高级配置</Button>}
            />
          )}
          {wizardStep === 2 && (
            <>
              <Form.Item name="botId" label="Bot" rules={[{ required: true }]}>
                <Select options={bots.map((bot) => ({ label: bot.name, value: bot.id }))} onChange={handleBindBotChange} />
              </Form.Item>
              <Form.Item name="contextId" label="Context" rules={[{ required: true }]}>
                <Select options={bindContexts.map((ctx) => ({ label: ctx.name, value: ctx.id }))} />
              </Form.Item>
              <Form.Item name="policy" label="检索策略" initialValue="autoSearch">
                <Radio.Group>
                  <Radio.Button value="manual">手动</Radio.Button>
                  <Radio.Button value="autoSearch">自动搜索</Radio.Button>
                  <Radio.Button value="fixedPage">固定页面</Radio.Button>
                </Radio.Group>
              </Form.Item>
              <Form.Item name="forceCallPage" label="固定页面路径"><Input placeholder="rules/sop.md" /></Form.Item>
              <Form.Item name="maxChars" label="最大注入字符数" initialValue={6000}><InputNumber min={500} max={50000} /></Form.Item>
            </>
          )}
          {wizardStep === 3 && (
            <>
              <Form.Item name="testQuery" label="测试问题" rules={[{ required: true }]}>
                <Input placeholder="输入一个知识库里应该能回答的问题" />
              </Form.Item>
              {testResults.length > 0 && <List size="small" dataSource={testResults} renderItem={(item) => <List.Item>{item.title} - {item.path}</List.Item>} />}
            </>
          )}
        </Form>
        <Divider />
        <Text type="secondary">当前 Wiki 根目录：{health?.wikiRoot || '未配置'}</Text>
      </Modal>
    </div>
  )
}
