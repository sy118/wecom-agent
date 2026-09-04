import { useEffect, useState } from 'react'
import { Table, Card, Space, Tag, Input, Select, Button, message, Descriptions, Drawer, Tabs, Upload } from 'antd'
import { SearchOutlined, DownloadOutlined, UploadOutlined } from '@ant-design/icons'
import { templatesApi } from '../api/index.js'

interface Template {
  id: string
  name: string
  description: string
  category: string
  author: string | null
  status: string
  tenantId: string
  currentVersion: number
  usageCount: number
  createdAt: number
  updatedAt: number
}

interface TemplateRevision { id: string; templateId: string; version: number; manifest: any; createdAt: number }

export default function TemplateMarketPage() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<Template & { revisions?: TemplateRevision[] } | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const load = async (refreshCategories = false) => {
    setLoading(true)
    try {
      const list = await templatesApi.list({ search: search || undefined, category })
      setTemplates(list)
      // 保留完整分类列表；筛选某一分类后不能让其它分类选项消失。
      if (refreshCategories || categories.length === 0) {
        const categorySource = refreshCategories && (search || category)
          ? await templatesApi.list()
          : list
        setCategories(Array.from(new Set(categorySource.map((t: Template) => t.category))))
      }
    } finally { setLoading(false) }
  }

  useEffect(() => { load(true) }, [category])

  const openDetail = async (template: Template) => {
    const detailData = await templatesApi.get(template.id)
    setDetail(detailData)
    setDrawerOpen(true)
  }

  const handleExport = async (id: string) => {
    const data = await templatesApi.export(id)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${data.template?.name ?? 'template'}.json`
    a.click()
    URL.revokeObjectURL(url)
    message.success('已导出模板 JSON')
  }

  const handleImport = async (file: File) => {
    try {
      const text = await file.text()
      const payload = JSON.parse(text)
      await templatesApi.import(payload)
      message.success('模板导入成功')
      load()
    } catch (error: any) {
      message.error(error?.response?.data?.error ?? '模板格式不合法')
    }
    return false
  }

  const columns = [
    { title: '模板名称', dataIndex: 'name', key: 'name' },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    { title: '分类', dataIndex: 'category', key: 'category', render: (v: string) => <Tag color="blue">{v}</Tag> },
    { title: '版本', dataIndex: 'currentVersion', key: 'currentVersion', render: (v: number) => <Tag>v{v}</Tag> },
    { title: '使用次数', dataIndex: 'usageCount', key: 'usageCount' },
    { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', render: (v: number) => new Date(v).toLocaleString() },
    {
      title: '操作', key: 'actions',
      render: (_: any, t: Template) => (
        <Space>
          <Button size="small" onClick={() => openDetail(t)}>详情</Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={() => handleExport(t.id)}>导出</Button>
        </Space>
      ),
    },
  ]

  return (
    <Card title="模板市场" extra={
      <Space>
        <Input
          placeholder="搜索模板"
          prefix={<SearchOutlined />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onPressEnter={() => load()}
          allowClear
          style={{ width: 220 }}
        />
        <Select
          placeholder="全部分类"
          allowClear
          style={{ width: 140 }}
          value={category}
          onChange={setCategory}
          options={categories.map((c) => ({ label: c, value: c }))}
        />
        <Button type="primary" onClick={() => load()}>搜索</Button>
        <Upload accept=".json" showUploadList={false} beforeUpload={(file) => handleImport(file as File)}>
          <Button icon={<UploadOutlined />}>导入模板</Button>
        </Upload>
      </Space>
    }>
      <Table rowKey="id" loading={loading} columns={columns} dataSource={templates} pagination={{ pageSize: 10 }} />
      <Drawer title={detail?.name ?? '模板详情'} open={drawerOpen} onClose={() => setDrawerOpen(false)} width={640}>
        {detail && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="名称">{detail.name}</Descriptions.Item>
              <Descriptions.Item label="描述">{detail.description}</Descriptions.Item>
              <Descriptions.Item label="分类"><Tag color="blue">{detail.category}</Tag></Descriptions.Item>
              <Descriptions.Item label="作者">{detail.author ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="使用次数">{detail.usageCount}</Descriptions.Item>
            </Descriptions>
            <Tabs
              items={[{
                key: 'versions',
                label: '版本历史',
                children: (
                  <Table
                    rowKey="id"
                    size="small"
                    pagination={false}
                    dataSource={detail.revisions ?? []}
                    columns={[
                      { title: '版本', dataIndex: 'version', render: (v: number) => <Tag>v{v}</Tag> },
                      { title: '触发词', dataIndex: ['manifest', 'triggers'], render: (v: string[]) => (v ?? []).map((t) => <Tag key={t}>{t}</Tag>) },
                      { title: '发布时间', dataIndex: 'createdAt', render: (v: number) => new Date(v).toLocaleString() },
                    ]}
                  />
                ),
              }, {
                key: 'manifest',
                label: '声明 JSON',
                children: <pre style={{ fontSize: 12, maxHeight: 480, overflow: 'auto' }}>{JSON.stringify(detail.revisions?.[0]?.manifest ?? {}, null, 2)}</pre>,
              }]}
            />
          </Space>
        )}
      </Drawer>
    </Card>
  )
}
