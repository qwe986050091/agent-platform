import { ApiError } from './error'
import type {
  ApprovalRequestData,
  DelegationTrace,
  RagTrace,
  ToolTrace,
  UsageTrace,
} from '@agent/types'

/**
 * SSE 事件名。协议本身是开放的字符串（服务端可能新增 memory 等内部事件），
 * 这里保留 string 以便解析器通用；聊天业务只对已知事件做语义分发。
 */
export type SseEventName = string | null

export type SseEventHandler = (eventName: SseEventName, data: string) => void

/**
 * 增量 SSE 帧解析器（Web fetch 流专用）。
 *
 * EventSource 类库（移动端 react-native-sse）会自己完成分帧，
 * 但 Web 端必须手动处理跨 chunk 的半行/半事件，这里集中一份实现，
 * 避免 PC 端聊天流与通知流各写一份。
 */
export function createSseParser(onEvent: SseEventHandler) {
  let buffer = ''

  function emit(rawEvent: string) {
    const dataLines: string[] = []
    let eventName: SseEventName = null
    for (const line of rawEvent.split('\n')) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).replace(/^ +/, '') as SseEventName
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''))
      }
    }
    if (dataLines.length > 0) onEvent(eventName, dataLines.join('\n'))
  }

  return {
    push(chunk: string) {
      buffer += chunk
      buffer = buffer.replace(/\r\n/g, '\n')
      let sep: number
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        emit(rawEvent)
      }
    },
    flush() {
      if (buffer.trim()) {
        emit(buffer)
        buffer = ''
      }
    },
  }
}

// ==================== 聊天流事件语义 ====================

export interface StreamHandle {
  /** 主动中断生成（Web：abort fetch；移动端：close EventSource） */
  close: () => void
}

export interface ChatStreamHandlers {
  onToken: (token: string) => void
  /** 服务端以 [DONE] 正常收尾 */
  onDone?: () => void
  /** 移动端风格：运行期错误回调（不传时由调用方 await 抛错，PC 用） */
  onError?: (err: ApiError) => void
  onTool?: (tool: ToolTrace) => void
  onRag?: (rag: RagTrace) => void
  onDelegation?: (delegation: DelegationTrace) => void
  onUsage?: (usage: UsageTrace) => void
  onReset?: () => void
  onApproval?: (approval: ApprovalRequestData) => void
  onTraceId?: (traceId: string) => void
}

export interface ChatEventDispatcher {
  /** 返回 true 表示流已结束（[DONE]） */
  dispatch(eventName: SseEventName, data: string): boolean
  readonly done: boolean
}

/**
 * 把「SSE 事件」翻译成业务回调。两端共用，保证 tool / rag / delegation /
 * usage / approval-request / error / [DONE] 的语义完全一致。
 *
 * @param onError 命名 error 事件的出口：PC 用它 reject 等待中的 Promise，
 *                移动端用它调用 handlers.onError
 */
export function createChatEventDispatcher(
  handlers: ChatStreamHandlers,
  onError: (err: ApiError) => void,
): ChatEventDispatcher {
  let done = false

  return {
    get done() {
      return done
    },
    dispatch(eventName, data) {
      if (done) return true
      if (data === '[DONE]') {
        done = true
        handlers.onDone?.()
        return true
      }
      switch (eventName) {
        case 'tool':
          try {
            handlers.onTool?.(JSON.parse(data) as ToolTrace)
          } catch {
            /* 忽略坏事件 */
          }
          return false
        case 'rag':
          try {
            handlers.onRag?.(JSON.parse(data) as RagTrace)
          } catch {
            /* 忽略坏事件 */
          }
          return false
        case 'delegation':
          try {
            handlers.onDelegation?.(JSON.parse(data) as DelegationTrace)
          } catch {
            /* 忽略坏事件 */
          }
          return false
        case 'usage':
          try {
            handlers.onUsage?.(JSON.parse(data) as UsageTrace)
          } catch {
            /* 忽略坏事件 */
          }
          return false
        case 'trace-reset':
          handlers.onReset?.()
          return false
        case 'approval-request':
          try {
            handlers.onApproval?.(JSON.parse(data) as ApprovalRequestData)
          } catch {
            /* 忽略坏事件 */
          }
          return false
        case 'error': {
          let msg = '服务处理出错，请稍后重试'
          try {
            const parsed = JSON.parse(data) as { code?: string; message?: string }
            if (parsed.message) msg = parsed.message
          } catch {
            /* 坏 JSON 用默认文案 */
          }
          const err = new ApiError(msg, 200)
          done = true
          onError(err)
          return true
        }
        case null:
          handlers.onToken(data)
          return false
        default:
          // memory 等内部事件不到前端
          return false
      }
    },
  }
}
