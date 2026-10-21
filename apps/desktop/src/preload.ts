import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge, DesktopMcpStatus } from '@agent/types'

/** 只向渲染进程暴露白名单能力，禁止直接拿到 Node/Electron 对象 */
const bridge: DesktopBridge = {
  isDesktop: true,
  mcp: {
    getStatus: () => ipcRenderer.invoke('desktop:mcp-status') as Promise<DesktopMcpStatus>,
    onStatus: (callback) => {
      const listener = (_event: unknown, status: DesktopMcpStatus) => callback(status)
      ipcRenderer.on('desktop:mcp-status', listener)
      return () => ipcRenderer.removeListener('desktop:mcp-status', listener)
    },
  },
}

contextBridge.exposeInMainWorld('agentDesktop', bridge)
