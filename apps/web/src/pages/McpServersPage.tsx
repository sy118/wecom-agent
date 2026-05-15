import { useEffect, useState } from 'react'
import { Table, Button, Space, Modal, Form, Input, Select, Switch, message, Popconfirm, Tag, Divider } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { mcpServersApi } from '../api/index.js'

interface ParamSchemaItem { key: string; label: string; type: 'string' | 'string[]' | 'number' | 'boolean'; description?: string }
interface McpServer { id: string; name: string; url: string; transportType: string; enabled: boolean; paramSchema?: ParamSchemaItem[] }

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

  useEffect(() => { load() }, [])

  const handleSave = async (values: any) => {
    try {
      if (editServer) {
        await mcpServersApi.update(editServer.id, values)
        message.success('已更新')
      } else {
        await mcpServersApi.create(values)
        message.success('已创建')
      }
      setModalOpen(false); form.resetFields(); setEditServer(null); load()
    } catch { message.error('保存失败') }
  }

  const handleDelete = async (id: string) => {
    await mcpServersApi.delete(id)
    message.success('已删除'); load()
  }

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: 'URL', dataIndex: 'url', key: 'url', render: (v: string) => <code style={{ fontSize: 12 }}>{v}</code> },
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
          <Button size="small" onClick={() => { setEditServer(s); form.setFieldsValue(s); setModalOpen(true) }}>编辑</Button>
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
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditServer(null); form.resetFields(); setModalOpen(true) }}>
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
          <Form.Item name="url" label="URL" rules={[{ required: true }]}
            extra="MCP 服务器的 SSE 端点地址">
            <Input placeholder="http://your-server:1348/sse" />
          </Form.Item>
          <Form.Item name="transportType" label="传输类型" initialValue="sse" rules={[{ required: true }]}>
            <Select options={[{ label: 'SSE', value: 'sse' }, { label: 'stdio', value: 'stdio' }]} />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
          <Divider orientation="left" style={{ fontSize: 13 }}>参数模式</Divider>
          <Form.List name="paramSchema">
            {(fields, { add, remove }) => (
              <Space direction="vertical" style={{ width: '100%' }}>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" wrap>
                    <Form.Item {...field} name={[field.name, 'key']} rules={[{ required: true }]}>
                      <Input placeholder="key" />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'label']} rules={[{ required: true }]}>
                      <Input placeholder="显示名称" />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'type']} initialValue="string" rules={[{ required: true }]}>
                      <Select style={{ width: 120 }} options={[
                        { label: 'string', value: 'string' },
                        { label: 'string[]', value: 'string[]' },
                        { label: 'number', value: 'number' },
                        { label: 'boolean', value: 'boolean' },
                      ]} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'description']}>
                      <Input placeholder="说明" />
                    </Form.Item>
                    <Button onClick={() => remove(field.name)}>删除</Button>
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
