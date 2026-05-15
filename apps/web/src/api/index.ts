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
  create: (botId: string, data: unknown) => api.post(`/bots/${botId}/contexts`, data).then((r) => r.data),
  update: (botId: string, id: string, data: unknown) => api.put(`/bots/${botId}/contexts/${id}`, data).then((r) => r.data),
  delete: (botId: string, id: string) => api.delete(`/bots/${botId}/contexts/${id}`),
}

export const bindingsApi = {
  list: (botId: string) => api.get(`/bots/${botId}/bindings`).then((r) => r.data),
  discovered: (botId: string) => api.get(`/bots/${botId}/bindings/discovered`).then((r) => r.data),
  create: (botId: string, data: unknown) => api.post(`/bots/${botId}/bindings`, data).then((r) => r.data),
  delete: (botId: string, id: string) => api.delete(`/bots/${botId}/bindings/${id}`),
}

export const mcpServersApi = {
  list: (botId: string) => api.get(`/bots/${botId}/mcp-servers`).then((r) => r.data),
  create: (botId: string, data: unknown) => api.post(`/bots/${botId}/mcp-servers`, data).then((r) => r.data),
  update: (botId: string, id: string, data: unknown) => api.put(`/bots/${botId}/mcp-servers/${id}`, data).then((r) => r.data),
  delete: (botId: string, id: string) => api.delete(`/bots/${botId}/mcp-servers/${id}`),
}

export const sessionsApi = {
  list: () => api.get('/sessions').then((r) => r.data),
  get: (chatKey: string) => api.get(`/sessions/${encodeURIComponent(chatKey)}`).then((r) => r.data),
  delete: (chatKey: string) => api.delete(`/sessions/${encodeURIComponent(chatKey)}`),
}

export const scheduledTasksApi = {
  list: (botId: string) => api.get(`/bots/${botId}/scheduled-tasks`).then((r) => r.data),
  create: (botId: string, data: unknown) => api.post(`/bots/${botId}/scheduled-tasks`, data).then((r) => r.data),
  update: (botId: string, id: string, data: unknown) => api.put(`/bots/${botId}/scheduled-tasks/${id}`, data).then((r) => r.data),
  delete: (botId: string, id: string) => api.delete(`/bots/${botId}/scheduled-tasks/${id}`),
}
