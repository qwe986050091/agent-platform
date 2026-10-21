#!/usr/bin/env node
/**
 * 自托管 OTA（expo-updates）发布工具。
 *
 * 原理：App 启动时 GET https://api.zlfshop.cn/updates（带 expo-platform /
 * expo-runtime-version / expo-channel-name 请求头），服务端返回 manifest JSON 或 204。
 * 本脚本负责「导出 JS bundle → 生成 manifest → 上传产物 → 原子切换 current 指针」。
 *
 * 用法（在 d:\code\agent_mobile 目录下执行）：
 *   node scripts/ota.mjs publish  [channel]              # 发布（默认 preview）
 *   node scripts/ota.mjs list     [channel]              # 列出服务端已发布的 runtimeVersion / release
 *   node scripts/ota.mjs rollback [channel] [releaseId]  # 切回指定 release（不传则只列出）
 *   node scripts/ota.mjs status   [channel]              # 服务端健康 + 线上 manifest 实测
 *
 * 关键约束（依据 expo-updates SDK 57 源码）：
 *   - runtimeVersion 必须是固定字符串（app.json 的 `runtimeVersion`），**不要用 fingerprint 策略**：
 *     fingerprint 会把 node_modules/.pnpm 的虚拟目录名算进哈希，而 pnpm 在 Windows 本机与 EAS 的
 *     Linux 上目录名不同（本机被截断），导致两端指纹不一致，EAS 构建会以
 *     "Runtime version calculated on local machine not equal to ... during build" 直接失败。
 *     代价：改动原生依赖后要手动 bump app.json 的 runtimeVersion，否则更新会推给不兼容的旧包。
 *   - manifest 里 asset 的 key 必须等于 export 产物中资源文件名（MD5），
 *     JS 侧 expo-asset 按该 hash 查本地文件，改了就白图/丢图。
 *   - asset hash = 文件内容 SHA-256 的 base64url（无 padding），客户端下载后会校验。
 */

import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SSH_HOST = 'new'
const PLATFORM = 'android'
const REMOTE_ACTIVATE = '/opt/agent/updates-server/ota-activate.sh'
const REMOTE_RELEASES = '/opt/agent/updates/releases'
const PUBLIC_MANIFEST_URL = 'https://api.zlfshop.cn/updates'
const PROJECT_ID = '7eecf25a-52cf-48ca-9707-c3734a52e2e8'

const EXPORT_DIR = path.join(PROJECT_ROOT, '.ota-export')
const RELEASE_DIR = path.join(PROJECT_ROOT, '.ota-release')
const TARBALL = path.join(PROJECT_ROOT, '.ota-release.tar.gz')

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  mp4: 'video/mp4',
  json: 'application/json',
  pdf: 'application/pdf',
}

// ---------------------------------------------------------------- 进程封装

/** 通过 shell 执行（用于 npx / tar 这类需要 PATH 解析的命令） */
function shell(cmdline, { capture = false, allowFail = false } = {}) {
  const res = spawnSync(cmdline, {
    cwd: PROJECT_ROOT,
    shell: true,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  })
  if (res.error) throw res.error
  if (res.status !== 0 && !allowFail) {
    throw new Error(`命令失败(exit ${res.status}): ${cmdline}`)
  }
  return `${res.stdout || ''}${res.stderr || ''}`
}

/** 直接 spawn（不经过 shell，避免 Windows 引号/路径被二次解释） */
function bin(file, args, { capture = false, allowFail = false } = {}) {
  const res = spawnSync(file, args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  })
  if (res.error) throw res.error
  if (res.status !== 0 && !allowFail) {
    throw new Error(`命令失败(exit ${res.status}): ${file} ${args.join(' ')}`)
  }
  return `${res.stdout || ''}${res.stderr || ''}`
}

function ssh(remoteCmd, opts) {
  return bin('ssh', [SSH_HOST, remoteCmd], opts)
}

function sha256b64url(buf) {
  return createHash('sha256').update(buf).digest('base64url')
}

function toPosix(p) {
  return p.split(/[\\/]/).join('/')
}

function releaseIdNow() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

// ---------------------------------------------------------------- publish

function runtimeVersion() {
  const appJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'app.json'), 'utf8'))
  const expo = appJson.expo || {}
  const rtv = expo.runtimeVersion
  if (typeof rtv === 'string' && rtv) return rtv
  if (rtv && rtv.policy === 'appVersion') return expo.version
  throw new Error(
    'app.json 的 runtimeVersion 必须是固定字符串（或 appVersion 策略）。' +
      'fingerprint 策略在 Windows+pnpm 的 EAS 构建下会因两端指纹不一致而导致构建失败，请勿使用。',
  )
}

function buildRelease(rt) {
  fs.rmSync(EXPORT_DIR, { recursive: true, force: true })
  fs.rmSync(RELEASE_DIR, { recursive: true, force: true })

  console.log('\n== 1/4 导出 JS bundle（expo export）==')
  shell(`npx expo export --platform ${PLATFORM} --output-dir .ota-export`)

  console.log('== 2/4 生成 manifest ==')
  const meta = JSON.parse(fs.readFileSync(path.join(EXPORT_DIR, 'metadata.json'), 'utf8'))
  const platMeta = meta.fileMetadata?.[PLATFORM]
  if (!platMeta?.bundle) throw new Error('metadata.json 缺少 bundle 信息（expo-updates 未正确安装？）')

  fs.mkdirSync(path.join(RELEASE_DIR, 'assets'), { recursive: true })

  const bundleSrc = path.join(EXPORT_DIR, platMeta.bundle)
  const bundleDst = path.join(RELEASE_DIR, 'bundle.hbc')
  fs.copyFileSync(bundleSrc, bundleDst)

  const assets = []
  for (const a of platMeta.assets || []) {
    const rel = toPosix(a.path)
    const name = path.posix.basename(rel)
    const src = path.join(EXPORT_DIR, rel)
    const buf = fs.readFileSync(src)
    fs.copyFileSync(src, path.join(RELEASE_DIR, 'assets', name))
    assets.push({
      // key 必须是 export 产物里的 MD5 文件名：JS 侧按该 hash 找本地文件
      key: name,
      fileExtension: a.ext,
      contentType: MIME[a.ext] || 'application/octet-stream',
      url: `assets/${name}`,
      hash: sha256b64url(buf),
    })
  }

  const manifest = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    runtimeVersion: rt,
    launchAsset: {
      key: 'bundle',
      url: 'bundle.hbc',
      contentType: 'application/javascript',
      hash: sha256b64url(fs.readFileSync(bundleDst)),
    },
    assets,
    metadata: {},
    extra: { eas: { projectId: PROJECT_ID } },
  }
  fs.writeFileSync(path.join(RELEASE_DIR, 'manifest.json'), JSON.stringify(manifest))
  const bundleKB = Math.round(fs.statSync(bundleDst).size / 1024)
  console.log(`   bundle ${bundleKB}KB，assets ${assets.length} 个，runtimeVersion ${rt}`)
  return manifest
}

function uploadAndActivate(channel, rt, rid) {
  console.log('== 3/4 上传产物 ==')
  fs.rmSync(TARBALL, { force: true })
  shell(`tar -czf "${TARBALL}" -C "${RELEASE_DIR}" .`)
  const remoteTar = `/tmp/ota-${rid}.tar.gz`
  bin('scp', ['-q', TARBALL, `${SSH_HOST}:${remoteTar}`])

  console.log('== 4/4 激活 ==')
  return ssh(
    `${REMOTE_ACTIVATE} deploy ${channel} ${PLATFORM} ${rt} ${rid} ${remoteTar}; RC=$?; rm -f ${remoteTar}; exit $RC`,
    { capture: true },
  )
}

async function verify(channel, rt, expectedBundleBytes) {
  console.log('\n== 验收 ==')
  const headers = {
    'expo-platform': PLATFORM,
    'expo-runtime-version': rt,
    'expo-channel-name': channel,
  }
  const res = await fetch(PUBLIC_MANIFEST_URL, { headers })
  const proto = res.headers.get('expo-protocol-version')
  console.log(`   manifest HTTP ${res.status}，expo-protocol-version=${proto}`)
  if (res.status !== 200) throw new Error(`线上 manifest 期望 200，实际 ${res.status}`)
  if (proto !== '1') throw new Error('响应缺少 expo-protocol-version: 1')

  const manifest = await res.json()
  if (manifest.runtimeVersion !== rt) throw new Error('manifest runtimeVersion 与本次发布不一致')
  console.log(`   更新 id=${manifest.id}，assets=${manifest.assets.length}`)

  const bundleRes = await fetch(manifest.launchAsset.url)
  const bytes = Buffer.from(await bundleRes.arrayBuffer())
  console.log(`   bundle HTTP ${bundleRes.status}，${Math.round(bytes.length / 1024)}KB`)
  if (!bundleRes.ok) throw new Error('bundle 下载失败')
  if (sha256b64url(bytes) !== manifest.launchAsset.hash) throw new Error('bundle hash 校验失败')
  if (expectedBundleBytes != null && bytes.length !== expectedBundleBytes) {
    throw new Error(`bundle 大小与本地不一致（本地 ${expectedBundleBytes}，线上 ${bytes.length}）`)
  }

  // 无更新分支：用一个不存在的 runtimeVersion 必须拿到 204
  const none = await fetch(PUBLIC_MANIFEST_URL, {
    headers: { ...headers, 'expo-runtime-version': 'nonexistent-probe' },
  })
  console.log(`   无更新分支 HTTP ${none.status}（期望 204）`)
  console.log('\n发布完成。App 冷启动两次即可生效（首次下载、次次应用）。')
}

// ---------------------------------------------------------------- 子命令

function currentRuntimeVersions(channel) {
  const out = ssh(`ls -1 ${REMOTE_RELEASES}/${channel}/${PLATFORM} 2>/dev/null || true`, { capture: true })
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
}

function listReleases(channel) {
  const rts = currentRuntimeVersions(channel)
  if (!rts.length) {
    console.log(`服务端还没有任何已发布版本（${channel}/${PLATFORM}）`)
    return rts
  }
  for (const rt of rts) {
    const out = ssh(
      `R=${REMOTE_RELEASES}/${channel}/${PLATFORM}/${rt}; ` +
        `cur=$(cat "$R/current" 2>/dev/null || echo none); ` +
        `printf 'runtimeVersion %s  current: %s\\n' '${rt}' "$cur"; ` +
        `ls -1 "$R" | grep -v -x current | sed 's/^/    - /'`,
      { capture: true },
    )
    process.stdout.write(out)
  }
  return rts
}

function rollback(channel, rid) {
  const rts = currentRuntimeVersions(channel)
  if (!rts.length) throw new Error(`服务端没有已发布版本（${channel}/${PLATFORM}）`)
  if (!rid) {
    console.log('未指定 releaseId，当前发布记录如下：')
    listReleases(channel)
    console.log(`\n切换用法：node scripts/ota.mjs rollback ${channel} <releaseId>`)
    return
  }
  let targetRt = null
  for (const rt of rts) {
    const found = ssh(
      `test -f ${REMOTE_RELEASES}/${channel}/${PLATFORM}/${rt}/${rid}/manifest.json && echo yes || true`,
      { capture: true },
    )
    if (found.trim() === 'yes') {
      targetRt = rt
      break
    }
  }
  if (!targetRt) throw new Error(`找不到 releaseId=${rid} 的发布记录（channel=${channel}）`)
  const out = ssh(`${REMOTE_ACTIVATE} switch ${channel} ${PLATFORM} ${targetRt} ${rid}`, { capture: true })
  process.stdout.write(out)
}

async function status(channel) {
  const health = ssh(`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8082/updates/health`, {
    capture: true,
  })
  console.log(`updates-server health(本地): ${health.trim()}`)
  const act = ssh(`systemctl is-active updates-server`, { capture: true, allowFail: true })
  console.log(`systemd updates-server: ${act.trim()}`)
  const rts = listReleases(channel)
  if (!rts.length) return
  const probe = await fetch(PUBLIC_MANIFEST_URL, {
    headers: { 'expo-platform': PLATFORM, 'expo-runtime-version': rts[0], 'expo-channel-name': channel },
  })
  console.log(`线上 manifest(${rts[0]}): HTTP ${probe.status}`)
}

// ---------------------------------------------------------------- 入口

async function main() {
  const cmd = process.argv[2] || 'publish'
  const channel = process.argv[3] || 'preview'

  if (cmd === 'publish') {
    const rt = runtimeVersion()
    console.log(`runtimeVersion(app.json) = ${rt}`)
    const manifest = buildRelease(rt)
    const rid = releaseIdNow()
    const out = uploadAndActivate(channel, rt, rid)
    process.stdout.write(out)
    await verify(channel, rt, fs.statSync(path.join(RELEASE_DIR, 'bundle.hbc')).size)
    return
  }
  if (cmd === 'list') return void listReleases(channel)
  if (cmd === 'rollback') return void rollback(channel, process.argv[4])
  if (cmd === 'status') return void (await status(channel))

  console.log('用法: node scripts/ota.mjs <publish|list|rollback|status> [channel] [releaseId]')
  process.exit(2)
}

main().catch((err) => {
  console.error(`\n失败: ${err.message}`)
  process.exit(1)
})
