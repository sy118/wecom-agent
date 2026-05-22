import { useEffect, useState } from 'react'
import { Table, Button, Space, Modal, Form, Input, Select, Switch, message, Popconfirm, Tag, Divider } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { mcpServersApi } from '../api/index.js'

interface ParamSchemaItem { key: string; label: string; type: 'string' | 'string[]' | 'number' | 'boolean'; description?: string }
interface McpServer {
  id: string
  name: string
  url: string | null
  transportType: 'sse' | 'stdio' | 'streamable-http'
  enabled: boolean
  command?: string | null
  args?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
  paramSchema?: ParamSchemaItem[]
}

export default function McpServersPage() {
  const [servers, setServers] = useState<McpServer[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editServer, setEditServer] = useState<McpServer | null>(null)
  const [form] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try { setServers(await mcpServersApi.list()) } finally { setLoading(false) }
  }

  const parseJsonField = (value: unknown, fallback: unknown, validate: (parsed: unknown) => boolean, label: string) => {
    if (value === undefined || value === null || value === '') return fallback
    if (typeof value !== 'string') return value
    try {
      const parsed = JSON.parse(value)
      if (!validate(parsed)) throw new Error()
      return parsed
    } catch {
      throw new Error(`${label} JSON 格式不正确`)
    }
  }

  const isStringRecord = (parsed: unknown) => !!parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.values(parsed).every((item) => typeof item === 'string')

  const openEdit = (server: McpServer) => {
    setEditServer(server)
    form.setFieldsValue({
      ...server,
      argsJson: JSON.stringify(server.args ?? [], null, 2),
      envJson: JSON.stringify(server.env ?? {}, null, 2),
      headersJson: JSON.stringify(server.headers ?? {}, null, 2),
    })
    setModalOpen(true)
  }

  const openCreate = () => {
    setEditServer(null)
    form.resetFields()
    form.setFieldsValue({ transportType: 'sse', enabled: true, argsJson: '[]', envJson: '{}', headersJson: '{}' })
    setModalOpen(true)
  }

  const connectionSummary = (server: McpServer) => {
    if (server.transportType === 'stdio') {
      const args = server.args?.length ? ` ${server.args.join(' ')}` : ''
      return `${server.command ?? ''}${args}`.trim()
    }
    return server.url ?? ''
  }

  useEffect(() => { load() }, [])

  const handleSave = async (values: any) => {
    try {
      const payload = {
        ...values,
        args: parseJsonField(values.argsJson, [], (parsed) => Array.isArray(parsed) && parsed.every((item) => typeof item === 'string'), 'args'),
        env: parseJsonField(values.envJson, {}, isStringRecord, 'env'),
        headers: parseJsonField(values.headersJson, {}, isStringRecord, 'headers'),
      }
      delete payload.argsJson
      delete payload.envJson
      delete payload.headersJson

      if (editServer) {
        await mcpServersApi.update(editServer.id, payload)
        message.success('已更新')
      } else {
        await mcpServersApi.create(payload)
        message.success('已创建')
      }
      setModalOpen(false); form.resetFields(); setEditServer(null); load()
    } catch (error) {
      const apiMessage = (error as any)?.response?.data?.error
      message.error(apiMessage ?? (error instanceof Error ? error.message : '保存失败'))
    }
  }

  const handleDelete = async (id: string) => {
    await mcpServersApi.delete(id)
    message.success('已删除'); load()
  }

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '连接配置', key: 'connection', render: (_: any, s: McpServer) => <code style={{ fontSize: 12 }}>{connectionSummary(s)}</code> },
    { title: '传输类型', dataIndex: 'transportType', key: 'transportType', render: (v: string) => <Tag>{v}</Tag> },
    {
      title: '状态', dataIndex: 'enabled', key: 'enabled',
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '已启用' : '已禁用'}</Tag>
    },
    {
      title: '参数', key: 'paramSchema',
      render: (_: any, s: McpServer) => <Tag>{s.paramSchema?.length ?? 0} 个参数</Tag>
    },
    {
      title: '操作', key: 'actions',
      render: (_: any, s: McpServer) => (
        <Space>
          <Button size="small" onClick={() => openEdit(s)}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(s.id)}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      )
    },
  ]

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>MCP 服务器</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          添加 MCP 服务器
        </Button>
      </div>
      <Table dataSource={servers} columns={columns} rowKey="id" loading={loading} />
      <Modal
        title={editServer ? '编辑 MCP 服务器' : '添加 MCP 服务器'}
        open={modalOpen}
        onOk={() => form.submit()}
        onCancel={() => { setModalOpen(false); setEditServer(null) }}
      >
        <Form form={form} onFinish={handleSave} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}
            extra="例如：gitnexus">
            <Input placeholder="gitnexus" />
          </Form.Item>
          <Form.Item name="transportType" label="传输类型" initialValue="sse" rules={[{ required: true }]}>
            <Select options={[
              { label: 'SSE', value: 'sse' },
              { label: 'stdio', value: 'stdio' },
              { label: 'Streamable HTTP', value: 'streamable-http' },
            ]} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.transportType !== next.transportType}>
            {({ getFieldValue }) => {
              const transportType = getFieldValue('transportType') ?? 'sse'
              if (transportType === 'stdio') {
                return (
                  <>
                    <Form.Item name="command" label="Command" rules={[{ required: true }]}
                      extra='例如：command=uvx，args=["mcp-atlassian"]'>
                      <Input placeholder="uvx" />
                    </Form.Item>
                    <Form.Item name="argsJson" label="Args JSON"
                      extra='字符串数组，例如：["mcp-atlassian"]'>
                      <Input.TextArea rows={3} placeholder='["mcp-atlassian"]' />
                    </Form.Item>
                    <Form.Item name="envJson" label="Env JSON"
                      extra='字符串对象，敏感值建议使用环境变量引用，例如：{"JIRA_PERSONAL_TOKEN":"${JIRA_PERSONAL_TOKEN}"}'>
                      <Input.TextArea rows={4} placeholder='{"JIRA_PERSONAL_TOKEN":"${JIRA_PERSONAL_TOKEN}","JIRA_SSL_VERIFY":"false"}' />
                    </Form.Item>
                  </>
                )
              }
              if (transportType === 'streamable-http') {
                return (
                  <>
                    <Form.Item name="url" label="URL" rules={[{ required: true }]}
                      extra="Streamable HTTP MCP endpoint，通常以 /mcp 结尾">
                      <Input placeholder="http://10.1.250.157:4000/mcp" />
                    </Form.Item>
                    <Form.Item name="headersJson" label="Headers JSON"
                      extra='字符串对象，例如：{"Authorization":"Bearer ${YUQUE_MCP_TOKEN}"}'>
                      <Input.TextArea rows={4} placeholder='{"Authorization":"Bearer ${YUQUE_MCP_TOKEN}"}' />
                    </Form.Item>
                  </>
                )
              }
              return (
                <Form.Item name="url" label="URL" rules={[{ required: true }]}
                  extra="MCP 服务器的 SSE 端点地址，通常以 /sse 结尾">
                  <Input placeholder="http://your-server:1348/sse" />
                </Form.Item>
              )
            }}
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
          <Divider orientation="left" style={{ fontSize: 13 }}>参数模式</Divider>
          <Form.List name="paramSchema">
            {(fields, { add, remove }) => (
              <Space direction="vertical" style={{ width: '100%' }}>
                {fields.map(({ key, name, ...restField }) => (
                  <Space key={key} align="baseline" wrap>
                    <Form.Item {...restField} name={[name, 'key']} rules={[{ required: true }]}>
                      <Input placeholder="key" />
                    </Form.Item>
                    <Form.Item {...restField} name={[name, 'label']} rules={[{ required: true }]}>
                      <Input placeholder="显示名称" />
                    </Form.Item>
                    <Form.Item {...restField} name={[name, 'type']} initialValue="string" rules={[{ required: true }]}>
                      <Select style={{ width: 120 }} options={[
                        { label: 'string', value: 'string' },
                        { label: 'string[]', value: 'string[]' },
                        { label: 'number', value: 'number' },
                        { label: 'boolean', value: 'boolean' },
                      ]} />
                    </Form.Item>
                    <Form.Item {...restField} name={[name, 'description']}>
                      <Input placeholder="说明" />
                    </Form.Item>
                    <Button onClick={() => remove(name)}>删除</Button>
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add({ type: 'string' })}>添加参数</Button>
              </Space>
            )}
          </Form.List>
        </Form>
      </Modal>
    </div>
  )
}
