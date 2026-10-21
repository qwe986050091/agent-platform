import { createReadStream, promises as fs } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { Readable } from 'node:stream'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'accept-encoding',
])

export interface WebServer {
  origin: string
  close: () => Promise<void>
}

/**
 * 桌面端内置静态服务器：
 * - 托管 Web 构建产物（BrowserRouter 的 history 路由需要服务器回退 index.html）；
 * - 把 /api/** 反代到远端 backend，避免 file:// 下的 CORS 与跨域 Cookie 问题；
 * - SSE 响应按流透传，聊天/通知的实时性不受影响。
 */
export async function startWebServer(options: {
  root: string
  apiOrigin: string
}): Promise<WebServer> {
  const root = path.resolve(options.root)
  const server = createServer((req, res) => {
    void handle(req, res, root, options.apiOrigin).catch((err) => {
      res.statusCode = 500
      res.end(`desktop server error: ${err?.message || err}`)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (server.address() as AddressInfo).port

  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
  apiOrigin: string,
): Promise<void> {
  const url = new URL(req.url || '/', 'http://127.0.0.1')

  if (url.pathname.startsWith('/api/')) {
    await proxyApi(req, res, url, apiOrigin)
    return
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.end('method not allowed')
    return
  }

  let filePath: string
  try {
    filePath = path.resolve(root, '.' + decodeURIComponent(url.pathname))
  } catch {
    res.statusCode = 400
    res.end('bad request')
    return
  }
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    res.statusCode = 403
    res.end('forbidden')
    return
  }

  let found = false
  try {
    const stat = await fs.stat(filePath)
    found = stat.isFile()
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html')
      found = await fs.stat(filePath).then((s) => s.isFile()).catch(() => false)
    }
  } catch {
    found = false
  }

  // 无扩展名的前端路由回退 index.html；带扩展名的缺失资源返回 404
  if (!found) {
    if (path.extname(url.pathname)) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    filePath = path.join(root, 'index.html')
    try {
      await fs.access(filePath)
    } catch {
      res.statusCode = 503
      res.end('web build not found, run `pnpm build:web` first')
      return
    }
  }

  const ext = path.extname(filePath).toLowerCase()
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
  res.setHeader(
    'Cache-Control',
    ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  )
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(filePath).pipe(res)
}

async function proxyApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  apiOrigin: string,
): Promise<void> {
  const target = new URL(url.pathname + url.search, apiOrigin)
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value || HOP_BY_HOP.has(key.toLowerCase())) continue
    headers.set(key, Array.isArray(value) ? value.join(',') : value)
  }

  let body: Buffer | undefined
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    body = Buffer.concat(chunks)
  }

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body,
  })

  res.statusCode = upstream.status
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    // fetch 会自动解压，content-length / encoding 与原始字节不再匹配，必须剔除
    if (HOP_BY_HOP.has(lower) || lower === 'content-encoding') return
    res.setHeader(key, value)
  })
  if (!upstream.body) {
    res.end()
    return
  }
  Readable.fromWeb(upstream.body as any).pipe(res)
}
