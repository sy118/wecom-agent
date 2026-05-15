import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage.js'
import BotsPage from './pages/BotsPage.js'
import ContextsPage from './pages/ContextsPage.js'
import BindingsPage from './pages/BindingsPage.js'
import McpServersPage from './pages/McpServersPage.js'
import SessionsPage from './pages/SessionsPage.js'
import ScheduledTasksPage from './pages/ScheduledTasksPage.js'
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
          <Route path="bots/:botId/mcp-servers" element={<McpServersPage />} />
          <Route path="bots/:botId/scheduled-tasks" element={<ScheduledTasksPage />} />
          <Route path="sessions" element={<SessionsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
