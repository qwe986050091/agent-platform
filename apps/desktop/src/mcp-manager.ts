import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer, connect } from 'node:net'
import type { AddressInfo } from 'node:net'
import type { DesktopMcpStatus } from '@agent/types'

/** 本地拉起 mcp-server-go：HTTP 回环 + 随机共享密钥，只暴露给本机桌面端 */
export class McpServerManager {
  private child: ChildProcess | null = null
  private status: DesktopMcpStatus = { state: 'stopped' }
  private stderrTail = ''
  private listeners = new Set<(status: DesktopMcpStatus) => void>()

  constructor(private readonly candidates: string[]) {}

  getStatus(): DesktopMcpStatus {
    return this.status
  }

  onStatus(listener: (status: DesktopMcpStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private setStatus(next: DesktopMcpStatus) {
    this.status = next
    for (const listener of this.listeners) listener(next)
  }

  async start(): Promise<void> {
    if (this.child) return
    this.setStatus({ state: 'starting' })

    const bin = this.candidates.find((candidate) => candidate && existsSync(candidate))
    if (!bin) {
      this.setStatus({
        state: 'error',
        error: '未找到 mcp-server-go 可执行文件，可用 MCP_SERVER_BIN 指定路径',
      })
      return
    }

    const port = await this.findFreePort()
    const token = randomBytes(16).toString('hex')
    const args = [
      '--transport',
      'http',
      '--addr',
      `127.0.0.1:${port}`,
      '--path',
      '/mcp',
      '--token',
      token,
    ]

    let child: ChildProcess
    try {
      child = spawn(bin, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      })
    } catch (e: any) {
      this.setStatus({ state: 'error', error: `启动失败：${e?.message || e}` })
      return
    }
    this.child = child
    this.stderrTail = ''

    child.stderr?.on('data', (chunk: Buffer) => {
      // 只保留尾部，用于启动失败时给出可诊断的信息
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-2000)
    })
    child.on('error', (e) => {
      this.child = null
      this.setStatus({ state: 'error', error: `进程错误：${e.message}` })
    })
    child.on('exit', (code) => {
      const wasRunning = this.status.state === 'running' || this.status.state === 'starting'
      this.child = null
      if (!wasRunning) return
      this.setStatus({
        state: code === 0 ? 'stopped' : 'error',
        error: code === 0 ? undefined : `进程退出（code=${code}）${this.stderrTail ? '：' + this.stderrTail : ''}`,
      })
    })

    const ready = await waitForTcp('127.0.0.1', port, 8000, () => !this.child)
    if (!ready) {
      child.kill()
      this.setStatus({
        state: 'error',
        error: `启动超时${this.stderrTail ? '：' + this.stderrTail : ''}`,
      })
      return
    }

    this.setStatus({
      state: 'running',
      endpoint: `http://127.0.0.1:${port}/mcp`,
      pid: child.pid,
    })
  }

  stop(): void {
    const child = this.child
    this.child = null
    if (child && child.exitCode === null) child.kill()
    this.setStatus({ state: 'stopped' })
  }

  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const port = (server.address() as AddressInfo).port
        server.close(() => resolve(port))
      })
    })
  }
}

/** 轮询 TCP 连通性（MCP HTTP 传输没有通用健康端点，端口可连即视为已启动） */
function waitForTcp(
  host: string,
  port: number,
  timeoutMs: number,
  cancelled: () => boolean,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve) => {
    const attempt = () => {
      if (cancelled()) return resolve(false)
      if (Date.now() > deadline) return resolve(false)
      const socket = connect({ host, port })
      socket.setTimeout(500)
      const retry = () => {
        socket.destroy()
        setTimeout(attempt, 250)
      }
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('timeout', retry)
      socket.once('error', retry)
    }
    attempt()
  })
}
