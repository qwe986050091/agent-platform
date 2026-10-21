import { useEffect, useRef } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import AsyncStorage from 'expo-sqlite/kv-store'
import { listNotifications, markNotificationRead, type AppNotification } from '../api'
import { addNotificationResponseListener, presentLocalNotification } from '../notifications'

const CURSOR_KEY = 'agent_notif_cursor'
const FOREGROUND_MS = 30_000
const BACKGROUND_MS = 120_000
const PAGE_SIZE = 20
const MAX_PAGES_PER_TICK = 5
/** 首发无游标时只提示最近 10 分钟内的未读，避免补推历史通知 */
const BOOTSTRAP_WINDOW_MS = 10 * 60 * 1000

interface Options {
  enabled: boolean
  /** 通知被点击/触发（跳转目标会话） */
  onOpen: (n: AppNotification) => void
  /** 应用内提示条（无系统通知权限/Expo Go 时的退化展示） */
  onInApp?: (n: AppNotification) => void
}

/**
 * 站内通知轮询：光标存在本地（kv-store），先推进光标再提示（宁少不重）；
 * 前台 30s / 后台 120s 轮询；点击系统通知或应用内提示条跳转任务会话。
 * 系统通知在 Expo Go 下不可用（expo-notifications 被移除），自动退化为应用内提示条。
 */
export function useNotifications({ enabled, onOpen, onInApp }: Options) {
  const appStateRef = useRef<AppStateStatus>(AppState.currentState)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runningRef = useRef(false)
  const recentRef = useRef<Map<number, AppNotification>>(new Map())
  const onOpenRef = useRef(onOpen)
  const onInAppRef = useRef(onInApp)
  onOpenRef.current = onOpen
  onInAppRef.current = onInApp

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let respSub: { remove: () => void } | null = null

    const open = async (n: AppNotification) => {
      try {
        await markNotificationRead(n.id)
      } catch {
        // best-effort
      }
      onOpenRef.current(n)
    }

    const show = (n: AppNotification) => {
      recentRef.current.set(n.id, n)
      void presentLocalNotification(n.title, n.body || undefined, {
        notificationId: n.id,
        conversationId: n.targetConversationId ?? undefined,
      })
      onInAppRef.current?.(n)
    }

    const fetchAndShow = async () => {
      const raw = await AsyncStorage.getItem(CURSOR_KEY)
      let cursor = raw ? Number(raw) : 0
      if (!Number.isFinite(cursor)) cursor = 0
      const bootstrap = cursor === 0
      const now = Date.now()

      for (let page = 0; page < MAX_PAGES_PER_TICK; page++) {
        const list = await listNotifications(cursor, PAGE_SIZE)
        if (list.length === 0) break
        const maxId = list.reduce((m, n) => Math.max(m, n.id), cursor)
        // 先推进光标再提示：宁可少提示也不重复提示
        await AsyncStorage.setItem(CURSOR_KEY, String(maxId))
        const items = bootstrap
          ? list.filter((n) => !n.read && now - new Date(n.createdAt).getTime() <= BOOTSTRAP_WINDOW_MS)
          : list
        for (const n of items) show(n)
        cursor = maxId
        if (list.length < PAGE_SIZE) break
      }
    }

    const tick = async () => {
      if (runningRef.current || cancelled) return
      runningRef.current = true
      try {
        await fetchAndShow()
      } catch {
        // 网络/401 等：跳过本轮
      } finally {
        runningRef.current = false
      }
    }

    const schedule = () => {
      if (cancelled) return
      const delay = appStateRef.current === 'active' ? FOREGROUND_MS : BACKGROUND_MS
      timerRef.current = setTimeout(async () => {
        await tick()
        schedule()
      }, delay)
    }

    const appSub = AppState.addEventListener('change', (s) => {
      appStateRef.current = s
    })

    // 点击系统通知：用最近展示过的通知还原（含目标会话），否则用通知 data 兜底
    void addNotificationResponseListener((resp) => {
      const data = (resp.notification.request.content.data || {}) as Record<string, unknown>
      const id = Number(data.notificationId)
      const cached = Number.isFinite(id) ? recentRef.current.get(id) : undefined
      if (cached) {
        void open(cached)
        return
      }
      const conv = data.conversationId != null ? Number(data.conversationId) : NaN
      void open({
        id: Number.isFinite(id) ? id : -1,
        type: 'task_result',
        title: String(resp.notification.request.content.title || ''),
        body: null,
        targetConversationId: Number.isFinite(conv) ? conv : null,
        read: false,
        createdAt: new Date().toISOString(),
      })
    }).then((sub) => {
      respSub = sub
    })

    void tick()
    schedule()

    return () => {
      cancelled = true
      appSub.remove()
      respSub?.remove()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [enabled])
}
