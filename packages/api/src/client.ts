import { ApiError } from './error'
import type {
  AdminFeedbackPage,
  AppNotification,
  ApprovalDecisionResult,
  AuthResponse,
  ChatImageInput,
  Conversation,
  EvalCandidateRow,
  EvalDiffView,
  EvalRunDetail,
  EvalRunPage,
  EvalStats,
  FeedbackListParams,
  FeedbackReason,
  FeedbackStats,
  KnowledgeDoc,
  ScheduledTask,
  ScheduledTaskRun,
  Skill,
  SkillUploadPayload,
  TaskPayload,
  TraceDetail,
  UsageSummary,
} from '@agent/types'

/** 请求配置：body 允许传普通对象（自动 JSON 序列化）、FormData 或字符串 */
export interface ApiOptions {
  method?: string
  body?: any
  signal?: AbortSignal
  headers?: Record<string, string>
}

export interface AgentApiOptions {
  /** 空字符串 = 同源（Web 走 Vite/Nginx 代理）；移动端传绝对地址 */
  baseUrl?: string
  /** token 读取：Web 同步 localStorage，移动端异步 AsyncStorage */
  getToken: () => string | Promise<string>
  /** 401 的平台处理（Web 跳登录、移动端清会话并回登录页） */
  onUnauthorized?: (message: string) => void
  /** 自定义 fetch（便于 Node 测试或特殊运行时注入） */
  fetchImpl?: typeof fetch
}

/** 与后端约定的聊天流请求体构造（两端共用，避免字段漂移） */
export function buildChatStreamRequest(args: {
  message: string
  conversationId: number
  images?: ChatImageInput[]
  token?: string
  traceId: string
  headers?: Record<string, string>
}): { headers: Record<string, string>; body: string } {
  return {
    headers: {
      'Content-Type': 'application/json',
      'X-Trace-Id': args.traceId,
      ...(args.token ? { Authorization: 'Bearer ' + args.token } : {}),
      ...(args.headers || {}),
    },
    body: JSON.stringify({
      message: args.message,
      conversationId: args.conversationId,
      // 无图时不带 images 字段（后端按纯文本回合处理）
      ...(args.images && args.images.length > 0 ? { images: args.images } : {}),
    }),
  }
}

export interface UploadWithProgressOptions {
  url: string
  token: string
  formData: FormData
  onProgress?: (percent: number) => void
  timeoutMs?: number
  onUnauthorized?: () => void
}

/**
 * XHR 上传（真实网络进度）：Web 与 RN 都提供 XMLHttpRequest。
 * 服务端在切块+向量化完成后才返回，进度 100% 后到响应之间的时间即处理时间。
 */
export function uploadWithProgress<T>(options: UploadWithProgressOptions): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', options.url)
    if (options.token) xhr.setRequestHeader('Authorization', 'Bearer ' + options.token)
    if (options.timeoutMs) xhr.timeout = options.timeoutMs

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        options.onProgress?.(Math.round((e.loaded / e.total) * 100))
      }
    }

    xhr.onload = () => {
      if (xhr.status === 401) {
        options.onUnauthorized?.()
        reject(new ApiError('登录已过期，请重新登录', 401))
        return
      }
      let data: any = {}
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        /* 非 JSON 响应按错误处理 */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as T)
      } else {
        reject(new ApiError(data.message || `上传失败 (${xhr.status})`, xhr.status))
      }
    }
    xhr.onerror = () => reject(new ApiError('网络连接失败', 0))
    xhr.ontimeout = () => reject(new ApiError('上传超时，请重试', 0))

    xhr.send(options.formData)
  })
}

/**
 * 创建平台无关的 Agent API 客户端。
 *
 * 平台适配层（Web / 移动端）只负责三件事：
 *   1. token 存取（localStorage / AsyncStorage）
 *   2. 401 后的跳转或登出
 *   3. SSE 传输（fetch 流 / react-native-sse）
 * 其余路径、请求体、返回类型、错误语义全部在这里统一。
 */
export function createAgentApi(options: AgentApiOptions) {
  const baseUrl = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch

  async function getToken(): Promise<string> {
    return await options.getToken()
  }

  async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
    const headers: Record<string, string> = { ...(opts.headers || {}) }
    const token = await getToken()
    if (token) headers.Authorization = 'Bearer ' + token

    let body = opts.body
    if (body && !(body instanceof FormData) && typeof body !== 'string') {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(body)
    }

    let res: Response
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method: opts.method || 'GET',
        headers,
        body,
        signal: opts.signal,
      })
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new ApiError('请求已取消', 0)
      throw new ApiError('网络连接失败', 0)
    }

    const data = await res.json().catch(() => ({} as any))

    if (res.status === 401) {
      const message = data.message || '未登录或登录已过期'
      options.onUnauthorized?.(message)
      throw new ApiError(message, 401)
    }
    if (!res.ok) {
      throw new ApiError(data.message || `请求失败 (${res.status})`, res.status)
    }
    return data as T
  }

  // ==================== 认证 ====================

  function getMe(): Promise<AuthResponse> {
    return api<AuthResponse>('/api/auth/me')
  }

  // ==================== 多会话 ====================

  async function listConversations(): Promise<Conversation[]> {
    const data = await api<{ conversations: Conversation[] }>('/api/conversations')
    return data.conversations || []
  }

  function createConversation(title?: string): Promise<Conversation> {
    return api('/api/conversations', { method: 'POST', body: { title } })
  }

  function renameConversation(id: number, title: string): Promise<Conversation> {
    return api(`/api/conversations/${id}`, { method: 'PATCH', body: { title } })
  }

  async function deleteConversation(id: number): Promise<void> {
    await api(`/api/conversations/${id}`, { method: 'DELETE' })
  }

  // ==================== 知识库 ====================

  async function listDocuments(): Promise<KnowledgeDoc[]> {
    const data = await api<{ documents: KnowledgeDoc[] }>('/api/knowledge/documents')
    return data.documents || []
  }

  async function deleteDocument(id: number): Promise<void> {
    await api(`/api/knowledge/documents/${id}`, { method: 'DELETE' })
  }

  // ==================== 技能 ====================

  async function listSkills(): Promise<Skill[]> {
    const data = await api<{ skills: Skill[] }>('/api/skills')
    return data.skills || []
  }

  async function listTools(): Promise<string[]> {
    const data = await api<{ tools: string[] }>('/api/skills/tools')
    return data.tools || []
  }

  function uploadSkill(payload: SkillUploadPayload): Promise<{ message: string; name: string }> {
    return api('/api/skills/upload', { method: 'POST', body: payload })
  }

  async function mountSkill(skillName: string): Promise<void> {
    await api('/api/skills/mount', { method: 'POST', body: { skillName } })
  }

  async function unmountSkill(skillName: string): Promise<void> {
    await api('/api/skills/unmount', { method: 'POST', body: { skillName } })
  }

  async function deleteSkill(name: string): Promise<void> {
    await api(`/api/skills/${encodeURIComponent(name)}`, { method: 'DELETE' })
  }

  // ==================== Trace / 审批 ====================

  function getTrace(traceId: string): Promise<TraceDetail> {
    return api(`/api/chat/traces/${encodeURIComponent(traceId)}`)
  }

  function decideApproval(
    approvalId: string,
    approved: boolean,
    remember = false,
  ): Promise<ApprovalDecisionResult> {
    return api(`/api/chat/approvals/${encodeURIComponent(approvalId)}/decision`, {
      method: 'POST',
      body: { approved, remember },
    })
  }

  // ==================== 用量 ====================

  function getUsageSummary(from?: string, to?: string): Promise<UsageSummary> {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const qs = params.toString()
    return api(`/api/usage/summary${qs ? '?' + qs : ''}`)
  }

  // ==================== 反馈 ====================

  async function getFeedbackReasons(): Promise<FeedbackReason[]> {
    const data = await api<{ reasons: FeedbackReason[] }>('/api/feedback/reasons')
    return data.reasons || []
  }

  function submitFeedback(
    traceId: string,
    rating: number,
    reasonCode?: string,
    comment?: string,
  ): Promise<{ traceId: string; rating: number }> {
    return api('/api/feedback', {
      method: 'POST',
      body: { traceId, rating, reasonCode, comment },
    })
  }

  function getAdminFeedback(params: FeedbackListParams = {}): Promise<AdminFeedbackPage> {
    const qs = new URLSearchParams()
    if (params.rating !== undefined) qs.set('rating', String(params.rating))
    if (params.reason) qs.set('reason', params.reason)
    if (params.keyword) qs.set('keyword', params.keyword)
    if (params.from) qs.set('from', params.from)
    if (params.to) qs.set('to', params.to)
    qs.set('page', String(params.page ?? 0))
    qs.set('size', String(params.size ?? 20))
    return api(`/api/admin/feedback?${qs.toString()}`)
  }

  function getFeedbackStats(from?: string, to?: string): Promise<FeedbackStats> {
    const qs = new URLSearchParams()
    if (from) qs.set('from', from)
    if (to) qs.set('to', to)
    const s = qs.toString()
    return api(`/api/admin/feedback/stats${s ? '?' + s : ''}`)
  }

  // ==================== 定时任务 / 通知 ====================

  async function listTasks(): Promise<ScheduledTask[]> {
    const data = await api<{ tasks: ScheduledTask[] }>('/api/tasks')
    return data.tasks || []
  }

  function createTask(payload: TaskPayload): Promise<ScheduledTask> {
    return api('/api/tasks', { method: 'POST', body: payload })
  }

  function updateTask(id: number, payload: TaskPayload): Promise<ScheduledTask> {
    return api(`/api/tasks/${id}`, { method: 'PATCH', body: payload })
  }

  async function deleteTask(id: number): Promise<void> {
    await api(`/api/tasks/${id}`, { method: 'DELETE' })
  }

  function runTaskNow(id: number): Promise<{ message: string }> {
    return api(`/api/tasks/${id}/run-now`, { method: 'POST' })
  }

  async function listTaskRuns(id: number, page = 0, size = 20): Promise<ScheduledTaskRun[]> {
    const data = await api<{ runs: ScheduledTaskRun[] }>(
      `/api/tasks/${id}/runs?page=${page}&size=${size}`,
    )
    return data.runs || []
  }

  async function listNotifications(afterId: number, limit = 20): Promise<AppNotification[]> {
    const data = await api<{ notifications: AppNotification[] }>(
      `/api/notifications?after_id=${afterId}&limit=${limit}`,
    )
    return data.notifications || []
  }

  async function markNotificationRead(id: number): Promise<void> {
    await api(`/api/notifications/${id}/read`, { method: 'POST' })
  }

  // ==================== 评测 ====================

  function getEvalRuns(page = 0, size = 20): Promise<EvalRunPage> {
    return api(`/api/admin/eval/runs?page=${page}&size=${size}`)
  }

  function getEvalRun(runId: string): Promise<EvalRunDetail> {
    return api(`/api/admin/eval/runs/${encodeURIComponent(runId)}`)
  }

  function getEvalStats(): Promise<EvalStats> {
    return api('/api/admin/eval/stats')
  }

  function getEvalDiff(runId: string, base: string): Promise<EvalDiffView> {
    return api(
      `/api/admin/eval/runs/${encodeURIComponent(runId)}/diff?base=${encodeURIComponent(base)}`,
    )
  }

  async function getEvalCandidates(status = 'new'): Promise<EvalCandidateRow[]> {
    const data = await api<{ content: EvalCandidateRow[] }>(
      `/api/admin/eval/candidates?status=${encodeURIComponent(status)}`,
    )
    return data.content || []
  }

  function refreshEvalCandidates(): Promise<{ created: number }> {
    return api('/api/admin/eval/candidates/refresh', { method: 'POST' })
  }

  function promoteEvalCandidate(
    id: number,
  ): Promise<{ id: number; status: string; caseDraft: string }> {
    return api(`/api/admin/eval/candidates/${id}/promote`, { method: 'POST' })
  }

  function dismissEvalCandidate(id: number): Promise<{ id: number; status: string }> {
    return api(`/api/admin/eval/candidates/${id}/dismiss`, { method: 'POST' })
  }

  return {
    api,
    getToken,
    getMe,
    listConversations,
    createConversation,
    renameConversation,
    deleteConversation,
    listDocuments,
    deleteDocument,
    listSkills,
    listTools,
    uploadSkill,
    mountSkill,
    unmountSkill,
    deleteSkill,
    getTrace,
    decideApproval,
    getUsageSummary,
    getFeedbackReasons,
    submitFeedback,
    getAdminFeedback,
    getFeedbackStats,
    listTasks,
    createTask,
    updateTask,
    deleteTask,
    runTaskNow,
    listTaskRuns,
    listNotifications,
    markNotificationRead,
    getEvalRuns,
    getEvalRun,
    getEvalStats,
    getEvalDiff,
    getEvalCandidates,
    refreshEvalCandidates,
    promoteEvalCandidate,
    dismissEvalCandidate,
  }
}

export type AgentApi = ReturnType<typeof createAgentApi>
