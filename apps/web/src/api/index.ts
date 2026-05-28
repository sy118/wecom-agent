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

export const wikiApi = {
  listNamespaces: () => api.get('/wiki/namespaces').then((r) => r.data),
  createNamespace: (data: unknown) => api.post('/wiki/namespaces', data).then((r) => r.data),
  deleteNamespace: (id: string) => api.delete(`/wiki/namespaces/${id}`),
  health: () => api.get('/wiki/health').then((r) => r.data),
  namespaceHealth: (namespace: string) => api.get(`/wiki/${namespace}/health`).then((r) => r.data),
  metrics: (namespace: string) => api.get(`/wiki/${namespace}/metrics`).then((r) => r.data),
  retrievalLogs: (namespace: string) => api.get(`/wiki/${namespace}/retrieval-logs`).then((r) => r.data),
  misses: (namespace: string) => api.get(`/wiki/${namespace}/misses`).then((r) => r.data),
  search: (namespace: string, query: string) =>
    api.get(`/wiki/${namespace}/search`, { params: { q: query } }).then((r) => r.data),
  bindings: (namespace: string) => api.get(`/wiki/${namespace}/bindings`).then((r) => r.data),
  bindContext: (namespace: string, data: unknown) => api.post(`/wiki/${namespace}/bindings`, data).then((r) => r.data),
  unbindContext: (namespace: string, contextId: string) => api.delete(`/wiki/${namespace}/bindings/${contextId}`),
  updateBindingPolicy: (namespace: string, contextId: string, data: unknown) =>
    api.put(`/wiki/${namespace}/bindings/${contextId}/policy`, data).then((r) => r.data),
  listFiles: (namespace: string) => api.get(`/wiki/${namespace}/files`).then((r) => r.data),
  getFile: (namespace: string, filePath: string) =>
    api.get(`/wiki/${namespace}/files/${encodeURI(filePath)}`).then((r) => r.data),
  uploadFiles: (namespace: string, data: FormData) =>
    api.post(`/wiki/${namespace}/upload`, data, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  deleteFile: (namespace: string, filePath: string) =>
    api.delete(`/wiki/${namespace}/files/${encodeURI(filePath)}`).then((r) => r.data),
  listDrafts: (namespace: string) => api.get(`/wiki/${namespace}/drafts`).then((r) => r.data),
  createDraft: (namespace: string, data: unknown) => api.post(`/wiki/${namespace}/drafts`, data).then((r) => r.data),
  updateDraft: (namespace: string, id: string, data: unknown) =>
    api.put(`/wiki/${namespace}/drafts/${id}`, data).then((r) => r.data),
  draftDiff: (namespace: string, id: string, strategy?: string) =>
    api.get(`/wiki/${namespace}/drafts/${id}/diff`, { params: strategy ? { strategy } : {} }).then((r) => r.data),
  approveDraft: (namespace: string, id: string, data: unknown = {}) =>
    api.post(`/wiki/${namespace}/drafts/${id}/approve`, data).then((r) => r.data),
  rejectDraft: (namespace: string, id: string, data: unknown = {}) =>
    api.post(`/wiki/${namespace}/drafts/${id}/reject`, data).then((r) => r.data),
  feedback: (namespace: string, params: Record<string, unknown> = {}) =>
    api.get(`/wiki/${namespace}/feedback`, { params }).then((r) => r.data),
  feedbackMetrics: (namespace: string, params: Record<string, unknown> = {}) =>
    api.get(`/wiki/${namespace}/feedback/metrics`, { params }).then((r) => r.data),
  feedbackDetail: (namespace: string, id: string) => api.get(`/wiki/${namespace}/feedback/${id}`).then((r) => r.data),
  updateFeedback: (namespace: string, id: string, data: unknown) =>
    api.patch(`/wiki/${namespace}/feedback/${id}`, data).then((r) => r.data),
  feedbackToDraft: (namespace: string, id: string, data: unknown = {}) =>
    api.post(`/wiki/${namespace}/feedback/${id}/draft`, data).then((r) => r.data),
  listAnnotationAnswers: (namespace: string, params: Record<string, unknown> = {}) =>
    api.get(`/wiki/${namespace}/annotation-answers`, { params }).then((r) => r.data),
  createAnnotationAnswer: (namespace: string, data: unknown) =>
    api.post(`/wiki/${namespace}/annotation-answers`, data).then((r) => r.data),
  createAnnotationAnswerFromFeedback: (namespace: string, feedbackId: string, data: unknown = {}) =>
    api.post(`/wiki/${namespace}/annotation-answers/from-feedback/${feedbackId}`, data).then((r) => r.data),
  updateAnnotationAnswer: (namespace: string, id: string, data: unknown) =>
    api.put(`/wiki/${namespace}/annotation-answers/${id}`, data).then((r) => r.data),
  deleteAnnotationAnswer: (namespace: string, id: string) =>
    api.delete(`/wiki/${namespace}/annotation-answers/${id}`),
  gitPull: () => api.post('/wiki/git-pull').then((r) => r.data),
}
