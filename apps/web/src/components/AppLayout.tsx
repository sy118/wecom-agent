import { ConfigProvider, Layout, Menu, Button, Space } from 'antd'
import { RobotOutlined, MessageOutlined, LogoutOutlined, CloudOutlined, ApiOutlined, ThunderboltOutlined, ScheduleOutlined, BookOutlined } from '@ant-design/icons'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'

const { Sider, Header, Content } = Layout

function getSelectedKey(pathname: string): string {
  if (pathname.startsWith('/sessions')) return 'sessions'
  if (pathname.startsWith('/mcp-servers')) return 'mcp-servers'
  if (pathname.startsWith('/skills')) return 'skills'
  if (pathname.startsWith('/scheduled-tasks')) return 'scheduled-tasks'
  if (pathname.startsWith('/wiki')) return 'wiki'
  return 'bots'
}

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()

  const selectedKey = getSelectedKey(location.pathname)

  const handleLogout = () => {
    localStorage.removeItem('token')
    navigate('/login')
  }

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#3388ff',
          colorSuccess: '#34c759',
          colorWarning: '#ff9f0a',
          colorError: '#ff5a7a',
          borderRadius: 8,
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
        },
        components: {
          Layout: { bodyBg: 'transparent', headerBg: 'transparent', siderBg: 'transparent' },
          Table: { headerBg: '#f4f9ff', rowHoverBg: '#eef8ff' },
          Modal: { borderRadiusLG: 8 },
          Card: { borderRadiusLG: 8 },
        },
      }}
    >
      <Layout className="app-shell">
        <div className="bubble-field" aria-hidden>
          <span />
          <span />
          <span />
          <span />
        </div>
        <Layout className="app-layout">
          <Sider className="app-sider" theme="light" width={220}>
            <div className="app-brand">
              <div className="brand-icon"><RobotOutlined /></div>
              <div>
                <div className="brand-title">企业微信 AI 平台</div>
                <div className="brand-subtitle">加油吧，骚年！！！</div>
              </div>
            </div>
            <Menu selectedKeys={[selectedKey]} items={[
              { key: 'bots', icon: <RobotOutlined />, label: '机器人管理', onClick: () => navigate('/bots') },
              { key: 'mcp-servers', icon: <ApiOutlined />, label: 'MCP 服务器', onClick: () => navigate('/mcp-servers') },
              { key: 'skills', icon: <ThunderboltOutlined />, label: '技能包', onClick: () => navigate('/skills') },
              { key: 'scheduled-tasks', icon: <ScheduleOutlined />, label: '定时任务', onClick: () => navigate('/scheduled-tasks') },
              { key: 'wiki', icon: <BookOutlined />, label: 'Wiki 知识库', onClick: () => navigate('/wiki') },
              { type: 'divider' },
              { key: 'sessions', icon: <MessageOutlined />, label: '会话监控', onClick: () => navigate('/sessions') },
            ]} />
          </Sider>
          <Layout>
            <Header className="app-header">
              <Space className="app-header-copy">
                <CloudOutlined />
                <span>今天也让机器人温柔地工作</span>
              </Space>
              <Button className="soft-button" icon={<LogoutOutlined />} onClick={handleLogout}>退出登录</Button>
            </Header>
            <Content className="app-content">
              <Outlet />
            </Content>
          </Layout>
        </Layout>
      </Layout>
    </ConfigProvider>
  )
}
