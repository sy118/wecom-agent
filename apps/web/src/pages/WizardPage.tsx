import { useEffect, useState } from 'react'
import { Card, Steps, Form, Input, Select, Switch, Space, Button, message, Alert, Tag, Divider } from 'antd'
import { RobotOutlined, SaveOutlined, SendOutlined, CheckOutlined } from '@ant-design/icons'
import { wizardApi, templatesApi, wecomMcpApi } from '../api/index.js'

const STEP_LABELS = ['基础信息', '模型选择', '技能/模板', '触发与免打扰', '测试']

export default function WizardPage() {
  const [step, setStep] = useState(0)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [templates, setTemplates] = useState<any[]>([])
  const [mcpTools, setMcpTools] = useState<any[]>([])
  const [testPrompt, setTestPrompt] = useState('')
  const [testResult, setTestResult] = useState<{ reply: string; stages: any[] } | null>(null)
  const [form] = Form.useForm()

  useEffect(() => {
    Promise.all([templatesApi.list(), wecomMcpApi.tools()]).then(([ts, tools]) => {
      setTemplates(ts)
      setMcpTools(tools)
    }).catch(() => {})
    wizardApi.draft().then((d) => {
      if (d?.id) {
        setDraftId(d.id)
        setStep(Math.min(d.step - 1, 4))
        form.setFieldsValue(d.data ?? {})
      }
    }).catch(() => {})
  }, [])

  const saveDraft = async (nextStep?: number) => {
    const values = form.getFieldsValue()
    const saved = await wizardApi.saveDraft({
      id: draftId,
      step: (nextStep ?? step) + 1,
      data: values,
    })
    setDraftId(saved.id)
    message.success('草稿已保存，可随时继续')
  }

  const goNext = async () => {
    await saveDraft(step + 1)
    setStep((s) => Math.min(s + 1, 4))
  }

  const handleSubmit = async () => {
    const values = form.getFieldsValue()
    try {
      const result = await wizardApi.submit({
        name: values.name,
        description: values.description,
        model: values.model,
        skills: values.skills ?? [],
        templateId: values.templateId ?? null,
        triggers: values.triggers ?? [],
        mentionOnly: Boolean(values.mentionOnly),
        doNotDisturbWindows: values.doNotDisturbWindows
          ? String(values.doNotDisturbWindows).split(',').map((s: string) => s.trim()).filter(Boolean)
          : [],
        draftId,
      })
      message.success(`Bot「${result.bot?.name ?? ''}」已创建，进入启用环节即可使用`)
      setTestResult(null)
      setDraftId(null)
      form.resetFields()
      setStep(0)
    } catch (error: any) {
      const errors = error?.response?.data?.errors
      message.error(errors ? `校验未通过：${errors.map((e: any) => e.message ?? e).join('；')}` : (error?.response?.data?.error ?? '提交失败'))
    }
  }

  const handleTest = async () => {
    if (!testPrompt.trim()) { message.warning('请输入测试消息'); return }
    const values = form.getFieldsValue()
    try {
      const result = await wizardApi.test({
        name: values.name ?? '测试 Bot',
        model: values.model ?? null,
        skills: values.skills ?? [],
        templateId: values.templateId ?? null,
        triggers: values.triggers ?? [],
      })
      setTestResult(result)
    } catch (error: any) {
      const errors = error?.response?.data?.errors
      message.error(errors ? `校验未通过：${errors.map((e: any) => e.message ?? e).join('；')}` : '测试失败')
    }
  }

  const modelOptions = [
    { label: 'MiniMax-M2.5（默认）', value: 'MiniMax-M2.5' },
    { label: 'DeepSeek-V3', value: 'deepseek-chat' },
    { label: 'GPT-4o-mini', value: 'gpt-4o-mini' },
  ]

  return (
    <Card title={<Space><RobotOutlined />零门槛配置向导</Space>} extra={
      <Button icon={<SaveOutlined />} onClick={() => saveDraft()}>保存草稿</Button>
    }>
      <Steps current={step} items={STEP_LABELS.map((label) => ({ title: label }))} style={{ marginBottom: 24 }} />
      <Form form={form} layout="vertical" initialValues={{ name: '', model: { provider: 'openai-compatible', model: 'MiniMax-M2.5' }, mentionOnly: false }}>
        {step === 0 && (
          <>
            <Form.Item name="name" label="Bot 名称" rules={[{ required: true, message: '请输入名称' }]}>
              <Input placeholder="例如：订单小助手" />
            </Form.Item>
            <Form.Item name="description" label="描述">
              <Input.TextArea placeholder="这个 Bot 用来做什么？" rows={3} />
            </Form.Item>
          </>
        )}
        {step === 1 && (
          <Form.Item name={['model', 'model']} label="模型" rules={[{ required: true, message: '请选择模型' }]}>
            <Select options={modelOptions} />
          </Form.Item>
        )}
        {step === 2 && (
          <>
            <Form.Item name="templateId" label="选择内置模板（可选）">
              <Select
                allowClear
                placeholder="从模板市场选择"
                options={templates.map((t) => ({ label: `${t.name}（v${t.currentVersion}）`, value: t.id }))}
              />
            </Form.Item>
            <Form.Item name="skills" label="技能包（可选）">
              <Select mode="tags" placeholder="输入技能名称" />
            </Form.Item>
            <Divider plain>已授权企微 MCP 工具（{mcpTools.length}）</Divider>
            <Space wrap>
              {mcpTools.map((t) => (
                <Tag key={`${t.module}.${t.name}`} color={t.write ? 'orange' : 'green'}>
                  {t.module}.{t.name}{t.write ? '（写）' : ''}
                </Tag>
              ))}
            </Space>
          </>
        )}
        {step === 3 && (
          <>
            <Form.Item name="triggers" label="触发词" rules={[{ required: true, message: '至少一个触发词' }]}>
              <Select mode="tags" placeholder="输入后回车，例如：查订单" />
            </Form.Item>
            <Form.Item name="mentionOnly" label="点名才回（群聊）" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="doNotDisturbWindows" label="免打扰时段（HH:mm-HH:mm，逗号分隔）">
              <Input placeholder="例如：22:00-08:00,12:00-13:00" />
            </Form.Item>
          </>
        )}
        {step === 4 && (
          <>
            <Alert type="info" showIcon message="测试消息只会返回回复与阶段心跳，不会写入生产会话。" style={{ marginBottom: 16 }} />
            <Space.Compact style={{ width: '100%' }}>
              <Input value={testPrompt} onChange={(e) => setTestPrompt(e.target.value)} placeholder="输入测试消息，例如：帮我查一下订单 12345" onPressEnter={handleTest} />
              <Button type="primary" icon={<SendOutlined />} onClick={handleTest}>发送测试</Button>
            </Space.Compact>
            {testResult && (
              <Card size="small" style={{ marginTop: 16 }}>
                <Space direction="vertical">
                  <div><strong>回复：</strong>{testResult.reply}</div>
                  <div><strong>阶段：</strong>{testResult.stages?.map((s: any, i: number) => <Tag key={i}>{s.stage}:{s.status}</Tag>)}</div>
                </Space>
              </Card>
            )}
          </>
        )}
      </Form>
      <Space style={{ marginTop: 24 }}>
        {step > 0 && <Button onClick={() => setStep((s) => s - 1)}>上一步</Button>}
        {step < 4 ? (
          <Button type="primary" onClick={goNext}>下一步</Button>
        ) : (
          <Button type="primary" icon={<CheckOutlined />} onClick={handleSubmit}>完成创建</Button>
        )}
      </Space>
    </Card>
  )
}
