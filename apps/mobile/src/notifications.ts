/**
 * 本地通知封装（懒加载 + 降级）。
 *
 * 关键背景：Expo Go（storeClient）在 SDK 53+ 移除了 expo-notifications 的推送能力，
 * 该模块在 Android Expo Go 里「被 import 时就会抛错」，静态导入会导致整个 App 红屏。
 * 因此这里一律用动态 import 懒加载：加载失败（Expo Go / web / 无原生模块）时返回 null，
 * 所有能力自动降级 —— 站内通知退化为应用内提示条（App.tsx 的 NotifBanner）。
 * 需要真正的系统通知时使用 development build。
 */
import { Platform } from 'react-native'
import { isRunningInExpoGo } from 'expo'

type NotificationsModule = typeof import('expo-notifications')
type NotificationResponse = import('expo-notifications').NotificationResponse

let loaded: Promise<NotificationsModule | null> | null = null

/** 当前是否运行在 Expo Go（其 Android 端无法使用 expo-notifications） */
function inExpoGo(): boolean {
  try {
    return isRunningInExpoGo()
  } catch {
    return false
  }
}

/**
 * 懒加载 expo-notifications；不可用时返回 null（不抛错）。
 *
 * 必须在 Expo Go 下「短路、绝不 import」：该模块 index 顶层会执行
 * DevicePushTokenAutoRegistration.fx → addPushTokenListener → warnOfExpoGoPushUsage，
 * 而后者在 Android Expo Go 里直接 `throw`；这个错误发生在模块求值期，
 * 即便用动态 import 的 .catch 也拦不住（会以未捕获错误冒泡，LogBox 红屏）。
 * 因此这里先判断环境，Expo Go 直接返回 null，能力降级为应用内提示条。
 */
export function loadNotifications(): Promise<NotificationsModule | null> {
  if (inExpoGo()) return Promise.resolve(null)
  if (!loaded) {
    loaded = import('expo-notifications')
      .then((m) => m as NotificationsModule)
      .catch(() => null)
  }
  return loaded
}

/** 应用启动时配置前台通知展示行为（不可用时静默跳过） */
export async function setupNotificationHandler(): Promise<void> {
  const N = await loadNotifications()
  if (!N) return
  try {
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    })
  } catch {
    // 平台不支持：忽略
  }
}

/** 'unsupported' = 当前运行环境无法使用系统通知（如 Expo Go），退化为应用内提示 */
export type NotifPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported'

/** 通知能力是否可用（Expo Go / web 下为 false） */
export async function notificationsAvailable(): Promise<boolean> {
  return (await loadNotifications()) != null
}

/** 读取当前通知权限 */
export async function getNotifPermission(): Promise<NotifPermission> {
  const N = await loadNotifications()
  if (!N) return 'unsupported'
  try {
    const p = await N.getPermissionsAsync()
    if (p.granted) return 'granted'
    return p.canAskAgain ? 'undetermined' : 'denied'
  } catch {
    return 'unsupported'
  }
}

/** 申请通知权限（必须由用户手势触发），Android 顺带建默认 channel */
export async function requestNotifPermission(): Promise<NotifPermission> {
  const N = await loadNotifications()
  if (!N) return 'unsupported'
  try {
    const p = await N.requestPermissionsAsync()
    if (p.granted && Platform.OS === 'android') {
      await N.setNotificationChannelAsync('default', {
        name: '任务通知',
        importance: N.AndroidImportance.DEFAULT,
      })
    }
    return p.granted ? 'granted' : 'denied'
  } catch {
    return 'unsupported'
  }
}

/** 立即弹一条本地通知（未授权/不可用时静默） */
export async function presentLocalNotification(
  title: string,
  body?: string,
  data?: Record<string, unknown>,
): Promise<void> {
  const N = await loadNotifications()
  if (!N) return
  try {
    await N.scheduleNotificationAsync({
      content: { title, body: body || undefined, data },
      trigger: null,
    })
  } catch {
    // 未授权/不支持：静默，退化为应用内提示
  }
}

/** 监听系统通知的点击（不可用时返回 null） */
export async function addNotificationResponseListener(
  listener: (resp: NotificationResponse) => void,
): Promise<{ remove: () => void } | null> {
  const N = await loadNotifications()
  if (!N) return null
  try {
    return N.addNotificationResponseReceivedListener(listener)
  } catch {
    return null
  }
}
