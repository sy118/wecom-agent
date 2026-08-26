import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Card, Descriptions, Table, Tag, Button, Space, message, Popconfirm } from 'antd'
import { runsApi } from '../api/index.js'

interface RunStage { id: string; stage: string; sequence: number; startedAt: number; endedAt: number | null; durationMs: number | null; meta: Record<string, any> | null }
interface Run { id: string; botId: string; chatKey: string; chatId: string; userId: string | null; questionPreview: string | null; answerPreview: string | null; provider: string; model: string | null; status: string; error: string | null; stallPoint: string | null; lastActivityAt: number | null; feedbackAvailable: boolean; createdAt: number; updatedAt: number; stages: RunStage[] }

const STAGE_LABELS: Record<string, string> = {
  queued: '排队', thinking: '思考中', tool: '调用工具', 'force-call-mcp': '强制检索', dify: '等待 Dify', model: '模型生成', done: '完成',
}

export default function RunDetailPage() {
  const { id } = useParams()
  const [run, setRun] = useState<Run | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    if (!id) return
    setLoading(true)
    try { setRun(await runsApi.get(id)) } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [id])

  const handleCancel = async () => {
    if (!run) return
    const result = await runsApi.cancel(run.id)
    if (result.ok) { message.success('已取消'); load() } else { message.warning(result.reason ?? '取消失败') }
  }

  const handleRetry = async () => {
    if (!run) return
    const result = await runsApi.retry(run.id)
    if (result.id) { message.success('已创建重试轨迹'); load() } else { message.warning(result.reason ?? '重试失败') }
  }

  const stageColumns = [
    { title: '序号', dataIndex: 'sequence', key: 'sequence', width: 70 },
    { title: '环节', dataIndex: 'stage', key: 'stage', render: (s: string) => <Tag color="blue">{STAGE_LABELS[s] ?? s}</Tag> },
    { title: '开始时间', dataIndex: 'startedAt', key: 'startedAt', render: (t: number) => new Date(t).toLocaleTimeString() },
    { title: '结束时间', dataIndex: 'endedAt', key: 'endedAt', render: (t: number | null) => t ? new Date(t).toLocaleTimeString() : '-' },
    { title: '耗时(ms)', dataIndex: 'durationMs', key: 'durationMs', render: (d: number | null) => d ?? '-' },
    { title: '附加信息', dataIndex: 'meta', key: 'meta', render: (m: Record<string, any> | null) => m ? JSON.stringify(m) : '-' },
  ]

  return (
    <div>
      <Space style={{ marginBottom: 16, justifyContent: 'space-between', width: '100%' }}>
        <h2 style={{ margin: 0 }}>在线回复轨迹：{run?.id ?? id}</h2>
        <Space>
          <Button onClick={load} loading={loading}>刷新</Button>
          <Popconfirm title="确认取消该在线回复？" onConfirm={handleCancel}>
            <Button danger disabled={!run || run.status === 'sent' || run.status === 'error'}>取消</Button>
          </Popconfirm>
          <Popconfirm title="确认重试失败的在线回复？" onConfirm={handleRetry}>
            <Button type="primary" disabled={!run || run.status === 'pending'}>重试</Button>
          </Popconfirm>
        </Space>
      </Space>
      <Card title="运行信息" style={{ marginBottom: 16 }}>
        <Descriptions column={2} size="small">
          <Descriptions.Item label="状态">{run?.status}</Descriptions.Item>
          <Descriptions.Item label="当前卡点">{run?.stallPoint ? STAGE_LABELS[run.stallPoint] ?? run.stallPoint : '-'}</Descriptions.Item>
          <Descriptions.Item label="最近活动">{run?.lastActivityAt ? new Date(run.lastActivityAt).toLocaleString() : '-'}</Descriptions.Item>
          <Descriptions.Item label="Bot ID">{run?.botId}</Descriptions.Item>
          <Descriptions.Item label="Chat Key">{run?.chatKey}</Descriptions.Item>
          <Descriptions.Item label="用户">{run?.userId}</Descriptions.Item>
          <Descriptions.Item label="Provider">{run?.provider}</Descriptions.Item>
          <Descriptions.Item label="Model">{run?.model ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="问题" span={2}>{run?.questionPreview ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="回答" span={2}>{run?.answerPreview ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="错误" span={2}>{run?.error ?? '-'}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Card title="阶段事件" size="small">
        <Table dataSource={run?.stages ?? []} columns={stageColumns} rowKey="id" size="small" loading={loading} pagination={false} />
      </Card>
    </div>
  )
}