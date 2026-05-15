import { useEffect, useState } from 'react'
import { Table, Button, Space, Tag, Modal, Form, Input, Switch, Select, message, Popconfirm, Typography, Segmented } from 'antd'
import { PlusOutlined, CalendarOutlined, ClockCircleOutlined } from '@ant-design/icons'
import { scheduledTasksApi, botsApi } from '../api/index.js'

interface ScheduledTask {
  id: string; botId: string | null; name: string; cronExpr: string; promptTemplate: string
  targetChatKey: string; targetChatId: string; targetChatName: string | null
  contextId: string | null; enabled: boolean
  lastRunAt: number | null; nextRunAt: number | null
}

interface Bot { id: string; name: string }
type ScheduleKind = 'daily' | 'workday' | 'weekly' | 'monthly'

interface ScheduleDraft {
  kind: ScheduleKind
  hour: number
  minute: number
  weekday: number
  dayOfMonth: number
}

const DEFAULT_SCHEDULE: ScheduleDraft = {
  kind: 'workday',
  hour: 9,
  minute: 0,
  weekday: 1,
  dayOfMonth: 1,
}

const WEEKDAY_OPTIONS = [
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
  { label: '周日', value: 0 },
]

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, value) => ({
  label: `${String(value).padStart(2, '0')} 时`,
  value,
}))

const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, value) => ({
  label: `${String(value).padStart(2, '0')} 分`,
  value,
}))

const DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => ({
  label: `${index + 1} 日`,
  value: index + 1,
}))

function formatTs(ts: number | null): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN')
}

function toCron(schedule: ScheduleDraft): string {
  const base = `${schedule.minute} ${schedule.hour}`
  if (schedule.kind === 'daily') return `${base} * * *`
  if (schedule.kind === 'workday') return `${base} * * 1-5`
  if (schedule.kind === 'weekly') return `${base} * * ${schedule.weekday}`
  return `${base} ${schedule.dayOfMonth} * *`
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function parseCron(cronExpr: string): ScheduleDraft {
  const [minuteRaw, hourRaw, dayRaw, monthRaw, weekdayRaw] = cronExpr.trim().split(/\s+/)
  const minute = clampNumber(Number(minuteRaw), 0, 59, DEFAULT_SCHEDULE.minute)
  const hour = clampNumber(Number(hourRaw), 0, 23, DEFAULT_SCHEDULE.hour)

  if (dayRaw === '*' && monthRaw === '*' && weekdayRaw === '*') {
    return { ...DEFAULT_SCHEDULE, kind: 'daily', hour, minute }
  }
  if (dayRaw === '*' && monthRaw === '*' && weekdayRaw === '1-5') {
    return { ...DEFAULT_SCHEDULE, kind: 'workday', hour, minute }
  }
  if (dayRaw === '*' && monthRaw === '*' && weekdayRaw !== undefined && weekdayRaw !== '*') {
    return {
      ...DEFAULT_SCHEDULE,
      kind: 'weekly',
      hour,
      minute,
      weekday: clampNumber(Number(weekdayRaw), 0, 6, DEFAULT_SCHEDULE.weekday),
    }
  }
  if (monthRaw === '*' && weekdayRaw === '*') {
    return {
      ...DEFAULT_SCHEDULE,
      kind: 'monthly',
      hour,
      minute,
      dayOfMonth: clampNumber(Number(dayRaw), 1, 31, DEFAULT_SCHEDULE.dayOfMonth),
    }
  }
  return { ...DEFAULT_SCHEDULE, hour, minute }
}

function describeSchedule(schedule: ScheduleDraft): string {
  const time = `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`
  if (schedule.kind === 'daily') return `每天 ${time} 执行`
  if (schedule.kind === 'workday') return `工作日 ${time} 执行`
  if (schedule.kind === 'weekly') {
    const weekday = WEEKDAY_OPTIONS.find((item) => item.value === schedule.weekday)?.label ?? '周一'
    return `每${weekday} ${time} 执行`
  }
  return `每月 ${schedule.dayOfMonth} 日 ${time} 执行`
}

function describeCron(cronExpr: string): string {
  return describeSchedule(parseCron(cronExpr))
}

export default function ScheduledTasksPage() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [bots, setBots] = useState<Bot[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editTask, setEditTask] = useState<ScheduledTask | null>(null)
  const [form] = Form.useForm()
  const [cronValue, setCronValue] = useState('0 9 * * 1-5')

  const load = async () => {
    setLoading(true)
    try {
      const [taskList, botList] = await Promise.all([
        scheduledTasksApi.list(),
        botsApi.list(),
      ])
      setTasks(taskList)
      setBots(botList)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleSave = async (values: any) => {
    try {
      const payload = { ...values, cronExpr: cronValue, botId: values.botId ?? null }
      if (editTask) {
        await scheduledTasksApi.update(editTask.id, payload)
        message.success('已更新')
      } else {
        await scheduledTasksApi.create(payload)
        message.success('已创建')
      }
      setModalOpen(false)
      form.resetFields()
      setEditTask(null)
      load()
    } catch (err: any) {
      message.error(err?.response?.data?.error ?? '保存失败')
    }
  }

  const handleDelete = async (id: string) => {
    await scheduledTasksApi.delete(id)
    message.success('已删除')
    load()
  }

  const handleToggle = async (task: ScheduledTask) => {
    await scheduledTasksApi.update(task.id, { enabled: !task.enabled })
    load()
  }

  const openEdit = (task: ScheduledTask) => {
    setEditTask(task)
    setCronValue(task.cronExpr)
    form.setFieldsValue(task)
    setModalOpen(true)
  }

  const openCreate = () => {
    setEditTask(null)
    setCronValue('0 9 * * 1-5')
    form.resetFields()
    setModalOpen(true)
  }

  const columns = [
    { title: '任务名称', dataIndex: 'name', key: 'name' },
    {
      title: '目标机器人', dataIndex: 'botId', key: 'botId',
      render: (botId: string | null) => {
        if (!botId) return <Tag>全部</Tag>
        const bot = bots.find((b) => b.id === botId)
        return <Tag color="blue">{bot?.name ?? botId}</Tag>
      }
    },
    {
      title: '执行时间', dataIndex: 'cronExpr', key: 'cronExpr',
      render: (v: string) => (
        <Space direction="vertical" size={2}>
          <span>{describeCron(v)}</span>
          <Typography.Text code>{v}</Typography.Text>
        </Space>
      )
    },
    { title: '目标群/用户', key: 'target',
      render: (_: any, t: ScheduledTask) => t.targetChatName ?? t.targetChatId },
    { title: '上次执行', dataIndex: 'lastRunAt', key: 'lastRunAt', render: formatTs },
    { title: '下次执行', dataIndex: 'nextRunAt', key: 'nextRunAt', render: formatTs },
    { title: '状态', dataIndex: 'enabled', key: 'enabled',
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '停用'}</Tag> },
    {
      title: '操作', key: 'actions',
      render: (_: any, task: ScheduledTask) => (
        <Space>
          <Button size="small" onClick={() => handleToggle(task)}>
            {task.enabled ? '停用' : '启用'}
          </Button>
          <Button size="small" onClick={() => openEdit(task)}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(task.id)}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      )
    },
  ]

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>定时任务</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建任务</Button>
      </div>
      <Table dataSource={tasks} columns={columns} rowKey="id" loading={loading} />

      <Modal title={editTask ? '编辑定时任务' : '新建定时任务'} open={modalOpen} width={640}
        onOk={() => form.submit()} onCancel={() => { setModalOpen(false); setEditTask(null) }}>
        <Form form={form} onFinish={handleSave} layout="vertical"
          initialValues={{ enabled: true, botId: null }}>
          <Form.Item name="name" label="任务名称" rules={[{ required: true }]}><Input /></Form.Item>

          <Form.Item name="botId" label="目标机器人"
            extra="留空则不绑定特定机器人">
            <Select
              allowClear
              placeholder="全部机器人"
              options={bots.map((b) => ({ label: b.name, value: b.id }))}
            />
          </Form.Item>

          <Form.Item label="执行时间" required>
            <ChineseSchedulePicker value={cronValue} onChange={setCronValue} />
          </Form.Item>

          <Form.Item name="promptTemplate" label="提示词模板" rules={[{ required: true }]}
            extra="任务触发时将此提示词发给 LLM，LLM 的回复将推送到目标群">
            <Input.TextArea rows={4} placeholder="例如：请生成今日工作摘要..." />
          </Form.Item>

          <Form.Item name="targetChatId" label="目标群/用户 ID" rules={[{ required: true }]}
            extra="群聊填 chatid，单聊填 userid">
            <Input placeholder="例如：wrXXXXXX 或 XXXXXXXX" />
          </Form.Item>

          <Form.Item name="targetChatName" label="群/用户名称（可选）">
            <Input placeholder="便于识别，不影响功能" />
          </Form.Item>

          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

function ChineseSchedulePicker({ value, onChange }: { value: string; onChange: (cronExpr: string) => void }) {
  const [draft, setDraft] = useState<ScheduleDraft>(() => parseCron(value))

  useEffect(() => {
    setDraft(parseCron(value))
  }, [value])

  const updateDraft = (next: Partial<ScheduleDraft>) => {
    const merged = { ...draft, ...next }
    setDraft(merged)
    onChange(toCron(merged))
  }

  return (
    <div className="schedule-picker">
      <Segmented
        block
        value={draft.kind}
        onChange={(kind) => updateDraft({ kind: kind as ScheduleKind })}
        options={[
          { label: '每天', value: 'daily' },
          { label: '工作日', value: 'workday' },
          { label: '每周', value: 'weekly' },
          { label: '每月', value: 'monthly' },
        ]}
      />

      <div className="schedule-picker-row">
        <Space wrap>
          <span className="schedule-picker-label"><ClockCircleOutlined /> 时间</span>
          <Select value={draft.hour} options={HOUR_OPTIONS} onChange={(hour) => updateDraft({ hour })} style={{ width: 104 }} />
          <Select value={draft.minute} options={MINUTE_OPTIONS} onChange={(minute) => updateDraft({ minute })} style={{ width: 104 }} />
          {draft.kind === 'weekly' && (
            <>
              <span className="schedule-picker-label"><CalendarOutlined /> 星期</span>
              <Select value={draft.weekday} options={WEEKDAY_OPTIONS} onChange={(weekday) => updateDraft({ weekday })} style={{ width: 112 }} />
            </>
          )}
          {draft.kind === 'monthly' && (
            <>
              <span className="schedule-picker-label"><CalendarOutlined /> 日期</span>
              <Select value={draft.dayOfMonth} options={DAY_OPTIONS} onChange={(dayOfMonth) => updateDraft({ dayOfMonth })} style={{ width: 104 }} />
            </>
          )}
        </Space>
      </div>

      <div className="schedule-preview">
        <span>{describeSchedule(draft)}</span>
        <Typography.Text code>{toCron(draft)}</Typography.Text>
      </div>
    </div>
  )
}
