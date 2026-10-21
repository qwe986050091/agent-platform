// Web 平台适配层：只保留 localStorage 会话、fetch SSE 传输与浏览器专属接口；
// 接口路径 / DTO / 事件语义全部来自 @agent/api 与 @agent/types（与移动端共用一份）。

import {
  ApiError,
  buildChatStreamRequest,
  createAgentApi,
  createChatEventDispatcher,
  createSseParser,
  uploadWithProgress,
  type ApiOptions,
  type ChatStreamHandlers,
  type StreamHandle,
} from '@agent/api'
import type { AppNotification, AuthUser, ChatImageInput } from '@agent/types'

export * from '@agent/types'
export { ApiError, type ApiOptions, type ChatStreamHandlers }

const TOKEN_KEY = 'agent_token'
const USER_KEY = 'agent_user'

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function saveAuth(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

/** 401 统一处理：清本地登录态并跳登录页（SSE / 上传等旁路也要走这里） */
function handleUnauthorized() {
  clearAuth()
  if (!location.pathname.startsWith('/login')) location.href = '/login'
}

const client = createAgentApi({
  getToken,
  onUnauthorized: handleUnauthorized,
})

export const {
  api,
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
} = client

// ==================== Web 专属：知识库文件上传（XHR 真实进度） ====================

/**
 * 上传知识库文档（.txt/.md 等）。
 *
 * 用 XHR 而非 fetch：需要 upload.onprogress 反馈真实网络上传进度；
 * 注意响应在服务端切块+向量化完成后才返回，进度到 100% 后到收到响应之间
 * 即服务端处理时间（调用方可据此显示「正在向量化」阶段）。
 */
export function uploadDocument(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<{ id: number; docName: string; chunks: number }> {
  const formData = new FormData()
  formData.append('file', file)
  return uploadWithProgress({
    url: '/api/knowledge/upload',
    token: getToken(),
    formData,
    onProgress,
    onUnauthorized: handleUnauthorized,
  })
}

/**
 * 鉴权拉取二进制资源（对话图片附件）。
 * <img src> 无法带 Authorization 头，组件需先经此函数拿到 Blob 再转 objectURL。
 */
export async function fetchAuthBlob(path: string): Promise<Blob> {
  const res = await fetch(path, {
    headers: getToken() ? { Authorization: 'Bearer ' + getToken() } : {},
  })
  if (res.status === 401) {
    handleUnauthorized()
    throw new ApiError('未登录或登录已过期', 401)
  }
  if (!res.ok) {
    throw new ApiError(`图片加载失败 (${res.status})`, res.status)
  }
  return res.blob()
}

// ==================== Web 专属：SSE 传输（fetch + ReadableStream） ====================

export interface WebChatStreamHandlers extends ChatStreamHandlers {
  /** 中断生成 */
  signal?: AbortSignal
}

/**
 * 流式对话（SSE）：POST /api/chat/stream
 *
 * EventSource 不支持 POST 和自定义请求头，因此用 fetch + ReadableStream
 * 手动分帧；事件语义（tool / rag / delegation / usage / approval-request /
 * error / [DONE]）由 @agent/api 的共享分发器统一处理。
 */
export async function streamChat(
  message: string,
  conversationId: number,
  handlers: WebChatStreamHandlers,
  images?: ChatImageInput[],
): Promise<void> {
  // 前端生成 traceId 随头上送，便于请求失败时也能与服务端日志对账
  const traceId = crypto.randomUUID()
  const { headers, body } = buildChatStreamRequest({
    message,
    conversationId,
    images,
    token: getToken(),
    traceId,
  })

  let res: Response
  try {
    res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers,
      body,
      signal: handlers.signal,
    })
  } catch (e: any) {
    // 用户主动停止（AbortController.abort()）：统一为「已停止生成」提示，不当作网络错误
    if (e?.name === 'AbortError') throw new ApiError('已停止生成', 0)
    throw new ApiError(e?.message || '网络连接失败', 0)
  }

  if (res.status === 401) {
    handleUnauthorized()
    throw new ApiError('未登录或登录已过期', 401)
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({} as any))
    throw new ApiError(data.message || `请求失败 (${res.status})`, res.status)
  }

  // 优先采用响应头回显的 traceId（通常与上送一致），兜底用本地生成的
  handlers.onTraceId?.(res.headers.get('x-trace-id') || traceId)

  // 命名 error 事件在 SSE 已提交后下发（HTTP 仍 200）：从分发器抛出，
  // 由外层 catch 统一按普通失败处理（保持 PC 端 await 语义）
  const dispatcher = createChatEventDispatcher(handlers, (err) => {
    throw err
  })
  const parser = createSseParser((eventName, data) => {
    dispatcher.dispatch(eventName, data)
  })

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')

  // error 事件在 dispatch 内抛出：用 try/finally 保证释放 reader，
  // 避免连接悬挂到服务端关闭（正常结束时 cancel 已完成的 reader 是空操作）
  try {
    while (!dispatcher.done) {
      const { done, value } = await reader.read()
      if (done) break
      parser.push(decoder.decode(value, { stream: true }))
    }
    parser.flush()
  } finally {
    reader.cancel().catch(() => {
      /* 已关闭/已取消均忽略 */
    })
  }
}

/**
 * 实时通知流（SSE）：连接建立后服务端主动推送新通知。
 *
 * 与聊天 SSE 一样用 fetch 手动解析（EventSource 不能带 Authorization 头）。
 * 断线由调用方负责重连；游标轮询保留为离线/断线补齐的兜底。
 */
export async function streamNotifications(handlers: {
  onNotification: (notification: AppNotification) => void
  onOpen?: () => void
  signal?: AbortSignal
}): Promise<void> {
  const res = await fetch('/api/notifications/stream', {
    headers: {
      ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}),
    },
    signal: handlers.signal,
  })
  if (!res.ok || !res.body) {
    throw new ApiError(`通知流连接失败 (${res.status})`, res.status)
  }
  handlers.onOpen?.()

  const parser = createSseParser((eventName, raw) => {
    if (eventName !== 'notification') return
    try {
      const payload = JSON.parse(raw) as {
        id: number
        type: string
        title: string
        body?: string
        targetConversationId?: number
      }
      handlers.onNotification({
        id: payload.id,
        type: payload.type,
        title: payload.title,
        body: payload.body ?? null,
        targetConversationId: payload.targetConversationId ?? null,
        read: false,
        createdAt: new Date().toISOString(),
      })
    } catch {
      /* 忽略坏事件 */
    }
  })

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parser.push(decoder.decode(value, { stream: true }))
    }
    parser.flush()
  } finally {
    reader.cancel().catch(() => {
      /* 已关闭/已取消均忽略 */
    })
  }
}

/** 供 ChatPage 中断时复用的句柄形状（保持与移动端一致的类型出口） */
export type { StreamHandle }
