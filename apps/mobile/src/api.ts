// 移动端平台适配层：AsyncStorage 会话、react-native-sse 传输、Expo 文件系统图片缓存；
// 接口路径 / DTO / 事件语义全部来自 @agent/api 与 @agent/types（与 Web 共用一份）。

import AsyncStorage from 'expo-sqlite/kv-store'
import EventSource from 'react-native-sse'
import { Directory, File, Paths } from 'expo-file-system'
import {
  ApiError,
  buildChatStreamRequest,
  createAgentApi,
  createChatEventDispatcher,
  uploadWithProgress,
  type ChatStreamHandlers,
  type SseEventName,
  type StreamHandle,
} from '@agent/api'
import type {
  AuthUser,
  ChatImageInput,
  UploadFileSource,
} from '@agent/types'
import { API_BASE } from './config'
import { uuidv4 } from './utils/uuid'

export * from '@agent/types'
export { ApiError, type ChatStreamHandlers, type StreamHandle }

const TOKEN_KEY = 'agent_token'
const USER_KEY = 'agent_user'

// 未登录/登录过期回调（登录态失效时，由 App 订阅并跳回登录页）
type UnauthorizedHandler = () => void
let unauthorizedHandler: UnauthorizedHandler | null = null
export function onUnauthorized(handler: UnauthorizedHandler) {
  unauthorizedHandler = handler
}
function fireUnauthorized() {
  const h = unauthorizedHandler
  if (h) h()
}

export async function getToken(): Promise<string> {
  return (await AsyncStorage.getItem(TOKEN_KEY)) || ''
}

export async function saveAuth(token: string, user: AuthUser): Promise<void> {
  await AsyncStorage.multiSet([
    [TOKEN_KEY, token],
    [USER_KEY, JSON.stringify(user)],
  ])
}

export async function getStoredUser(): Promise<AuthUser | null> {
  try {
    const raw = await AsyncStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

export async function clearAuth(): Promise<void> {
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY])
}

const client = createAgentApi({
  baseUrl: API_BASE,
  getToken,
  onUnauthorized: fireUnauthorized,
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
} = client

// ==================== 移动端专属：图片附件缓存 ====================

/** 下载图片附件到本地缓存并返回 file:// URI（RN 无法用 Blob/objectURL 渲染鉴权资源） */
export async function downloadAttachment(id: number): Promise<string> {
  const token = await getToken()
  const dir = new Directory(Paths.cache, 'chat-images')
  if (!dir.exists) dir.create({ intermediates: true })
  const dest = new File(dir, `${id}.bin`)
  if (dest.exists) return dest.uri
  const file = await File.downloadFileAsync(`${API_BASE}/api/chat/attachments/${id}`, dest, {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    idempotent: true,
  })
  return file.uri
}

// ==================== 移动端专属：文件上传 ====================

/** 从 .json 文件上传技能（multipart，字段名 file）。RN FormData 文件对象写法：{uri,name,type} */
export async function uploadSkillFile(file: {
  uri: string
  name: string
  type?: string
}): Promise<{ message: string; name: string }> {
  const fd = new FormData()
  fd.append('file', { uri: file.uri, name: file.name, type: file.type || 'application/json' } as any)
  return client.api('/api/skills/upload', { method: 'POST', body: fd })
}

/**
 * 上传知识文档（txt/md/pdf/office/html）。用 XHR 而非 fetch：需要上传进度。
 * 进度到 100% 后到收到响应之间是服务端「切块+向量化」时间（首次可能十几秒）。
 * 注意超时必须设置得足够大：Android OkHttp 默认 read timeout 10s，
 * 响应在向量化完成后才返回，不设超时会在处理阶段被误杀。
 */
export async function uploadDocument(
  file: UploadFileSource,
  onProgress?: (percent: number) => void,
): Promise<{ id: number; docName: string; chunks: number }> {
  const token = await getToken()
  const formData = new FormData()
  formData.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.type || 'application/octet-stream',
  } as any)
  return uploadWithProgress({
    url: `${API_BASE}/api/knowledge/upload`,
    token,
    formData,
    onProgress,
    timeoutMs: 180000,
    onUnauthorized: fireUnauthorized,
  })
}

// ==================== 移动端专属：SSE 传输（react-native-sse） ====================

export interface StreamChatHandlers extends ChatStreamHandlers {}

/**
 * 流式对话（SSE）：POST /api/chat/stream 逐 token 推送。
 * 使用 react-native-sse（XHR 增量解析，token 实时到达）。
 *
 * 注意：该库只能读取事件流、读不到响应头，故 traceId 由客户端生成并随 X-Trace-Id 上送。
 */
export async function streamChat(
  message: string,
  conversationId: number,
  handlers: StreamChatHandlers,
  images?: ChatImageInput[],
): Promise<StreamHandle> {
  const token = await getToken()
  const traceId = uuidv4()
  const { headers, body } = buildChatStreamRequest({
    message,
    conversationId,
    images,
    token,
    traceId,
    headers: {
      // 关键：要求不压缩。若服务器 gzip 压缩 SSE，字节流里没有字面换行，
      // react-native-sse 无法识别行结束符导致解析不出 token。
      'Accept-Encoding': 'identity',
    },
  })

  const es = new EventSource<string>(`${API_BASE}/api/chat/stream`, {
    method: 'POST',
    headers,
    body,
    // 0 = 禁用轮询/重连，走 XHR 流式读取（LOADING 状态下增量解析）
    pollingInterval: 0,
  })

  const dispatcher = createChatEventDispatcher(handlers, (err) => {
    es.close()
    handlers.onError?.(err)
  })

  /** 注册指定命名事件（库只派发预先 addEventListener 过的类型） */
  const on = (type: string, fn: (data: string) => void) => {
    es.addEventListener(
      type as any,
      ((event: any) => {
        if (event?.data == null) return
        fn(String(event.data))
      }) as any,
    )
  }

  on('message', (data) => {
    if (dispatcher.dispatch(null, data)) es.close()
  })
  on('tool', (data) => dispatcher.dispatch('tool', data))
  on('rag', (data) => dispatcher.dispatch('rag', data))
  on('delegation', (data) => dispatcher.dispatch('delegation', data))
  on('usage', (data) => dispatcher.dispatch('usage', data))
  on('trace-reset', (data) => dispatcher.dispatch('trace-reset', data))
  on('approval-request', (data) => dispatcher.dispatch('approval-request', data))

  const errorListener = (event: any) => {
    if (event?.type !== 'error') return
    // 服务端命名 error 事件（HTTP 200，带 data）→ 交给共享分发器
    if (typeof event.data === 'string' && event.data) {
      dispatcher.dispatch('error', event.data)
      es.close()
      return
    }
    es.close()
    // XHR 层错误（含 xhrStatus）
    if (!('xhrStatus' in event)) {
      handlers.onError?.(new ApiError('连接中断，请重试', 0))
      return
    }
    const status: number = event.xhrStatus
    let message = '网络连接失败'
    if (status === 401) {
      fireUnauthorized()
      message = '登录已过期，请重新登录'
    } else if (status === 429) {
      message = '操作过于频繁或今日用量已达上限，请稍后再试'
    } else if (status > 0) {
      message = `请求失败 (${status})`
    }
    handlers.onError?.(new ApiError(message, status))
  }
  es.addEventListener('error', errorListener)

  handlers.onTraceId?.(traceId)
  return { close: () => es.close() }
}

// 共享分发器的事件名类型在移动端仅用于类型对齐（避免误传字符串）
export type { SseEventName }
