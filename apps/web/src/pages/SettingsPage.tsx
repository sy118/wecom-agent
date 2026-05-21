import { useEffect, useState } from 'react'
import { Alert, Button, Card, Form, InputNumber, Space, message } from 'antd'
import { SettingOutlined } from '@ant-design/icons'
import { settingsApi } from '../api/index.js'

interface PlatformSettings {
  defaultSessionTtlMin: number
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<PlatformSettings>()

  const load = async () => {
    setLoading(true)
    try {
      const settings = await settingsApi.get()
      form.setFieldsValue(settings)
    } catch (err: any) {
      message.error(err?.response?.data?.error ?? err?.message ?? '加载平台设置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleSave = async (values: PlatformSettings) => {
    setSaving(true)
    try {
      const settings = await settingsApi.update(values)
      form.setFieldsValue(settings)
      message.success('平台设置已保存')
    } catch (err: any) {
      message.error(err?.response?.data?.error ?? err?.message ?? '保存平台设置失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space>
          <SettingOutlined />
          <h2 style={{ margin: 0 }}>平台设置</h2>
        </Space>
      </div>

      <Card title="会话默认配置" loading={loading}>
        <Alert
          type="info"
          showIcon
          message="平台默认会话 TTL 仅影响之后新建且未显式设置会话超时的上下文；不会修改已有上下文或存量会话。"
          style={{ marginBottom: 16 }}
        />
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item
            name="defaultSessionTtlMin"
            label="平台默认会话 TTL（分钟）"
            rules={[{ required: true, message: '请输入平台默认会话 TTL' }]}
          >
            <InputNumber min={1} max={1440} precision={0} style={{ width: 240 }} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>保存设置</Button>
        </Form>
      </Card>
    </div>
  )
}
