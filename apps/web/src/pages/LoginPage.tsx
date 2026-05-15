import { useState } from 'react'
import { Form, Input, Button, Card, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../api/index.js'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const onFinish = async ({ password }: { password: string }) => {
    setLoading(true)
    try {
      const { token } = await authApi.login(password)
      localStorage.setItem('token', token)
      navigate('/bots')
    } catch {
      message.error('密码错误')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="bubble-field" aria-hidden>
        <span />
        <span />
        <span />
        <span />
      </div>
      <Card className="login-card" title="企业微信 AI 平台">
        <Form onFinish={onFinish} layout="vertical">
          <Form.Item name="password" label="管理员密码" rules={[{ required: true }]}>
            <Input.Password placeholder="请输入管理员密码" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
