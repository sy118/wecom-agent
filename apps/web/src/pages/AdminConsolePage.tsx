import { useEffect, useState } from 'react'
import { Card, Tabs, Table, Tag, Button, Space, message, Statistic, Row, Col, Popconfirm } from 'antd'
import { DownloadOutlined, SafetyOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons'
import { adminApi, approvalsApi } from '../api/index.js'

interface UsageRow {
  tenantId: string
  botId: string | null
  skillId: string | null
  templateId: string | null
  taskCount: number
  successCount: number
  successRate: number
  totalDurationMs: number
  cost: number
}

export default function AdminConsolePage() {
  const [summary, setSummary] = useState<any>(null)
  const [approvals, setApprovals] = useState<any[]>([])
  const [auditRows, setAuditRows] = useState<any[]>([])
  const [usage, setUsage] = useState<{ byBot: UsageRow[]; byTemplate: UsageRow[]; total: UsageRow | null; templateRanking: UsageRow[] }>({ byBot: [], byTemplate: [], total: null, templateRanking: [] })

  const loadAll = async () => {
    const [summaryData, approvalsData, auditData, usageData] = await Promise.all([
      adminApi.summary(),
      approvalsApi.list('pending'),
      adminApi.auditLogs({ limit: 100 }),
      adminApi.usage({}),
    ])
    setSummary(summaryData)
    setApprovals(approvalsData)
    setAuditRows(auditData.rows ?? auditData ?? [])
    setUsage(usageData)
  }

  useEffect(() => { loadAll() }, [])

  const decide = async (id: string, approve: boolean) => {
    const data = approve
      ? await approvalsApi.approve(id, { approverUserId: 'admin' })
      : await approvalsApi.reject(id, { approverUserId: 'admin', reason: '管理员拒绝' })
    message.success(data?.status === 'approved' ? '已通过' : data?.status === 'rejected' ? '已拒绝' : '操作完成')
    loadAll()
  }

  const handleExport = async () => {
    const blob = await adminApi.auditExport()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
    message.success('审计日志已导出')
  }

  const approvalColumns = [
    { title: '工具', dataIndex: 'toolName', key: 'toolName', render: (v: string) => <Tag>{v}</Tag> },
    { title: '范围', dataIndex: 'scope', key: 'scope' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => <Tag color={v === 'pending' ? 'orange' : v === 'approved' ? 'green' : 'red'}>{v}</Tag> },
    { title: '申请人', dataIndex: 'requesterUserId', key: 'requesterUserId', render: (v: string | null) => v ?? '-' },
    { title: '时间', dataIndex: 'createdAt', key: 'createdAt', render: (v: number) => new Date(v).toLocaleString() },
    {
      title: '操作', key: 'actions',
      render: (_: any, r: any) => r.status === 'pending' ? (
        <Space>
          <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => decide(r.id, true)}>通过</Button>
          <Popconfirm title="确认拒绝该审批？" onConfirm={() => decide(r.id, false)}>
            <Button size="small" danger icon={<CloseOutlined />}>拒绝</Button>
          </Popconfirm>
        </Space>
      ) : null,
    },
  ]

  const auditColumns = [
    { title: '动作', dataIndex: 'action', key: 'action', render: (v: string) => <Tag color="geekblue">{v}</Tag> },
    { title: '操作者', dataIndex: 'actorUserId', key: 'actorUserId', render: (v: string | null) => v ?? '-' },
    { title: '对象', dataIndex: 'targetType', key: 'targetType', render: (v: string | null, r: any) => v ? `${v}:${r.targetId ?? ''}` : '-' },
    { title: '结果', dataIndex: 'result', key: 'result', render: (v: string) => <Tag color={v === 'success' ? 'green' : v === 'denied' ? 'red' : 'orange'}>{v}</Tag> },
    { title: '说明', dataIndex: 'reason', key: 'reason', ellipsis: true },
    { title: '时间', dataIndex: 'createdAt', key: 'createdAt', render: (v: number) => new Date(v).toLocaleString() },
  ]

  const usageColumns = (dimension: keyof Pick<UsageRow, 'botId' | 'templateId' | 'skillId'>) => [
    { title: dimension === 'botId' ? 'Bot' : dimension === 'templateId' ? '模板' : '技能', dataIndex: dimension, key: dimension, render: (v: string | null) => v ?? '全部' },
    { title: '任务量', dataIndex: 'taskCount', key: 'taskCount' },
    { title: '成功数', dataIndex: 'successCount', key: 'successCount' },
    { title: '成功率', dataIndex: 'successRate', key: 'successRate', render: (v: number) => `${(v * 100).toFixed(1)}%` },
    { title: '总耗时(ms)', dataIndex: 'totalDurationMs', key: 'totalDurationMs' },
    { title: '费用', dataIndex: 'cost', key: 'cost', render: (v: number) => `¥${v.toFixed(4)}` },
  ]

  return (
    <Card title={<Space><SafetyOutlined />管理员控制台</Space>}>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}><Card><Statistic title="Bot 数量" value={summary?.botCount ?? 0} /></Card></Col>
        <Col span={6}><Card><Statistic title="租户数量" value={summary?.tenants?.length ?? 0} /></Card></Col>
        <Col span={6}><Card><Statistic title="待审批" value={summary?.pendingApprovals ?? 0} /></Card></Col>
        <Col span={6}><Card><Statistic title="启用 MCP 工具" value={summary?.enabledMcpTools ?? 0} /></Card></Col>
      </Row>
      <Tabs items={[
        {
          key: 'approvals',
          label: '审批中心',
          children: <Table rowKey="id" dataSource={approvals} columns={approvalColumns} pagination={{ pageSize: 10 }} />,
        },
        {
          key: 'audit',
          label: '审计日志',
          children: (
            <>
              <Space style={{ marginBottom: 16 }}>
                <Button icon={<DownloadOutlined />} onClick={handleExport}>导出 CSV</Button>
              </Space>
              <Table rowKey="id" dataSource={auditRows} columns={auditColumns} pagination={{ pageSize: 10 }} />
            </>
          ),
        },
        {
          key: 'usage',
          label: '用量统计',
          children: (
            <>
              <DividerWithTitle title="按 Bot" />
              <Table rowKey={(r: UsageRow) => r.botId ?? 'all'} dataSource={usage.byBot} columns={usageColumns('botId')} pagination={false} />
              <DividerWithTitle title="按模板" />
              <Table rowKey={(r: UsageRow) => r.templateId ?? 'all'} dataSource={usage.byTemplate} columns={usageColumns('templateId')} pagination={false} />
              {usage.total && (
                <>
                  <DividerWithTitle title="租户合计" />
                  <Table rowKey="total" dataSource={[usage.total]} columns={usageColumns('botId')} pagination={false} />
                </>
              )}
            </>
          ),
        },
      ]} />
    </Card>
  )
}

function DividerWithTitle({ title }: { title: string }) {
  return <div style={{ margin: '16px 0 8px', fontWeight: 600 }}>{title}</div>
}
