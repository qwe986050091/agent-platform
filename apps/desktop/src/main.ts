import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { McpServerManager } from './mcp-manager'
import { startWebServer, type WebServer } from './static-server'

let win: BrowserWindow | null = null
let webServer: WebServer | null = null
let mcp: McpServerManager | null = null

/** Web 构建产物位置：支持环境变量覆盖（便于本地联调） */
function resolveWebRoot(): string {
  if (process.env.AGENT_WEB_DIST) return path.resolve(process.env.AGENT_WEB_DIST)
  if (app.isPackaged) return path.join(process.resourcesPath, 'web')
  // dev: apps/desktop → apps/web/dist
  return path.resolve(app.getAppPath(), '..', 'web', 'dist')
}

/** 本地 MCP Server 可执行文件候选路径（打包版 / 开发版 / 环境变量） */
function resolveMcpCandidates(): string[] {
  const exe = process.platform === 'win32' ? 'mcp-server-go.exe' : 'mcp-server-go'
  const appRoot = app.getAppPath()
  return [
    process.env.MCP_SERVER_BIN || '',
    app.isPackaged ? path.join(process.resourcesPath, 'mcp-server', exe) : '',
    // dev: apps/desktop → agent-platform → d:\code → mcp-server-go/bin
    path.resolve(appRoot, '..', '..', '..', 'mcp-server-go', 'bin', exe),
  ].filter(Boolean)
}

function createWindow(origin: string) {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'Agent AI Desktop',
    backgroundColor: '#f6f9ff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.on('closed', () => {
    win = null
  })
  void win.loadURL(origin)
}

async function bootstrap() {
  // 单实例：第二次启动只聚焦已有窗口（本地 MCP 端口与进程不重复拉起）
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  const webRoot = resolveWebRoot()
  if (!existsSync(path.join(webRoot, 'index.html'))) {
    // 仍启动窗口，由静态服务器返回可读提示
    console.warn(`[desktop] Web 产物不存在：${webRoot}（先执行 pnpm build:web）`)
  }

  webServer = await startWebServer({
    root: webRoot,
    apiOrigin: process.env.AGENT_API_ORIGIN || 'https://api.zlfshop.cn',
  })

  mcp = new McpServerManager(resolveMcpCandidates())
  mcp.onStatus((status) => {
    win?.webContents.send('desktop:mcp-status', status)
  })
  ipcMain.handle('desktop:mcp-status', () => mcp?.getStatus() ?? { state: 'stopped' })
  void mcp.start()

  createWindow(webServer.origin)
}

app.on('before-quit', () => {
  mcp?.stop()
  void webServer?.close()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (!win && webServer) createWindow(webServer.origin)
})

void app.whenReady().then(bootstrap)
