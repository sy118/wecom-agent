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
  mergeStrategy?: 'append' | 'replace' | 'createOnly'
  reviewReason: string | null
  createdAt: number
}

interface RetrievalLog {
  id: string
  policy: string
  query: string
  hitCount: number
  hitPaths: string[]
  durationMs: number | null
  error: string | null
  contextId: string | null
  chatKey: string | null
  createdAt: number
}

interface WikiFeedbackItem {
  id: string
  responseRunId: string | null
  namespace: string | null
  feedbackType: number | null
  content: string | null
  inaccurateReasons: number[]
  classification: string
  status: string
  assignedTargetPath: string | null
  draftId: string | null
  resolutionNote: string | null
  createdAt: number
  responseRun?: {
    id: string
    contextId: string | null
    questionPreview: string | null
    answerPreview: string | null
    status: string
  } | null
}

interface AnnotationAnswer {
  id: string
  question: string
  answer: string
  namespace: string | null
  contextId: string | null
  sourceType: string
  sourceRef: string | null
  enabled: boolean
  hitCount: number
  updatedAt: number
}

interface MissSummary {
  query: string
  count: number
  latestAt: number
  contextIds: string[]
  chatKeys: string[]
}

interface WikiMetrics {
  fileCount: number
  bindingCount: number
  pendingDraftCount: number
  latestModifiedAt: number | null
  retrievalCount: number
  missCount: number
  hotDocuments: Array<{ path: string; hitCount: number }>
  topMisses: MissSummary[]
  feedback?: {
    total: number
    positive: number
    negative: number
    negativeRate: number
    pending: number
    drafted: number
    reasonCounts: Record<string, number>
    classificationCounts: Record<string, number>
  }
}

interface DraftDiff {
  strategy: 'append' | 'replace' | 'createOnly'
  targetExists: boolean
  currentContent: string
  nextContent: string
  diff: string[]
  error: string | null
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

function statusLabel(status?: string) {
  if (status === 'pending') return '待审核'
  if (status === 'merged') return '已合并'
  if (status === 'rejected') return '已拒绝'
  return status ?? '未知'
}

function sourceTypeLabel(sourceType?: string) {
  if (sourceType === 'manual') return '手动创建'
  if (sourceType === 'retrieval-miss') return '无命中问题'
  if (sourceType === 'feedback-event') return '用户反馈'
  if (sourceType === 'bot') return '机器人'
  if (sourceType === 'skill') return '技能'
  if (sourceType === 'scheduled-task') return '定时任务'
  if (sourceType === 'test') return '测试'
  return sourceType ?? '未知来源'
}

function feedbackStatusLabel(status?: string) {
  if (status === 'new') return '新反馈'
  if (status === 'triaged') return '已分流'
  if (status === 'drafted') return '已转草稿'
  if (status === 'resolved') return '已解决'
  if (status === 'ignored') return '已忽略'
  if (status === 'unlinked') return '未关联'
  return status ?? '未知'
}

function feedbackClassificationLabel(value?: string) {
  if (value === 'positive') return '正向反馈'
  if (value === 'knowledge_gap') return '知识缺失'
  if (value === 'retrieval_issue') return '检索问题'
  if (value === 'model_or_tool_issue') return '模型/工具问题'
  if (value === 'ignored') return '忽略'
  return '未分类'
}

function feedbackTypeLabel(type?: number | null) {
  if (type === 1) return '准确'
  if (type === 2) return '不准确'
  if (type === 3) return '取消'
  return '未知'
}

function inaccurateReasonLabel(reason: number) {
  const labels: Record<number, string> = {
    1: '与问题无关',
    2: '内容不完整',
    3: '内容有错误',
    4: '数据分析错误',
  }
  return labels[reason] ?? `原因 ${reason}`
}

function healthColor(status: HealthStatus) {
  if (status === 'ok') return 'green'
  if (status === 'warning') return 'gold'
  if (status === 'error') return 'red'
  return 'default'
}

function healthStatusLabel(status: HealthStatus | string) {
  if (status === 'ok') return '正常'
  if (status === 'warning') return '需关注'
  if (status === 'error') return '异常'
  return '未检测'
}

function healthItemLabel(key: string) {
  const labels: Record<string, string> = {
    rootConfigured: '根目录配置',
    rootExists: '根目录状态',
    gitRepo: 'Git 仓库',
    gitRemote: 'Git 远端',
    wikiMcp: 'Wiki 工具服务',
    mcpServer: 'MCP 服务配置',
    namespaces: '知识库空间',
    contextBindings: '上下文绑定',
    botRuntime: '机器人运行',
  }
  return labels[key] ?? key
}

function formatHealthMessage(message?: string) {
  if (!message) return '暂无说明'
  const exact: Record<string, string> = {
    'not checked': '未检测',
    'WIKI_ROOT is not configured': '未配置 WIKI_ROOT',
    'WIKI_ROOT directory does not exist': 'WIKI_ROOT 目录不存在',
    'WIKI_ROOT configured': '已配置 Wiki 根目录',
    'WIKI_ROOT is missing': '缺少 WIKI_ROOT 配置',
    'Directory exists': '目录存在',
    'Directory missing': '目录不存在',
    'Git repository is available': 'Git 仓库可用',
    'Git repository unavailable': 'Git 仓库不可用',
    'No Git remote configured': '尚未配置 Git 远端',
    'wiki-mcp health endpoint is reachable': 'wiki-mcp 健康接口可访问',
    'wiki-mcp server exists but is disabled': '已存在 wiki-mcp 服务，但尚未启用',
    'wiki-mcp server is not configured': '尚未配置 wiki-mcp 服务',
    'No Wiki namespace configured': '尚未创建 Wiki 知识库空间',
    'No Context is bound to Wiki': '尚未将上下文绑定到 Wiki',
    'No Wiki-bound Bot to check': '暂无绑定 Wiki 的机器人可检测',
    'Wiki-bound Bot(s) are not running': '绑定 Wiki 的机器人未运行',
  }
  if (exact[message]) return exact[message]
  const remoteMatch = message.match(/^(\d+) remote\(s\) configured$/)
  if (remoteMatch) return `已配置 ${remoteMatch[1]} 个 Git 远端`
  const mcpMatch = message.match(/^(\d+) enabled wiki-mcp server\(s\)$/)
  if (mcpMatch) return `已启用 ${mcpMatch[1]} 个 wiki-mcp 服务`
  const nsMatch = message.match(/^(\d+) namespace\(s\) configured$/)
  if (nsMatch) return `已配置 ${nsMatch[1]} 个知识库空间`
  const bindingMatch = message.match(/^(\d+) context binding\(s\) configured$/)
  if (bindingMatch) return `已配置 ${bindingMatch[1]} 个上下文绑定`
  const botMatch = message.match(/^(\d+)\/(\d+) Wiki-bound Bot\(s\) running$/)
  if (botMatch) return `已运行 ${botMatch[1]}/${botMatch[2]} 个绑定 Wiki 的机器人`
  const mcpStatusMatch = message.match(/^wiki-mcp returned (\d+)$/)
  if (mcpStatusMatch) return `wiki-mcp 返回 ${mcpStatusMatch[1]}`
  return message
}

function wikiErrorText(raw: unknown, fallback: string) {
  const text = typeof raw === 'string' ? raw : ''
  const exact: Record<string, string> = {
    'WIKI_ROOT is not configured': '尚未配置 Wiki 根目录，请先设置 WIKI_ROOT',
    'namespace not found': '知识库空间不存在或已被删除',
    'name, display_name and path are required': '请填写标识符、展示名称和目录路径',
    'name must use kebab-case lowercase letters, numbers and dashes': '标识符只能使用小写字母、数字和短横线',
    'invalid namespace path': '目录路径无效，请使用相对路径',
    'namespace already exists': '知识库空间标识已存在，请换一个标识符',
    'contextId is required': '请选择要绑定的上下文',
    'context not found': '上下文不存在或已被删除',
    'context does not belong to botId': '所选上下文不属于当前机器人',
    'wiki-mcp server is not configured': '尚未配置 wiki-mcp 服务',
    'selected MCP server is not wiki-mcp': '请选择 wiki-mcp 类型的 MCP 服务',
    'wiki-mcp server is disabled': 'wiki-mcp 服务未启用，请先启用后再绑定',
    'binding not found': '未找到对应绑定',
    'targetPath and content are required': '请填写目标页面和草稿内容',
    'draft not found': '草稿不存在或已被删除',
    'draft is not pending': '只有待审核草稿可以继续操作',
    'invalid target path': '目标页面路径无效，请使用相对路径',
    'content is required': '草稿内容不能为空',
    'target file already exists': '目标页面已存在，不能使用“仅创建新页面”策略',
    'invalid path': '路径无效，请使用相对路径',
    'file not found': '文件不存在或已被删除',
  }
  if (exact[text]) return exact[text]
  if (/already exists/i.test(text) && /namespace/i.test(text)) return exact['namespace already exists']
  if (/target file already exists/i.test(text)) return exact['target file already exists']
  if (/not configured/i.test(text) && /WIKI_ROOT/i.test(text)) return exact['WIKI_ROOT is not configured']
  return text || fallback
}

function wikiErrorMessage(err: unknown, fallback: string) {
  return wikiErrorText((err as any)?.response?.data?.error ?? (err instanceof Error ? err.message : ''), fallback)
}

function formatTime(value?: number | null) {
  return value ? new Date(value).toLocaleString() : '暂无'
}

function formatDuration(value?: number | null) {
  return value === null || value === undefined ? '未知' : `${value} ms`
}

function strategyLabel(strategy?: string) {
  if (strategy === 'replace') return '覆盖'
  if (strategy === 'createOnly') return '仅创建'
  return '追加'
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
  const [namespaceSummaries, setNamespaceSummaries] = useState<Record<string, any>>({})
  const [metrics, setMetrics] = useState<WikiMetrics | null>(null)
  const [bindings, setBindings] = useState<WikiBinding[]>([])
  const [drafts, setDrafts] = useState<WikiDraft[]>([])
  const [retrievalLogs, setRetrievalLogs] = useState<RetrievalLog[]>([])
  const [misses, setMisses] = useState<MissSummary[]>([])
  const [feedbackItems, setFeedbackItems] = useState<WikiFeedbackItem[]>([])
  const [feedbackMetrics, setFeedbackMetrics] = useState<WikiMetrics['feedback'] | null>(null)
  const [feedbackStatusFilter, setFeedbackStatusFilter] = useState<string | undefined>()
  const [feedbackReasonFilter, setFeedbackReasonFilter] = useState<number | undefined>()
  const [feedbackContextFilter, setFeedbackContextFilter] = useState<string | undefined>()
  const [feedbackWindowDays, setFeedbackWindowDays] = useState<number>(7)
  const [feedbackDetailOpen, setFeedbackDetailOpen] = useState(false)
  const [activeFeedbackDetail, setActiveFeedbackDetail] = useState<any>(null)
  const [annotationAnswers, setAnnotationAnswers] = useState<AnnotationAnswer[]>([])
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
  const [draftDetailOpen, setDraftDetailOpen] = useState(false)
  const [activeDraft, setActiveDraft] = useState<WikiDraft | null>(null)
  const [activeDraftStrategy, setActiveDraftStrategy] = useState<'append' | 'replace' | 'createOnly'>('append')
  const [activeDraftDiff, setActiveDraftDiff] = useState<DraftDiff | null>(null)
  const [createForm] = Form.useForm()
  const [wizardForm] = Form.useForm()
  const [bindForm] = Form.useForm()
  const [draftForm] = Form.useForm()
  const [draftEditForm] = Form.useForm()
  const [annotationForm] = Form.useForm()

  const wikiMcp = useMemo(() => mcpServers.find((server) => server.enabled && isWikiMcpServer(server)), [mcpServers])
  const wikiMcpCandidate = useMemo(() => mcpServers.find(isWikiMcpServer), [mcpServers])
  const shouldShowWizard = namespaces.length === 0 || !wikiMcp || allBindingCount === 0

  const remindBotRestart = () => {
    message.info('配置已保存，运行中的关联机器人会自动加载最新 Wiki 工具')
  }

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
      const healthSummaries = await Promise.all(nsList.map((ns: WikiNamespace) => wikiApi.namespaceHealth(ns.name).catch(() => null)))
      setNamespaceSummaries(Object.fromEntries(nsList.map((ns: WikiNamespace, index: number) => [ns.name, healthSummaries[index]])))
      setAllBindingCount(summaries.reduce((sum, item) => sum + item.length, 0))
    } finally {
      setLoading(false)
    }
  }

  const refreshNamespace = async (ns: WikiNamespace) => {
    setTreeLoading(true)
    try {
      const [tree, nsHealth, bindingList, draftList, metricData, logData, missData, feedbackData, feedbackMetricData, annotationData] = await Promise.all([
        wikiApi.listFiles(ns.name),
        wikiApi.namespaceHealth(ns.name),
        wikiApi.bindings(ns.name),
        wikiApi.listDrafts(ns.name),
        wikiApi.metrics(ns.name),
        wikiApi.retrievalLogs(ns.name),
        wikiApi.misses(ns.name),
        wikiApi.feedback(ns.name, {
          status: feedbackStatusFilter,
          reason: feedbackReasonFilter,
          contextId: feedbackContextFilter,
          since: feedbackWindowDays === 0 ? 0 : Date.now() - feedbackWindowDays * 24 * 60 * 60 * 1000,
        }),
        wikiApi.feedbackMetrics(ns.name, {
          since: feedbackWindowDays === 0 ? 0 : Date.now() - feedbackWindowDays * 24 * 60 * 60 * 1000,
        }),
        wikiApi.listAnnotationAnswers(ns.name),
      ])
      setFileTree(tree)
      setNamespaceHealth(nsHealth)
      setBindings(bindingList)
      setDrafts(draftList)
      setMetrics(metricData)
      setRetrievalLogs(logData.logs ?? [])
      setMisses(missData.misses ?? [])
      setFeedbackItems(feedbackData.items ?? [])
      setFeedbackMetrics(feedbackMetricData.metrics ?? metricData.feedback ?? null)
      setAnnotationAnswers(annotationData)
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
    setActiveFeedbackDetail(null)
    setFeedbackDetailOpen(false)
    setActiveTab('documents')
    refreshNamespace(ns)
  }

  const handleCreate = async (values: { name: string; display_name: string; path: string; description?: string }) => {
    try {
      const ns = await wikiApi.createNamespace(values)
      message.success('知识库空间已创建')
      setCreateOpen(false)
      createForm.resetFields()
      await refreshAll()
      handleSelectNamespace(ns)
    } catch (err: any) {
      message.error(wikiErrorMessage(err, '创建失败'))
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
      message.error('同步最新失败')
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
    const startedAt = Date.now()
    const result = await wikiApi.search(selected.name, query)
    setSearchAttempted(true)
    setSearchResults(result.results ?? [])
    setTestResults(result.results ?? [])
    setTestPreview(`检索词：${result.query ?? query}\n命中：${result.hitCount ?? result.results?.length ?? 0}\n耗时：${result.durationMs ?? Date.now() - startedAt} ms`)
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
        const startedAt = Date.now()
        const path = String(fixedPageBinding.params.forceCallPage)
        const maxChars = Number(fixedPageBinding.params.maxChars ?? 6000)
        const file = await wikiApi.getFile(selected.name, path)
        setTestResults([])
        setTestPreview(`固定页面: ${path}\n耗时: ${Date.now() - startedAt} ms\n\n${String(file.content ?? '').slice(0, maxChars)}`)
        refreshNamespace(selected)
      } catch (err: any) {
        message.error(wikiErrorMessage(err, '固定页面读取失败'))
      }
      return
    }
    if (!testQuery.trim()) return
    const result = await wikiApi.search(selected.name, testQuery)
    setTestResults(result.results ?? [])
    setTestPreview(`检索词：${result.query ?? testQuery}\n命中：${result.hitCount ?? result.results?.length ?? 0}\n耗时：${result.durationMs ?? 0} ms`)
    refreshNamespace(selected)
  }

  const handleBindBotChange = async (botId: string) => {
    bindForm.setFieldsValue({ contextId: undefined })
    setBindContexts(await contextsApi.list(botId))
  }

  const openBind = () => {
    if (!wikiMcp) {
      message.warning('请先启用 wiki-mcp，再绑定上下文')
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
      remindBotRestart()
      setBindOpen(false)
      refreshAll()
      refreshNamespace(selected)
    } catch (err: any) {
      message.error(wikiErrorMessage(err, '绑定失败'))
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
      { key: 'namespace', label: 'Wiki 知识库标识', type: 'string', description: '要查询的 Wiki 知识库空间' },
      { key: 'retrievalPolicy', label: '检索策略', type: 'string', description: '手动 / 自动搜索 / 固定页面' },
      { key: 'forceCallPage', label: '固定页面', type: 'string', description: '固定页面策略使用' },
      { key: 'maxChars', label: '最大字符数', type: 'number', description: '固定页面注入截断长度' },
      { key: 'crossNs', label: '跨知识库搜索', type: 'boolean', description: '自动搜索是否跨知识库空间' },
    ]
    const recommendedUrl = health?.wikiMcpUrl ? `${String(health.wikiMcpUrl).replace(/\/$/, '')}/sse` : 'http://127.0.0.1:3001/sse'
    const created = wikiMcpCandidate ? await mcpServersApi.update(wikiMcpCandidate.id, {
      enabled: true,
      paramSchema: wikiMcpCandidate.paramSchema?.length ? wikiMcpCandidate.paramSchema : recommendedParamSchema,
    }) : await mcpServersApi.create({
      name: 'wiki-mcp',
      url: recommendedUrl,
      transportType: 'sse',
      enabled: true,
      paramSchema: recommendedParamSchema,
    })
    message.success(wikiMcpCandidate ? 'wiki-mcp 已启用' : 'wiki-mcp 已注册')
    remindBotRestart()
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
      remindBotRestart()
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

  const createDraftFromMiss = async (miss: MissSummary) => {
    if (!selected) return
    setActiveTab('drafts')
    draftForm.setFieldsValue({
      targetPath: `待补充/${Date.now()}.md`,
      content: `# ${miss.query}\n\n> 来源：无命中问题，出现 ${miss.count} 次。\n\n请补充标准答案。`,
      sourceRef: `retrieval-miss:${miss.query}`,
    })
  }

  const loadDraftDiff = async (draft: WikiDraft, strategy = activeDraftStrategy) => {
    if (!selected) return
    try {
      setActiveDraftDiff(await wikiApi.draftDiff(selected.name, draft.id, strategy))
    } catch (err: any) {
      setActiveDraftDiff(null)
      message.error(wikiErrorMessage(err, '读取差异失败'))
    }
  }

  const openDraftDetail = async (draft: WikiDraft) => {
    const strategy = draft.mergeStrategy ?? 'append'
    setActiveDraft(draft)
    setActiveDraftStrategy(strategy)
    setDraftDetailOpen(true)
    draftEditForm.setFieldsValue({
      targetPath: draft.targetPath,
      content: draft.content,
      sourceRef: draft.sourceRef,
      mergeStrategy: strategy,
    })
    await loadDraftDiff(draft, strategy)
  }

  const saveDraftDetail = async () => {
    if (!selected || !activeDraft) return
    const values = await draftEditForm.validateFields()
    const updated = await wikiApi.updateDraft(selected.name, activeDraft.id, values)
    setActiveDraft(updated)
    setActiveDraftStrategy(updated.mergeStrategy ?? values.mergeStrategy ?? 'append')
    message.success('草稿已保存')
    await loadDraftDiff(updated, updated.mergeStrategy ?? values.mergeStrategy ?? 'append')
    refreshNamespace(selected)
  }

  const approveDraft = async (draft: WikiDraft) => {
    if (!selected) return
    try {
      await wikiApi.approveDraft(selected.name, draft.id, { mergeStrategy: activeDraft?.id === draft.id ? activeDraftStrategy : draft.mergeStrategy ?? 'append' })
      message.success('草稿已合并')
      setDraftDetailOpen(false)
      setActiveDraft(null)
      refreshNamespace(selected)
    } catch (err: any) {
      message.error(wikiErrorMessage(err, '合并失败'))
    }
  }

  const rejectDraft = async (draft: WikiDraft) => {
    if (!selected) return
    const reason = window.prompt('请输入拒绝原因', draft.reviewReason ?? '管理员拒绝')
    if (reason === null) return
    await wikiApi.rejectDraft(selected.name, draft.id, { reason })
    message.success('草稿已拒绝')
    setDraftDetailOpen(false)
    setActiveDraft(null)
    refreshNamespace(selected)
  }

  const openFeedbackDetail = async (item: WikiFeedbackItem) => {
    if (!selected) return
    setActiveFeedbackDetail(await wikiApi.feedbackDetail(selected.name, item.id))
    setFeedbackDetailOpen(true)
  }

  const updateFeedback = async (item: WikiFeedbackItem, data: Record<string, unknown>, success = '反馈已更新') => {
    if (!selected) return
    await wikiApi.updateFeedback(selected.name, item.id, data)
    message.success(success)
    refreshNamespace(selected)
  }

  const ignoreFeedback = async (item: WikiFeedbackItem) => {
    const reason = window.prompt('请输入忽略原因', item.resolutionNote ?? '无需处理')
    if (reason === null) return
    await updateFeedback(item, {
      status: 'ignored',
      classification: 'ignored',
      resolutionNote: reason.trim() || '无需处理',
    }, '已忽略')
  }

  const createDraftFromFeedback = async (item: WikiFeedbackItem) => {
    if (!selected) return
    const draft = await wikiApi.feedbackToDraft(selected.name, item.id, {
      targetPath: item.assignedTargetPath || `feedback/${item.id}.md`,
      mergeStrategy: 'append',
    })
    message.success('已转为 Wiki 草稿')
    setActiveTab('drafts')
    refreshNamespace(selected)
    openDraftDetail(draft)
  }

  const createAnnotationFromFeedback = async (item: WikiFeedbackItem) => {
    if (!selected) return
    try {
      await wikiApi.createAnnotationAnswerFromFeedback(selected.name, item.id)
      message.success('已生成标注答案')
      refreshNamespace(selected)
    } catch (err: any) {
      message.error(wikiErrorMessage(err, '请先在详情中补充审核后的答案'))
    }
  }

  const handleCreateAnnotation = async (values: any) => {
    if (!selected) return
    await wikiApi.createAnnotationAnswer(selected.name, values)
    message.success('标注答案已创建')
    annotationForm.resetFields()
    refreshNamespace(selected)
  }

  const toggleAnnotation = async (item: AnnotationAnswer) => {
    if (!selected) return
    await wikiApi.updateAnnotationAnswer(selected.name, item.id, { enabled: !item.enabled })
    message.success(item.enabled ? '已禁用' : '已启用')
    refreshNamespace(selected)
  }

  const deleteAnnotation = async (item: AnnotationAnswer) => {
    if (!selected) return
    await wikiApi.deleteAnnotationAnswer(selected.name, item.id)
    message.success('已删除')
    refreshNamespace(selected)
  }

  const renderHealthItems = () => {
    const items = health?.items ?? {}
    const actionFor = (key: string) => {
      if (key === 'mcpServer') return <Button size="small" onClick={() => navigate('/mcp-servers')}>配置 MCP</Button>
      if (key === 'namespaces') return <Button size="small" onClick={() => setCreateOpen(true)}>新建知识库</Button>
      if (key === 'contextBindings') return <Button size="small" onClick={() => selected ? openBind() : setWizardOpen(true)}>绑定上下文</Button>
      if (key === 'botRuntime') return <Button size="small" onClick={() => navigate('/bots')}>查看机器人</Button>
      if (key === 'wikiMcp') return <Button size="small" onClick={() => registerWikiMcp()}>启用 wiki-mcp</Button>
      return null
    }
    return (
      <Row gutter={[12, 12]}>
        {Object.entries(items).map(([key, value]: [string, any]) => (
          <Col key={key} xs={24} md={12} xl={8}>
            <Card size="small">
              <Space direction="vertical" size={2}>
                <Text strong>{healthItemLabel(key)}</Text>
                <Tag color={healthColor(value.status)}>{healthStatusLabel(value.status)}</Tag>
                <Text type="secondary" style={{ fontSize: 12 }}>{formatHealthMessage(value.message)}</Text>
                {value.status !== 'ok' && actionFor(key)}
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
                <Descriptions.Item label="大小">{selectedFile.size} 字节</Descriptions.Item>
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
    <Card size="small" title="绑定到机器人/上下文" extra={<Button type="primary" icon={<LinkOutlined />} onClick={openBind}>新增绑定</Button>}>
      {bindings.length === 0 ? (
        <Alert type="warning" showIcon message="此知识库空间尚未绑定任何上下文" />
      ) : (
        <List
          dataSource={bindings}
          renderItem={(item) => (
            <List.Item actions={[<Button key="unbind" size="small" danger onClick={() => handleUnbind(item)}>解绑</Button>]}>
              <List.Item.Meta
                title={<Space>{item.botName}<Tag>{item.contextName}</Tag><Tag color="blue">{policyLabel(item.policy)}</Tag></Space>}
                description={`MCP 服务：${item.mcpServerName}`}
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
        {testPreview && (
          <Paragraph style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto', marginBottom: 0 }}>{testPreview}</Paragraph>
        )}
        {testResults.length > 0 ? (
          <List size="small" dataSource={testResults} renderItem={(item) => <List.Item><List.Item.Meta title={`${item.title} (${item.path})`} description={item.excerpt} /></List.Item>} />
        ) : testPreview ? null : (
          <Text type="secondary">自动搜索会展示命中摘要；固定页面策略会展示读取预览。</Text>
        )}
        {testPreview && testResults.length === 0 && !testPreview.includes('固定页面') && (
          <Empty description="没有命中文档" style={{ marginTop: 12 }}>
            <Space>
              <Upload beforeUpload={handleUpload} showUploadList={false} multiple accept=".md">
                <Button icon={<UploadOutlined />}>上传文档</Button>
              </Upload>
              <Button onClick={() => setActiveTab('drafts')}>创建草稿</Button>
            </Space>
          </Empty>
        )}
      </Card>
      <Card size="small" title="最近检索日志">
        {retrievalLogs.length === 0 ? <Empty description="暂无检索日志" /> : (
          <List
            size="small"
            dataSource={retrievalLogs.slice(0, 8)}
            renderItem={(item) => (
              <List.Item>
                <List.Item.Meta
                  title={<Space><Tag>{policyLabel(item.policy)}</Tag><Text>{item.query}</Text><Tag color={item.hitCount > 0 ? 'green' : 'gold'}>{item.hitCount} 命中</Tag></Space>}
                  description={<Space wrap><Text type="secondary">{formatTime(item.createdAt)}</Text><Text type="secondary">{formatDuration(item.durationMs)}</Text>{item.hitPaths.map((path) => <Tag key={path}>{path}</Tag>)}{item.error && <Tag color="red">{item.error}</Tag>}</Space>}
                />
              </List.Item>
            )}
          />
        )}
      </Card>
      <Card size="small" title="无命中问题">
        {misses.length === 0 ? (
          <Empty description="暂无无命中问题" />
        ) : (
          <List
            size="small"
            dataSource={misses.slice(0, 8)}
            renderItem={(item) => (
              <List.Item actions={[<Button key="draft" size="small" onClick={() => createDraftFromMiss(item)}>转草稿</Button>]}>
                <List.Item.Meta
                  title={<Space><Text>{item.query}</Text><Tag color="gold">{item.count} 次</Tag></Space>}
                  description={`最近出现：${formatTime(item.latestAt)}`}
                />
              </List.Item>
            )}
          />
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
            <Form.Item name="mergeStrategy" label="默认合并策略" initialValue="append">
              <Select options={[
                { label: '追加到页面', value: 'append' },
                { label: '覆盖页面', value: 'replace' },
                { label: '仅创建新页面', value: 'createOnly' },
              ]} />
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
                    <Button key="detail" size="small" onClick={() => openDraftDetail(draft)}>详情</Button>,
                    <Button key="approve" size="small" type="primary" onClick={() => approveDraft(draft)}>合并</Button>,
                    <Button key="reject" size="small" danger onClick={() => rejectDraft(draft)}>拒绝</Button>,
                  ] : [<Tag key="status">{statusLabel(draft.status)}</Tag>]}
                >
                  <List.Item.Meta
                    title={<Space>{draft.targetPath}<Tag color={draft.status === 'pending' ? 'gold' : draft.status === 'merged' ? 'green' : 'red'}>{statusLabel(draft.status)}</Tag><Tag>{strategyLabel(draft.mergeStrategy)}</Tag></Space>}
                    description={
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <Text type="secondary">来源：{sourceTypeLabel(draft.sourceType)}{draft.sourceRef ? ` / ${draft.sourceRef}` : ''}</Text>
                        {draft.reviewReason && <Text type="secondary">原因：{draft.reviewReason}</Text>}
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

  const feedbackTab = (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Row gutter={16}>
        <Col xs={24} md={6}><Card><Statistic title="反馈总数" value={feedbackMetrics?.total ?? 0} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="负反馈" value={feedbackMetrics?.negative ?? 0} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="待处理" value={feedbackMetrics?.pending ?? 0} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="已转草稿" value={feedbackMetrics?.drafted ?? 0} /></Card></Col>
      </Row>
      <Card size="small" title="反馈收件箱">
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            allowClear
            placeholder="状态"
            value={feedbackStatusFilter}
            onChange={setFeedbackStatusFilter}
            style={{ width: 140 }}
            options={[
              { label: '新反馈', value: 'new' },
              { label: '已分流', value: 'triaged' },
              { label: '已转草稿', value: 'drafted' },
              { label: '已解决', value: 'resolved' },
              { label: '已忽略', value: 'ignored' },
              { label: '未关联', value: 'unlinked' },
            ]}
          />
          <Select
            allowClear
            placeholder="负反馈原因"
            value={feedbackReasonFilter}
            onChange={setFeedbackReasonFilter}
            style={{ width: 160 }}
            options={[1, 2, 3, 4].map((reason) => ({ label: inaccurateReasonLabel(reason), value: reason }))}
          />
          <Select
            allowClear
            placeholder="上下文"
            value={feedbackContextFilter}
            onChange={setFeedbackContextFilter}
            style={{ width: 180 }}
            options={bindings.map((binding) => ({ label: binding.contextName, value: binding.contextId }))}
          />
          <Select
            value={feedbackWindowDays}
            onChange={setFeedbackWindowDays}
            style={{ width: 130 }}
            options={[
              { label: '近 7 天', value: 7 },
              { label: '近 30 天', value: 30 },
              { label: '近 90 天', value: 90 },
              { label: '全部时间', value: 0 },
            ]}
          />
          <Button onClick={() => selected && refreshNamespace(selected)}>筛选</Button>
        </Space>
        {feedbackItems.length === 0 ? (
          <Empty description="暂无反馈" />
        ) : (
          <List
            dataSource={feedbackItems}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Button key="detail" size="small" onClick={() => openFeedbackDetail(item)}>详情</Button>,
                  <Button key="draft" size="small" onClick={() => createDraftFromFeedback(item)}>转草稿</Button>,
                  <Button key="annotation" size="small" onClick={() => createAnnotationFromFeedback(item)}>标注答案</Button>,
                  <Button key="ignore" size="small" onClick={() => ignoreFeedback(item)}>忽略</Button>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space wrap>
                      <Text>{item.responseRun?.questionPreview ?? item.content ?? '未关联反馈'}</Text>
                      <Tag color={item.feedbackType === 2 ? 'red' : item.feedbackType === 1 ? 'green' : 'default'}>{feedbackTypeLabel(item.feedbackType)}</Tag>
                      <Tag>{feedbackStatusLabel(item.status)}</Tag>
                      <Tag color="blue">{feedbackClassificationLabel(item.classification)}</Tag>
                    </Space>
                  }
                  description={
                    <Space direction="vertical" size={2} style={{ width: '100%' }}>
                      <Text type="secondary">{formatTime(item.createdAt)}{item.responseRun?.contextId ? ` / ${item.responseRun.contextId}` : ''}</Text>
                      {item.inaccurateReasons.length > 0 && <Text type="secondary">原因：{item.inaccurateReasons.map(inaccurateReasonLabel).join('、')}</Text>}
                      {item.content && <Paragraph ellipsis={{ rows: 2, expandable: true }}>{item.content}</Paragraph>}
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>
    </Space>
  )

  const annotationTab = (
    <Row gutter={16}>
      <Col xs={24} xl={9}>
        <Card size="small" title="新建标注答案">
          <Form form={annotationForm} layout="vertical" onFinish={handleCreateAnnotation}>
            <Form.Item name="question" label="精确问题" rules={[{ required: true }]}>
              <Input.TextArea rows={3} />
            </Form.Item>
            <Form.Item name="answer" label="标准答案" rules={[{ required: true }]}>
              <Input.TextArea rows={8} />
            </Form.Item>
            <Form.Item name="contextId" label="限定上下文">
              <Select allowClear options={bindings.map((binding) => ({ label: binding.contextName, value: binding.contextId }))} />
            </Form.Item>
            <Button type="primary" htmlType="submit">保存标注答案</Button>
          </Form>
        </Card>
      </Col>
      <Col xs={24} xl={15}>
        <Card size="small" title="标注答案库">
          {annotationAnswers.length === 0 ? <Empty description="暂无标注答案" /> : (
            <List
              dataSource={annotationAnswers}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button key="toggle" size="small" onClick={() => toggleAnnotation(item)}>{item.enabled ? '禁用' : '启用'}</Button>,
                    <Popconfirm key="delete" title="确认删除此标注答案？" onConfirm={() => deleteAnnotation(item)}>
                      <Button size="small" danger>删除</Button>
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    title={<Space wrap><Text>{item.question}</Text><Tag color={item.enabled ? 'green' : 'default'}>{item.enabled ? '启用' : '禁用'}</Tag><Tag>{item.hitCount} 命中</Tag></Space>}
                    description={
                      <Space direction="vertical" size={2} style={{ width: '100%' }}>
                        <Paragraph ellipsis={{ rows: 3, expandable: true }}>{item.answer}</Paragraph>
                        <Text type="secondary">来源：{sourceTypeLabel(item.sourceType)}{item.sourceRef ? ` / ${item.sourceRef}` : ''}{item.contextId ? ` / ${item.contextId}` : ''}</Text>
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

  const opsTab = (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Row gutter={16}>
        <Col xs={24} md={6}><Card><Statistic title="文档数" value={metrics?.fileCount ?? namespaceHealth?.fileCount ?? countFiles(fileTree)} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="绑定数" value={metrics?.bindingCount ?? bindings.length} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="待审核草稿" value={metrics?.pendingDraftCount ?? drafts.filter((draft) => draft.status === 'pending').length} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="7天无命中" value={metrics?.missCount ?? 0} /></Card></Col>
      </Row>
      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Card size="small" title="热门命中文档">
            {!metrics?.hotDocuments?.length ? <Empty description="暂无命中文档" /> : (
              <List
                size="small"
                dataSource={metrics.hotDocuments}
                renderItem={(item) => <List.Item><List.Item.Meta title={item.path} description={`${item.hitCount} 次命中`} /></List.Item>}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card size="small" title="热门无命中问题">
            {!metrics?.topMisses?.length ? (
              <Empty description="暂无无命中问题">
                <Space>
                  <Button onClick={() => setActiveTab('health')}>测试检索</Button>
                  <Button onClick={() => setActiveTab('drafts')}>创建草稿</Button>
                </Space>
              </Empty>
            ) : (
              <List
                size="small"
                dataSource={metrics.topMisses}
                renderItem={(item) => (
                  <List.Item actions={[<Button key="draft" size="small" onClick={() => createDraftFromMiss(item)}>转草稿</Button>]}>
                    <List.Item.Meta title={item.query} description={`${item.count} 次，最近 ${formatTime(item.latestAt)}`} />
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>
      </Row>
      <Card size="small" title="运营摘要">
        <Descriptions size="small" column={2}>
          <Descriptions.Item label="最近修改">{formatTime(metrics?.latestModifiedAt)}</Descriptions.Item>
          <Descriptions.Item label="近 7 天检索">{metrics?.retrievalCount ?? 0}</Descriptions.Item>
          <Descriptions.Item label="待审核草稿">{metrics?.pendingDraftCount ?? 0}</Descriptions.Item>
          <Descriptions.Item label="无命中">{metrics?.missCount ?? 0}</Descriptions.Item>
        </Descriptions>
      </Card>
    </Space>
  )

  return (
    <div style={{ padding: 24 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}><BookOutlined style={{ marginRight: 8 }} />Wiki 知识库</Title>
        <Space>
          <Button icon={<CloudSyncOutlined />} onClick={handleGitPull}>同步最新</Button>
          <Button icon={<CheckCircleOutlined />} onClick={() => setWizardOpen(true)}>使用向导</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建知识库</Button>
        </Space>
      </Row>

      {shouldShowWizard && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Wiki 尚未完成完整配置"
          description="按向导完成知识库空间、wiki-mcp、上下文绑定和测试检索后，机器人才能稳定使用知识库。"
          action={<Button size="small" onClick={() => setWizardOpen(true)}>开始向导</Button>}
        />
      )}

      <Card size="small" title="配置体检中心" style={{ marginBottom: 16 }}>
        {renderHealthItems()}
      </Card>

      <Row gutter={16}>
        <Col xs={24} xl={7}>
          <Card title="知识库空间" loading={loading}>
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
                    title={
                      <Space wrap>
                        {ns.displayName}
                        <Tag>{ns.name}</Tag>
                        {(namespaceSummaries[ns.name]?.pendingDraftCount ?? 0) > 0 && <Tag color="gold">待审 {namespaceSummaries[ns.name].pendingDraftCount}</Tag>}
                        {(namespaceSummaries[ns.name]?.bindingCount ?? 0) === 0 && <Tag color="red">未绑定</Tag>}
                      </Space>
                    }
                    description={
                      <Space direction="vertical" size={2}>
                        <Text type="secondary">{ns.path}</Text>
                        <Text type="secondary">文档 {namespaceSummaries[ns.name]?.fileCount ?? 0} / 绑定 {namespaceSummaries[ns.name]?.bindingCount ?? 0} / 无命中 {namespaceSummaries[ns.name]?.recentMissCount ?? 0}</Text>
                        {ns.description && <Text type="secondary">{ns.description}</Text>}
                      </Space>
                    }
                  />
                </Card>
              ))}
              {namespaces.length === 0 && <Empty description="暂无知识库空间" />}
            </Space>
          </Card>
        </Col>

        <Col xs={24} xl={17}>
          {selected ? (
            <Space direction="vertical" style={{ width: '100%' }} size={16}>
              <Card>
                <Row gutter={16}>
                  <Col xs={24} md={8}><Statistic title="文档数" value={namespaceHealth?.fileCount ?? countFiles(fileTree)} /></Col>
                  <Col xs={24} md={8}><Statistic title="绑定上下文" value={bindings.length} /></Col>
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
                  { key: 'feedback', label: '反馈', children: feedbackTab },
                  { key: 'annotations', label: '标注答案', children: annotationTab },
                  { key: 'ops', label: '运营', children: opsTab },
                ]}
              />
            </Space>
          ) : (
            <Card><Empty description="选择一个知识库空间查看详情" /></Card>
          )}
        </Col>
      </Row>

      <Modal title="新建知识库空间" open={createOpen} onCancel={() => { setCreateOpen(false); createForm.resetFields() }} onOk={() => createForm.submit()} okText="创建">
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

      <Modal title="绑定到机器人/上下文" open={bindOpen} onCancel={() => setBindOpen(false)} onOk={() => bindForm.submit()} okText="保存绑定">
        <Form form={bindForm} layout="vertical" onFinish={handleBind}>
          <Form.Item name="botId" label="机器人" rules={[{ required: true }]}>
            <Select options={bots.map((bot) => ({ label: bot.name, value: bot.id }))} onChange={handleBindBotChange} />
          </Form.Item>
          <Form.Item name="contextId" label="上下文" rules={[{ required: true }]}>
            <Select options={bindContexts.map((ctx) => ({ label: ctx.name, value: ctx.id }))} />
          </Form.Item>
          <Form.Item name="mcpServerId" label="Wiki MCP 服务" rules={[{ required: true }]}>
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
            <Input placeholder="制度/服务规范.md" />
          </Form.Item>
          <Form.Item name="maxChars" label="最大注入字符数" initialValue={6000}>
            <InputNumber min={500} max={50000} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="Wiki 使用向导" open={wizardOpen} width={760} onCancel={() => setWizardOpen(false)} onOk={runWizardPrimary} okText={wizardStep === 3 ? '完成' : '下一步'}>
        <Steps current={wizardStep} items={[
          { title: '创建知识库' },
          { title: '注册 MCP 服务' },
          { title: '绑定上下文' },
          { title: '测试检索' },
        ]} style={{ marginBottom: 24 }} />
        <Form form={wizardForm} layout="vertical">
          {wizardStep === 0 && (
            <>
              <Form.Item name="name" label="知识库标识符" rules={[{ required: true }, { pattern: /^[a-z0-9-]+$/ }]}>
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
              <Form.Item name="botId" label="机器人" rules={[{ required: true }]}>
                <Select options={bots.map((bot) => ({ label: bot.name, value: bot.id }))} onChange={handleBindBotChange} />
              </Form.Item>
              <Form.Item name="contextId" label="上下文" rules={[{ required: true }]}>
                <Select options={bindContexts.map((ctx) => ({ label: ctx.name, value: ctx.id }))} />
              </Form.Item>
              <Form.Item name="policy" label="检索策略" initialValue="autoSearch">
                <Radio.Group>
                  <Radio.Button value="manual">手动</Radio.Button>
                  <Radio.Button value="autoSearch">自动搜索</Radio.Button>
                  <Radio.Button value="fixedPage">固定页面</Radio.Button>
                </Radio.Group>
              </Form.Item>
              <Form.Item name="forceCallPage" label="固定页面路径"><Input placeholder="制度/服务规范.md" /></Form.Item>
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

      <Modal
        title="反馈详情"
        open={feedbackDetailOpen}
        width={900}
        onCancel={() => { setFeedbackDetailOpen(false); setActiveFeedbackDetail(null) }}
        footer={activeFeedbackDetail?.item ? [
          <Button key="retrieval" onClick={() => updateFeedback(activeFeedbackDetail.item, { status: 'triaged', classification: 'retrieval_issue' }, '已标记为检索问题')}>检索问题</Button>,
          <Button key="model" onClick={() => updateFeedback(activeFeedbackDetail.item, { status: 'triaged', classification: 'model_or_tool_issue' }, '已标记为模型/工具问题')}>模型/工具问题</Button>,
          <Button key="ignore" onClick={() => ignoreFeedback(activeFeedbackDetail.item)}>忽略</Button>,
          <Button key="draft" type="primary" onClick={() => createDraftFromFeedback(activeFeedbackDetail.item)}>转 Wiki 草稿</Button>,
        ] : null}
      >
        {activeFeedbackDetail?.item && (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Descriptions size="small" column={2}>
              <Descriptions.Item label="反馈类型">{feedbackTypeLabel(activeFeedbackDetail.item.feedbackType)}</Descriptions.Item>
              <Descriptions.Item label="状态">{feedbackStatusLabel(activeFeedbackDetail.item.status)}</Descriptions.Item>
              <Descriptions.Item label="分类">{feedbackClassificationLabel(activeFeedbackDetail.item.classification)}</Descriptions.Item>
              <Descriptions.Item label="时间">{formatTime(activeFeedbackDetail.item.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="原因" span={2}>{activeFeedbackDetail.item.inaccurateReasons?.map(inaccurateReasonLabel).join('、') || '无'}</Descriptions.Item>
              <Descriptions.Item label="用户补充" span={2}>{activeFeedbackDetail.item.content || '无'}</Descriptions.Item>
            </Descriptions>
            <Card size="small" title="原问题与回答">
              <Paragraph strong>{activeFeedbackDetail.evidence?.responseRun?.questionPreview ?? '暂无问题'}</Paragraph>
              <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{activeFeedbackDetail.evidence?.responseRun?.answerPreview ?? '暂无回答'}</Paragraph>
            </Card>
            <Card size="small" title="关联会话">
              {(activeFeedbackDetail.evidence?.sessionMessages ?? []).length === 0 ? <Empty description="暂无会话消息" /> : (
                <List
                  size="small"
                  dataSource={activeFeedbackDetail.evidence.sessionMessages}
                  renderItem={(msg: any) => <List.Item><Tag>{msg.role}</Tag><Text>{typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}</Text></List.Item>}
                />
              )}
            </Card>
            <Card size="small" title="检索证据">
              {(activeFeedbackDetail.evidence?.retrievalLogs ?? []).length === 0 ? <Empty description="暂无检索证据" /> : (
                <List
                  size="small"
                  dataSource={activeFeedbackDetail.evidence.retrievalLogs}
                  renderItem={(log: RetrievalLog) => (
                    <List.Item>
                      <List.Item.Meta
                        title={<Space><Tag>{policyLabel(log.policy)}</Tag><Text>{log.query}</Text><Tag>{log.hitCount} 命中</Tag></Space>}
                        description={<Space wrap>{log.hitPaths.map((path) => <Tag key={path}>{path}</Tag>)}{log.error && <Tag color="red">{log.error}</Tag>}</Space>}
                      />
                    </List.Item>
                  )}
                />
              )}
            </Card>
          </Space>
        )}
      </Modal>

      <Modal
        title="草稿详情"
        open={draftDetailOpen}
        width={920}
        onCancel={() => { setDraftDetailOpen(false); setActiveDraft(null); setActiveDraftDiff(null) }}
        footer={[
          <Button key="save" onClick={saveDraftDetail}>保存</Button>,
          <Button key="reject" danger disabled={!activeDraft || activeDraft.status !== 'pending'} onClick={() => activeDraft && rejectDraft(activeDraft)}>拒绝</Button>,
          <Button key="approve" type="primary" disabled={!activeDraft || activeDraft.status !== 'pending' || Boolean(activeDraftDiff?.error)} onClick={() => activeDraft && approveDraft(activeDraft)}>按当前策略合并</Button>,
        ]}
      >
        {activeDraft && (
          <Row gutter={16}>
            <Col xs={24} xl={10}>
              <Form form={draftEditForm} layout="vertical">
                <Form.Item name="targetPath" label="目标页面" rules={[{ required: true }]}>
                  <Input />
                </Form.Item>
                <Form.Item name="mergeStrategy" label="合并策略" rules={[{ required: true }]}>
                  <Select
                    onChange={(value) => {
                      setActiveDraftStrategy(value)
                      loadDraftDiff(activeDraft, value)
                    }}
                    options={[
                      { label: '追加到页面', value: 'append' },
                      { label: '覆盖页面', value: 'replace' },
                      { label: '仅创建新页面', value: 'createOnly' },
                    ]}
                  />
                </Form.Item>
                <Form.Item name="sourceRef" label="来源引用">
                  <Input />
                </Form.Item>
                <Form.Item name="content" label="Markdown 内容" rules={[{ required: true }]}>
                  <Input.TextArea rows={14} />
                </Form.Item>
              </Form>
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="来源">{sourceTypeLabel(activeDraft.sourceType)}{activeDraft.sourceRef ? ` / ${activeDraft.sourceRef}` : ''}</Descriptions.Item>
                <Descriptions.Item label="状态">{statusLabel(activeDraft.status)}</Descriptions.Item>
                <Descriptions.Item label="创建时间">{formatTime(activeDraft.createdAt)}</Descriptions.Item>
              </Descriptions>
            </Col>
            <Col xs={24} xl={14}>
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                {activeDraftDiff?.error && <Alert type="error" showIcon message={wikiErrorText(activeDraftDiff.error, '差异预览失败')} />}
                <Card size="small" title={`差异预览：${strategyLabel(activeDraftStrategy)}`}>
                  <Paragraph style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto', marginBottom: 0 }}>
                    {(activeDraftDiff?.diff ?? []).join('\n')}
                  </Paragraph>
                </Card>
                <Card size="small" title="合并后预览">
                  <Paragraph style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto', marginBottom: 0 }}>
                    {activeDraftDiff?.nextContent ?? activeDraft.content}
                  </Paragraph>
                </Card>
              </Space>
            </Col>
          </Row>
        )}
      </Modal>
    </div>
  )
}
