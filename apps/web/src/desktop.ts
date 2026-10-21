import type { DesktopBridge } from '@agent/types'

declare global {
  interface Window {
    /** Electron preload 注入（仅桌面端存在） */
    agentDesktop?: DesktopBridge
  }
}

/** 桌面端桥（浏览器 / 移动端返回 undefined，调用方据此做条件渲染） */
export function getDesktopBridge(): DesktopBridge | undefined {
  return typeof window !== 'undefined' ? window.agentDesktop : undefined
}
