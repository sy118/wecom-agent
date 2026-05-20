import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, InputHTMLAttributes } from 'react'
import { Alert, Button, Empty, Modal, Popconfirm, Space, Switch, Table, Tag, message } from 'antd'
import {
  DeleteOutlined,
  EyeOutlined,
  HistoryOutlined,
  InboxOutlined,
  ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { skillAuditApi, skillsApi } from '../api/index.js'

interface SkillResourceIndex {
  skillMdPath: string
  scripts: string[]
  references: string[]
  assets: string[]
  otherFiles: string[]
  totalFiles: number
  totalBytes: number
}

interface SkillDefinition {
  id: string
  name: string
  description: string
  enabled: boolean
  bundleHash: string
  resourceIndex: SkillResourceIndex
  permissionPolicy: {
    scriptsEnabled?: boolean
    timeoutMs?: number
    maxOutputBytes?: number
    maxConcurrentRuns?: number
  }
  createdAt: number
}

interface SkillAuditRecord {
  id: string
  status: string
  durationMs: number
  contextId: string | null
  chatKey: string | null
  inputPreview: string | null
  outputPreview: string | null
  error: string | null
  createdAt: number
}

interface SelectedSkillFile {
  uid: string
  name: string
  relativePath: string
  size: number
  file: File
}

const emptyResourceIndex: SkillResourceIndex = {
  skillMdPath: 'SKILL.md',
  scripts: [],
  references: [],
  assets: [],
  otherFiles: [],
  totalFiles: 0,
  totalBytes: 0,
}

const directoryInputProps = {
  webkitdirectory: '',
  directory: '',
} as unknown as InputHTMLAttributes<HTMLInputElement>

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function getResourceIndex(skill: SkillDefinition): SkillResourceIndex {
  const index = (skill.resourceIndex ?? {}) as Partial<SkillResourceIndex>
  const scripts = stringArray(index.scripts)
  const references = stringArray(index.references)
  const assets = stringArray(index.assets)
  const otherFiles = stringArray(index.otherFiles)
  return {
    ...emptyResourceIndex,
    ...index,
    skillMdPath: typeof index.skillMdPath === 'string' && index.skillMdPath ? index.skillMdPath : emptyResourceIndex.skillMdPath,
    scripts,
    references,
    assets,
    otherFiles,
    totalFiles: typeof index.totalFiles === 'number'
      ? index.totalFiles
      : scripts.length + references.length + assets.length + otherFiles.length,
    totalBytes: typeof index.totalBytes === 'number' ? index.totalBytes : 0,
  }
}

function normalizeSkill(skill: SkillDefinition): SkillDefinition {
  return {
    ...skill,
    bundleHash: skill.bundleHash ?? '',
    resourceIndex: getResourceIndex(skill),
    permissionPolicy: skill.permissionPolicy ?? {},
  }
}

function makeSelectedFile(file: File, relativePath: string): SelectedSkillFile {
  const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '') || file.name
  return {
    uid: `${normalizedPath}:${file.size}:${file.lastModified}`,
    name: file.name,
    relativePath: normalizedPath,
    size: file.size,
    file,
  }
}

function nativeFilesToSelection(files: FileList | File[]): SelectedSkillFile[] {
  return Array.from(files).map((file) => {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    return makeSelectedFile(file, relativePath)
  })
}

async function readDirectoryEntries(reader: any): Promise<any[]> {
  const entries: any[] = []
  for (;;) {
    const batch = await new Promise<any[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (batch.length === 0) return entries
    entries.push(...batch)
  }
}

async function readDroppedEntry(entry: any): Promise<SelectedSkillFile[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject))
    return [makeSelectedFile(file, entry.fullPath || file.name)]
  }
  if (!entry.isDirectory) return []
  const reader = entry.createReader()
  const entries = await readDirectoryEntries(reader)
  const nested = await Promise.all(entries.map(readDroppedEntry))
  return nested.flat()
}

function dedupeFiles(files: SelectedSkillFile[]): SelectedSkillFile[] {
  const seen = new Set<string>()
  const result: SelectedSkillFile[] = []
  for (const file of files) {
    if (seen.has(file.relativePath)) continue
    seen.add(file.relativePath)
    result.push(file)
  }
  return result.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

function resourceTags(skill: SkillDefinition) {
  const index = getResourceIndex(skill)
  return (
    <Space size={[4, 4]} wrap>
      <Tag>文件 {index.totalFiles}</Tag>
      <Tag color={index.scripts.length ? 'cyan' : 'default'}>scripts {index.scripts.length}</Tag>
      <Tag color={index.references.length ? 'geekblue' : 'default'}>references {index.references.length}</Tag>
      <Tag color={index.assets.length ? 'purple' : 'default'}>assets {index.assets.length}</Tag>
    </Space>
  )
}

export default function SkillsPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [skills, setSkills] = useState<SkillDefinition[]>([])
  const [fileList, setFileList] = useState<SelectedSkillFile[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [skillMd, setSkillMd] = useState('')
  const [auditOpen, setAuditOpen] = useState(false)
  const [audits, setAudits] = useState<SkillAuditRecord[]>([])
  const [activeSkill, setActiveSkill] = useState<SkillDefinition | null>(null)

  const summary = useMemo(() => ({
    total: skills.length,
    enabled: skills.filter((item) => item.enabled).length,
    scripts: skills.reduce((sum, item) => sum + getResourceIndex(item).scripts.length, 0),
  }), [skills])

  const load = async () => {
    setLoading(true)
    try {
      const nextSkills = await skillsApi.list()
      setSkills(Array.isArray(nextSkills) ? nextSkills.map(normalizeSkill) : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const replaceSelectedFiles = (files: SelectedSkillFile[]) => {
    const next = dedupeFiles(files)
    setFileList(next)
    if (next.length === 0) message.warning('没有读取到文件')
  }

  const handleNativeFiles = (event: ChangeEvent<HTMLInputElement>) => {
    replaceSelectedFiles(nativeFilesToSelection(event.target.files ?? []))
    event.target.value = ''
  }

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    const entries = Array.from(event.dataTransfer.items ?? [])
      .map((item) => (item as any).webkitGetAsEntry?.())
      .filter(Boolean)
    if (entries.length > 0) {
      const nested = await Promise.all(entries.map(readDroppedEntry))
      replaceSelectedFiles(nested.flat())
      return
    }
    replaceSelectedFiles(nativeFilesToSelection(event.dataTransfer.files ?? []))
  }

  const handleUpload = async () => {
    if (fileList.length === 0) return
    const hasSkillMd = fileList.some((file) => file.relativePath === 'SKILL.md' || file.relativePath.endsWith('/SKILL.md'))
    if (!hasSkillMd) {
      message.error('文件夹中必须包含 SKILL.md')
      return
    }
    const form = new FormData()
    for (const item of fileList) {
      form.append('files', item.file, item.relativePath)
    }
    setUploading(true)
    try {
      await skillsApi.upload(form)
      message.success('技能包文件夹已上传')
      setFileList([])
      await load()
    } catch (err: any) {
      message.error(err?.response?.data?.error ?? '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const updateSkill = async (skill: SkillDefinition, data: unknown) => {
    await skillsApi.update(skill.id, data)
    await load()
  }

  const openPreview = async (skill: SkillDefinition) => {
    setActiveSkill(skill)
    setSkillMd(await skillsApi.skillMd(skill.id))
    setPreviewOpen(true)
  }

  const openAudit = async (skill: SkillDefinition) => {
    setActiveSkill(skill)
    setAudits(await skillAuditApi.list(skill.id))
    setAuditOpen(true)
  }

  const handleDelete = async (skill: SkillDefinition) => {
    await skillsApi.delete(skill.id)
    message.success('技能包已删除')
    await load()
  }

  const columns = [
    {
      title: '技能包',
      key: 'skill',
      render: (_: unknown, skill: SkillDefinition) => (
        <div>
          <div style={{ fontWeight: 600 }}>{skill.name}</div>
          <div style={{ color: '#666', maxWidth: 520 }}>{skill.description}</div>
        </div>
      ),
    },
    {
      title: '资源',
      key: 'resources',
      render: (_: unknown, skill: SkillDefinition) => resourceTags(skill),
    },
    {
      title: '脚本权限',
      key: 'scripts',
      render: (_: unknown, skill: SkillDefinition) => {
        const hasScripts = getResourceIndex(skill).scripts.length > 0
        return (
          <Switch
            size="small"
            disabled={!hasScripts}
            checked={Boolean(skill.permissionPolicy?.scriptsEnabled)}
            onChange={(scriptsEnabled) => updateSkill(skill, {
              permissionPolicy: { ...(skill.permissionPolicy ?? {}), scriptsEnabled },
            })}
          />
        )
      },
    },
    {
      title: '启用',
      key: 'enabled',
      render: (_: unknown, skill: SkillDefinition) => (
        <Switch size="small" checked={skill.enabled} onChange={(enabled) => updateSkill(skill, { enabled })} />
      ),
    },
    {
      title: 'Hash',
      dataIndex: 'bundleHash',
      key: 'bundleHash',
      render: (value: string | null | undefined) => <code>{value ? value.slice(0, 10) : '-'}</code>,
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, skill: SkillDefinition) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => openPreview(skill)}>预览</Button>
          <Button size="small" icon={<HistoryOutlined />} onClick={() => openAudit(skill)}>审计</Button>
          <Popconfirm title="确认删除这个技能包？" onConfirm={() => handleDelete(skill)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div className="skills-page">
      <div className="skill-page-header">
        <div className="skill-title-icon"><UploadOutlined /></div>
        <div className="skill-heading">
          <h2 style={{ margin: 0 }}>技能包</h2>
          <div style={{ color: '#666' }}>全局技能能力包，可在上下文中按需启用</div>
        </div>
        <div className="skill-counts">
          <span className="skill-count-pill">全部 {summary.total}</span>
          <span className="skill-count-pill">启用 {summary.enabled}</span>
          <span className="skill-count-pill">脚本 {summary.scripts}</span>
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
        </div>
      </div>

      <Alert
        type="info"
        showIcon
        message="上传包含顶层 SKILL.md 的文件夹。安装后可在任意机器人的上下文配置中启用。"
      />

      <div
        className={`skill-upload-dropzone${dragging ? ' is-dragging' : ''}`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={handleNativeFiles}
          {...directoryInputProps}
        />
        <InboxOutlined className="skill-upload-icon" />
        <div className="skill-upload-title">选择或拖入技能包文件夹</div>
        <div className="skill-upload-subtitle">目录中必须包含顶层 SKILL.md，可选包含 scripts、references、assets。</div>
      </div>

      {fileList.length > 0 && (
        <div className="skill-upload-selection">
          <Space wrap>
            <Tag color="blue">{fileList.length} 个文件</Tag>
            <Tag>{Math.ceil(fileList.reduce((sum, item) => sum + item.size, 0) / 1024)} KB</Tag>
            <Button size="small" onClick={() => setFileList([])}>清空</Button>
          </Space>
          <div className="skill-upload-files">
            {fileList.slice(0, 8).map((file) => <code key={file.uid}>{file.relativePath}</code>)}
            {fileList.length > 8 && <span>还有 {fileList.length - 8} 个文件</span>}
          </div>
        </div>
      )}

      <Button
        type="primary"
        icon={<UploadOutlined />}
        disabled={fileList.length === 0}
        loading={uploading}
        onClick={handleUpload}
      >
        上传技能包文件夹
      </Button>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={skills}
        columns={columns}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有技能包" /> }}
      />

      <Modal
        title={`${activeSkill?.name ?? '技能包'} / SKILL.md`}
        open={previewOpen}
        width={820}
        footer={null}
        onCancel={() => setPreviewOpen(false)}
      >
        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 560, overflow: 'auto' }}>{skillMd}</pre>
      </Modal>

      <Modal
        title={`${activeSkill?.name ?? '技能包'} 的脚本审计`}
        open={auditOpen}
        width={980}
        footer={null}
        onCancel={() => setAuditOpen(false)}
      >
        <Table
          size="small"
          rowKey="id"
          dataSource={audits}
          columns={[
            { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => <Tag>{v}</Tag> },
            { title: '耗时', dataIndex: 'durationMs', key: 'durationMs', render: (v: number) => `${v}ms` },
            { title: '上下文', dataIndex: 'contextId', key: 'contextId' },
            { title: 'chatKey', dataIndex: 'chatKey', key: 'chatKey' },
            { title: '输入', dataIndex: 'inputPreview', key: 'inputPreview', ellipsis: true },
            { title: '输出', dataIndex: 'outputPreview', key: 'outputPreview', ellipsis: true },
            { title: '错误', dataIndex: 'error', key: 'error', ellipsis: true },
          ]}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无审计记录" /> }}
        />
      </Modal>
    </div>
  )
}
