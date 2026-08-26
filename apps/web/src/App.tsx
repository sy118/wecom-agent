import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage.js'
import BotsPage from './pages/BotsPage.js'
import ContextsPage from './pages/ContextsPage.js'
import BindingsPage from './pages/BindingsPage.js'
import McpServersPage from './pages/McpServersPage.js'
import SkillsPage from './pages/SkillsPage.js'
import SessionsPage from './pages/SessionsPage.js'
import RunDetailPage from './pages/RunDetailPage.js'
import ScheduledTasksPage from './pages/ScheduledTasksPage.js'
import SettingsPage from './pages/SettingsPage.js'
import WecomCommandConfigPage from './pages/WecomCommandConfigPage.js'
import TemplateMarketPage from './pages/TemplateMarketPage.js'
import WizardPage from './pages/WizardPage.js'
import AdminConsolePage from './pages/AdminConsolePage.js'
import AppLayout from './components/AppLayout.js'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('token')
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<Navigate to="/bots" replace />} />
          <Route path="bots" element={<BotsPage />} />
          <Route path="bots/:botId/contexts" element={<ContextsPage />} />
          <Route path="bots/:botId/bindings" element={<BindingsPage />} />
          <Route path="mcp-servers" element={<McpServersPage />} />
          <Route path="skills" element={<SkillsPage />} />
          <Route path="scheduled-tasks" element={<ScheduledTasksPage />} />
          <Route path="wecom-command-config" element={<WecomCommandConfigPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="sessions" element={<SessionsPage />} />
          <Route path="runs/:id" element={<RunDetailPage />} />
          <Route path="templates" element={<TemplateMarketPage />} />
          <Route path="wizard" element={<WizardPage />} />
          <Route path="admin" element={<AdminConsolePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
