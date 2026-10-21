import { useEffect, useRef } from 'react'
import { App as AntdApp } from 'antd'
import { useNavigate } from 'react-router-dom'
import {
  listNotifications,
  markNotificationRead,
  streamNotifications,
  type AppNotification,
} from '../api'

/**
 * PC 站内通知（P2-9 M2 + P1-E）：SSE 实时推送 + 游标轮询兜底 + 站内 toast + 浏览器系统通知。
 *
 * - 挂载于 MainLayout（登录后全局生效）：优先建立 SSE 长连接，事件到达即提示；
 *   SSE 断开时回退到前台 30s / 后台（document.hidden）120s 轮询，重连后恢复实时；
 * - 游标（localStorage）跨标签共享：刷新/离线后从上次位置补齐，通知不丢；
 * - 多标签去重：localStorage 心跳选主标签，只有主标签弹通知（可见标签优先），
 *   已消费 id 经 BroadcastChannel 广播；竞态下收到他标签的消费广播即让位，杜绝重复提示；
 * - 天花板：所有标签页关闭后系统通知不可达（结果始终保留在任务专属会话中）；
 *   关页可达需 Web Push（SW+VAPID），与移动端 Expo Push 一起远期评估。
 */

/** 已消费游标（最大通知 id） */
const CURSOR_KEY = 'agent_notif_cursor'
const CHANNEL_NAME = 'agent-notifications'
const LEADER_KEY = 'agent_notif_leader'
/** 前台轮询节拍 */
const FOREGROUND_MS = 30_000
/** 后台（页面不可见）轮询节拍 */
const BACKGROUND_MS = 120_000
/** 主标签心跳超时（超过即视为主标签已关闭，可抢占） */
const LEADER_STALE_MS = 12_000
const PAGE_SIZE = 20
const MAX_PAGES_PER_TICK = 5
/** 首次运行（本浏览器无游标）：只提示最近 10 分钟内的未读，避免历史通知刷屏 */
const BOOTSTRAP_WINDOW_MS = 10 * 60 * 1000
/** SSE 已连接时的兜底轮询节拍（防止漏推/代理缓存导致的丢事件） */
const FALLBACK_WITH_SSE_MS = 5 * 60 * 1000
/** SSE 断线重连间隔 */
const SSE_RETRY_MS = 5_000

const TAB_ID = Math.random().toString(36).slice(2)

interface LeaderRecord {
  id?: string
  ts?: number
  hidden?: boolean
}

function readCursor(): number {
  const n = Number(localStorage.getItem(CURSOR_KEY) || 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function readLeader(): LeaderRecord | null {
  try {
    return JSON.parse(localStorage.getItem(LEADER_KEY) || 'null') as LeaderRecord | null
  } catch {
    return null
  }
}

/** 心跳：续约或抢占主标签（可见标签优先于隐藏标签；存储不可用时退化为各自提示） */
function acquireOrRenewLeadership(): boolean {
  const now = Date.now()
  const cur = readLeader()
  const mine = cur?.id === TAB_ID
  const stale = !cur?.ts || now - cur.ts > LEADER_STALE_MS
  const visibleBeatsHidden = !!cur && cur.hidden === true && !document.hidden
  if (mine || stale || visibleBeatsHidden) {
    try {
      localStorage.setItem(LEADER_KEY, JSON.stringify({ id: TAB_ID, ts: now, hidden: document.hidden }))
    } catch {
      /* 隐私模式等存储不可用：本标签自行提示（可能多标签重复，功能不缺失） */
    }
    return true
  }
  return false
}

/** 收到他标签的消费广播：让出主标签地位（竞态双主的收敛，避免重复提示） */
function yieldLeadership(otherTabId: string) {
  const cur = readLeader()
  if (cur?.id === TAB_ID) {
    try {
      localStorage.setItem(LEADER_KEY, JSON.stringify({ id: otherTabId, ts: Date.now(), hidden: false }))
    } catch {
      /* 忽略 */
    }
  }
}

/** 系统通知能力是否可用（权限已授权） */
function osNotificationReady(): boolean {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted'
}

/**
 * 发一条测试系统通知（任务页手动触发/授权成功后调用），返回结果供界面提示。
 * 用于自检「权限是否真的生效、系统是否屏蔽」——这是唯一无法从服务端验证的环节。
 */
export function fireTestNotification(): { ok: boolean; reason?: string } {
  if (typeof Notification === 'undefined') {
    return { ok: false, reason: '当前浏览器不支持系统通知（http 页面或旧浏览器）' }
  }
  if (Notification.permission !== 'granted') {
    return { ok: false, reason: '尚未获得通知权限，请点击开关重新授权' }
  }
  try {
    const sys = new Notification('浏览器通知已生效', {
      body: '任务完成后会以这种方式提醒你；点击可跳转到任务会话',
      tag: 'agent-notify-test',
    })
    sys.onclick = () => window.focus()
    return { ok: true }
  } catch (e: any) {
    return { ok: false, reason: e?.message || '系统通知发送失败' }
  }
}

export function useNotifications(enabled: boolean) {
  const { notification } = AntdApp.useApp()
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false
    let running = false
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null

    const show = (n: AppNotification) => {
      const openTarget = () => {
        // 点击即标记已读（best-effort）
        void markNotificationRead(n.id).catch(() => {})
        window.focus()
        if (n.targetConversationId) {
          navigateRef.current(`/chat?conversationId=${n.targetConversationId}`)
        }
      }
      notification.open({
        message: n.title,
        description: n.body || undefined,
        placement: 'topRight',
        duration: 8,
        onClick: openTarget,
      })
      // 浏览器系统通知（仅授权后；失败不影响站内 toast）
      if (osNotificationReady()) {
        try {
          const sys = new Notification(n.title, { body: n.body || '', tag: `agent-notif-${n.id}` })
          sys.onclick = openTarget
        } catch {
          /* 忽略 */
        }
      }
    }

    const fetchAndShow = async () => {
      const bootstrap = readCursor() === 0
      for (let page = 0; page < MAX_PAGES_PER_TICK; page++) {
        const list = await listNotifications(readCursor(), PAGE_SIZE)
        if (list.length === 0) return
        // 先推进游标再提示：宁可极端情况下少提示一次，也不重复提示
        const maxId = list[list.length - 1].id
        localStorage.setItem(CURSOR_KEY, String(maxId))
        const toastable = bootstrap
          ? list.filter(
              (n) => !n.read && Date.now() - new Date(n.createdAt).getTime() < BOOTSTRAP_WINDOW_MS,
            )
          : list
        for (const n of toastable) show(n)
        channel?.postMessage({ type: 'consumed', tabId: TAB_ID, cursor: maxId })
        if (list.length < PAGE_SIZE) return
      }
    }

    /**
     * 是否可消费新通知：可见标签随时可；隐藏标签仅在有系统通知能力时消费——
     * 否则通知会在用户看不到的地方（后台标签）被消耗掉，回到页面时反而什么都看不到。
     */
    const canConsume = () => !document.hidden || osNotificationReady()

    const tick = async () => {
      if (cancelled || running) return
      running = true
      try {
        if (acquireOrRenewLeadership() && canConsume()) {
          await fetchAndShow()
        }
      } catch {
        // 网络抖动/401（api() 已统一处理跳登录）：下一轮重试
      } finally {
        running = false
        schedule()
      }
    }

    const schedule = () => {
      if (cancelled) return
      if (timer) clearTimeout(timer)
      // SSE 在线时轮询降频为兜底；断线时恢复到常规节拍
      const interval = sseConnected
        ? FALLBACK_WITH_SSE_MS
        : (document.hidden ? BACKGROUND_MS : FOREGROUND_MS)
      timer = setTimeout(() => void tick(), interval)
    }

    /** 可见性变化：立即重跑一轮（可见标签抢占隐藏主标签，保证前台 30s 节拍） */
    const wake = () => {
      if (timer) clearTimeout(timer)
      void tick()
    }

    channel?.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as { type?: string; tabId?: string } | null
      if (data?.type === 'consumed' && data.tabId && data.tabId !== TAB_ID) {
        yieldLeadership(data.tabId)
      }
    })

    // ===== P1-E：SSE 实时推送（主标签消费，其余标签靠游标补齐） =====
    let sseAbort: AbortController | null = null
    let sseRetry: ReturnType<typeof setTimeout> | null = null
    let sseConnected = false

    const consumePush = (n: AppNotification) => {
      // 已在游标之前的（断线期间的旧通知）：交给轮询补齐，避免重复提示
      if (!n?.id || n.id <= readCursor()) return
      if (!acquireOrRenewLeadership() || !canConsume()) return
      localStorage.setItem(CURSOR_KEY, String(n.id))
      show(n)
      channel?.postMessage({ type: 'consumed', tabId: TAB_ID, cursor: n.id })
    }

    const connectSse = async () => {
      if (cancelled) return
      sseAbort = new AbortController()
      try {
        await streamNotifications({
          signal: sseAbort.signal,
          onOpen: () => {
            sseConnected = true
            // 重连成功先补一轮游标，覆盖断线期间遗漏的通知
            void tick()
          },
          onNotification: consumePush,
        })
      } catch {
        // 401/网络错误：交给轮询兜底，稍后重连
      }
      sseConnected = false
      if (!cancelled) {
        sseRetry = setTimeout(() => void connectSse(), SSE_RETRY_MS)
      }
    }

    document.addEventListener('visibilitychange', wake)
    void connectSse()
    void tick()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      if (sseRetry) clearTimeout(sseRetry)
      sseAbort?.abort()
      document.removeEventListener('visibilitychange', wake)
      channel?.close()
    }
  }, [enabled, notification])
}