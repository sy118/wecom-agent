import api from './client.js'

export const authApi = {
  login: (password: string) =>
    api.post<{ token: string }>('/auth/login', { password }).then((r) => r.data),
}

export const botsApi = {
  list: () => api.get('/bots').then((r) => r.data),
  get: (id: string) => api.get(`/bots/${id}`).then((r) => r.data),
  create: (data: unknown) => api.post('/bots', data).then((r) => r.data),
  update: (id: string, data: unknown) => api.put(`/bots/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/bots/${id}`),
  start: (id: string) => api.post(`/bots/${id}/start`).then((r) => r.data),
  stop: (id: string) => api.post(`/bots/${id}/stop`).then((r) => r.data),
}

export const contextsApi = {
  list: (botId: string) => api.get(`/bots/${botId}/contexts`).then((r) => r.data),
  defaults: (botId: string) => api.get(`/bots/${botId}/contexts/defaults`).then((r) => r.data),
  create: (botId: string, data: unknown) => api.post(`/bots/${botId}/contexts`, data).then((r) => r.data),
  update: (botId: string, id: string, data: unknown) => api.put(`/bots/${botId}/contexts/${id}`, data).then((r) => r.data),
  delete: (botId: string, id: string) => api.delete(`/bots/${botId}/contexts/${id}`),
}

export const settingsApi = {
  get: () => api.get('/settings').then((r) => r.data),
  update: (data: unknown) => api.put('/settings', data).then((r) => r.data),
}

export const bindingsApi = {
  list: (botId: string) => api.get(`/bots/${botId}/bindings`).then((r) => r.data),
  discovered: (botId: string) => api.get(`/bots/${botId}/bindings/discovered`).then((r) => r.data),
  create: (botId: string, data: unknown) => api.post(`/bots/${botId}/bindings`, data).then((r) => r.data),
  update: (botId: string, id: string, data: unknown) => api.put(`/bots/${botId}/bindings/${id}`, data).then((r) => r.data),
  delete: (botId: string, id: string) => api.delete(`/bots/${botId}/bindings/${id}`),
}

export const wecomCommandConfigApi = {
  users: (botId: string) => api.get(`/bots/${botId}/wecom-command-config/users`).then((r) => r.data),
  saveUser: (botId: string, data: unknown) => api.post(`/bots/${botId}/wecom-command-config/users`, data).then((r) => r.data),
  updateUser: (botId: string, wecomUserId: string, data: unknown) =>
    api.patch(`/bots/${botId}/wecom-command-config/users/${encodeURIComponent(wecomUserId)}`, data).then((r) => r.data),
  deleteUser: (botId: string, wecomUserId: string) =>
    api.delete(`/bots/${botId}/wecom-command-config/users/${encodeURIComponent(wecomUserId)}`),
  contextAccess: (botId: string, wecomUserId?: string) =>
    api.get(`/bots/${botId}/wecom-command-config/context-access`, { params: wecomUserId ? { wecomUserId } : {} }).then((r) => r.data),
  grantContext: (botId: string, data: unknown) =>
    api.post(`/bots/${botId}/wecom-command-config/context-access`, data).then((r) => r.data),
  deleteContextAccess: (botId: string, wecomUserId: string, contextId: string) =>
    api.delete(`/bots/${botId}/wecom-command-config/context-access/${encodeURIComponent(wecomUserId)}/${encodeURIComponent(contextId)}`),
  commandPermissions: (botId: string) => api.get(`/bots/${botId}/wecom-command-config/command-permissions`).then((r) => r.data),
  setCommandPermission: (botId: string, data: unknown) =>
    api.put(`/bots/${botId}/wecom-command-config/command-permissions`, data).then((r) => r.data),
  deleteCommandPermission: (botId: string, id: string) =>
    api.delete(`/bots/${botId}/wecom-command-config/command-permissions/${id}`),
  featureSwitches: (botId: string) => api.get(`/bots/${botId}/wecom-command-config/feature-switches`).then((r) => r.data),
  updateFeatureSwitches: (botId: string, data: unknown) =>
    api.put(`/bots/${botId}/wecom-command-config/feature-switches`, data).then((r) => r.data),
  auditLogs: (botId: string) => api.get(`/bots/${botId}/wecom-command-config/audit-logs`).then((r) => r.data),
  modelConfigs: (botId: string, capability?: string) =>
    api.get(`/bots/${botId}/wecom-command-config/model-configs`, { params: capability ? { capability } : {} }).then((r) => r.data),
  createModelConfig: (botId: string, data: unknown) =>
    api.post(`/bots/${botId}/wecom-command-config/model-configs`, data).then((r) => r.data),
  updateModelConfig: (botId: string, id: string, data: unknown) =>
    api.patch(`/bots/${botId}/wecom-command-config/model-configs/${id}`, data).then((r) => r.data),
  deleteModelConfig: (botId: string, id: string) =>
    api.delete(`/bots/${botId}/wecom-command-config/model-configs/${id}`),
}

export const mcpServersApi = {
  list: () => api.get('/mcp-servers').then((r) => r.data),
  create: (data: unknown) => api.post('/mcp-servers', data).then((r) => r.data),
  update: (id: string, data: unknown) => api.put(`/mcp-servers/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/mcp-servers/${id}`),
}

export const skillsApi = {
  list: () => api.get('/skills').then((r) => r.data),
  upload: (data: FormData) =>
    api
      .post('/skills/upload', data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data),
  skillMd: (id: string) => api.get(`/skills/${id}/skill-md`, { responseType: 'text' }).then((r) => r.data),
  update: (id: string, data: unknown) => api.put(`/skills/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/skills/${id}`),
}

export const skillAuditApi = {
  list: (skillId: string) => api.get(`/skills/${skillId}/audit`).then((r) => r.data),
}

export const sessionsApi = {
  list: () => api.get('/sessions').then((r) => r.data),
  delete: (chatKey: string) => api.delete(`/sessions/${encodeURIComponent(chatKey)}`),
}

export const scheduledTasksApi = {
  list: () => api.get('/scheduled-tasks').then((r) => r.data),
  create: (data: unknown) => api.post('/scheduled-tasks', data).then((r) => r.data),
  update: (id: string, data: unknown) => api.put(`/scheduled-tasks/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/scheduled-tasks/${id}`),
}

