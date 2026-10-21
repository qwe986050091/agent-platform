import { useEffect, useState, type ReactNode } from 'react'
import { App, Collapse, Tag, Tooltip } from 'antd'
import {
  BookOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  CopyOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import type { DelegationTrace, RagTrace, ToolTrace, UsageTrace } from '../api'

/** 工具参数 JSON 紧凑展示（{"a":12.0,"b":8.0} → a=12, b=8 风格，超长截断） */
function compactArgs(raw?: string): string {
  if (!raw) return ''
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    return Object.entries(obj)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(', ')
  } catch {
    return raw
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}

/** 按发起 Agent 分组的工具调用组：null=主 Agent（顶层），非空=子代理技能名（Agent-as-Tool 嵌套归属） */
interface ToolGroup {
  key: string
  label: string
  isSub: boolean
  tools: ToolTrace[]
}

/** 工具调用按 Agent 归属分组（保持首次出现顺序）；无子代理时只有一组，由调用方决定是否展示分组头 */
function groupToolsByAgent(list: ToolTrace[]): ToolGroup[] {
  const order: string[] = []
  const buckets = new Map<string, ToolTrace[]>()
  for (const t of list) {
    const sub = t.agentId && t.agentId.trim() ? t.agentId.trim() : ''
    const id = sub ? `sub:${sub}` : 'main'
    if (!buckets.has(id)) {
      buckets.set(id, [])
      order.push(id)
    }
    buckets.get(id)!.push(t)
  }
  return order.map((id) => ({
    key: id,
    label: id === 'main' ? '主 Agent' : `子代理 · ${id.slice(4)}`,
    isSub: id !== 'main',
    tools: buckets.get(id)!,
  }))
}

/**
 * Agent「思考过程」折叠面板：知识召回 + 工具调用。
 * 实时流与历史 trace 懒加载共用同一渲染；回答中的 [n] 点击可展开并定位到对应文档片段。
 */
/** 引用点击信号（ChatPage 在点回答中的 [n] 时下发） */
export interface CiteSignal {
  /** 文档序号（从 1 起，与回答里的 [n] 一致） */
  n: number
  /** 时间戳：重复点同一个编号也能重新触发高亮/展开 */
  ts: number
}

export function TracePanels({
  tools,
  recalls,
  delegations,
  citeSignal,
}: {
  tools?: ToolTrace[]
  recalls?: RagTrace[]
  /** 子代理委派节点：有值时工具面板升级为「主 Agent → 计划/子代理 → 工具」调用树 */
  delegations?: DelegationTrace[]
  citeSignal?: CiteSignal | null
}) {
  const toolList = tools || []
  const recallList = recalls || []
  const delegationList = delegations || []
  const [activeKeys, setActiveKeys] = useState<string[]>([])
  const [flashNo, setFlashNo] = useState<number | null>(null)

  // 点回答中的 [n]：展开面板 → 滚动并高亮第 n 个文档片段
  useEffect(() => {
    if (!citeSignal) return
    setActiveKeys((keys) => (keys.includes('rag') ? keys : [...keys, 'rag']))
    const timer = setTimeout(() => {
      document
        .getElementById(`trace-cite-${citeSignal.n}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setFlashNo(citeSignal.n)
      setTimeout(() => setFlashNo((cur) => (cur === citeSignal.n ? null : cur)), 1800)
    }, 120)
    return () => clearTimeout(timer)
  }, [citeSignal])

  if (toolList.length === 0 && recallList.length === 0 && delegationList.length === 0) return null

  const segmentCount = recallList.reduce((n, r) => n + (r.segments?.length || 0), 0)

  const items = []
  if (recallList.length > 0) {
    let docNo = 0
    items.push({
      key: 'rag',
      label: (
        <span className="trace-panel-label">
          <BookOutlined /> 知识召回
          <span className="trace-count">{segmentCount}</span>
        </span>
      ),
      children: (
        <div className="trace-segments">
          {segmentCount === 0 && <div className="trace-segment-empty">本次检索未命中知识库片段</div>}
          {recallList.map((rag, gi) =>
            (rag.segments || []).map((seg, si) => {
              const isDoc = seg.type !== 'conversation'
              if (isDoc) docNo += 1
              const flash = isDoc && flashNo === docNo
              return (
                <div
                  className={`trace-segment${flash ? ' trace-segment--flash' : ''}`}
                  key={`${gi}-${si}`}
                  id={isDoc ? `trace-cite-${docNo}` : undefined}
                >
                  <div className="trace-segment-head">
                    <span className="trace-segment-source">
                      {isDoc ? (
                        <span className="trace-segment-no">[{docNo}]</span>
                      ) : null}
                      {isDoc ? seg.source || '未知来源' : '历史对话'}
                    </span>
                    <span className="trace-segment-score">
                      {seg.channel && seg.channel !== 'vector' && (
                        <Tag
                          color={seg.channel === 'keyword' ? 'orange' : 'purple'}
                          style={{ marginInlineEnd: 6 }}
                        >
                          {seg.channel === 'keyword' ? '关键词命中' : '语义+关键词'}
                        </Tag>
                      )}
                      {seg.rerankScore != null && (
                        <span style={{ marginInlineEnd: 8 }}>精排 {seg.rerankScore.toFixed(2)}</span>
                      )}
                      相似度 {Math.round(seg.score * 100)}%
                    </span>
                  </div>
                  <div className="trace-segment-text">{seg.text}</div>
                </div>
              )
            }),
          )}
        </div>
      ),
    })
  }

  if (toolList.length > 0 || delegationList.length > 0) {
    const groups = groupToolsByAgent(toolList)
    // 仅当本轮真的出现了子代理（≥2 组）才展示分组头；否则保持平铺，避免单组场景多一层噪音
    const showGroups = groups.length > 1
    const renderTool = (t: ToolTrace, key: string) => (
      <div className={`trace-tool ${t.success ? '' : 'trace-tool--fail'}`} key={key}>
        <div className="trace-tool-head">
          {t.success ? (
            <CheckCircleFilled className="trace-tool-icon trace-tool-icon--ok" />
          ) : (
            <CloseCircleFilled className="trace-tool-icon trace-tool-icon--fail" />
          )}
          <span className="trace-tool-name">{t.name}</span>
          <span className="trace-tool-args">{truncate(compactArgs(t.arguments), 48)}</span>
          <span className="trace-tool-duration">{t.durationMs}ms</span>
        </div>
        {(t.result || t.error) && (
          <pre className="trace-tool-result">
            {t.success ? truncate(t.result || '', 300) : truncate(t.error || '', 300)}
          </pre>
        )}
      </div>
    )

    // 有委派节点时，按「主 Agent → 计划/子代理 → 工具」渲染调用树
    const treeView = delegationList.length > 0
    let tree: ReactNode = null
    if (treeView) {
      const byAgent = new Map<string, ToolTrace[]>()
      for (const t of toolList) {
        const agent = (t.agentId || '').trim()
        const list = byAgent.get(agent)
        if (list) list.push(t)
        else byAgent.set(agent, [t])
      }
      const remaining = new Map(byAgent)
      const toolsByDelegation = new Map<string, ToolTrace[]>()
      for (const d of delegationList) {
        const list = remaining.get(d.agent)
        if (list && list.length > 0) {
          toolsByDelegation.set(d.id, list)
          remaining.delete(d.agent)
        }
      }
      const ids = new Set(delegationList.map((d) => d.id))
      const roots = delegationList.filter((d) => !d.parentId || !ids.has(d.parentId))
      const childrenOf = (id: string) => delegationList.filter((d) => d.parentId === id)
      const renderNode = (d: DelegationTrace, depth: number): ReactNode => (
        <div className={`trace-agent-node${depth > 0 ? ' trace-agent-node--nested' : ''}`} key={d.id}>
          <div className="trace-agent-head">
            {d.success ? (
              <CheckCircleFilled className="trace-tool-icon trace-tool-icon--ok" />
            ) : (
              <CloseCircleFilled className="trace-tool-icon trace-tool-icon--fail" />
            )}
            <span className="trace-agent-name">
              {d.agent === 'planner' ? '计划编排' : `子代理 · ${d.agent}`}
            </span>
            <span className="trace-agent-task">{truncate(d.task || '', 56)}</span>
            <span className="trace-agent-meta">
              {d.tokens > 0 ? `${d.tokens} tok · ` : ''}
              {d.durationMs}ms
            </span>
          </div>
          {!d.success && d.error && <div className="trace-agent-error">{truncate(d.error, 200)}</div>}
          {(toolsByDelegation.get(d.id) || []).length > 0 && (
            <div className="trace-agent-tools">
              {(toolsByDelegation.get(d.id) || []).map((t, i) => renderTool(t, `${d.id}-${i}`))}
            </div>
          )}
          {depth < 4 && childrenOf(d.id).map((child) => renderNode(child, depth + 1))}
        </div>
      )
      const mainTools = byAgent.get('') || []
      // 未匹配到任何委派节点的子代理工具（历史数据/异常路径）仍按旧分组展示
      const orphans = Array.from(remaining.entries()).filter(([agent]) => agent !== '')
      tree = (
        <div className="trace-tools">
          {mainTools.length > 0 && (
            <div className="trace-tool-group">
              <div className="trace-tool-group-head">
                <span className="trace-tool-group-name">主 Agent 直接调用</span>
                <span className="trace-count">{mainTools.length}</span>
              </div>
              {mainTools.map((t, i) => renderTool(t, `main-${i}`))}
            </div>
          )}
          {roots.map((d) => renderNode(d, 0))}
          {orphans.map(([agent, list]) => (
            <div className="trace-tool-group trace-tool-group--sub" key={`orphan-${agent}`}>
              <div className="trace-tool-group-head">
                <span className="trace-tool-group-name">子代理 · {agent}</span>
                <span className="trace-count">{list.length}</span>
              </div>
              {list.map((t, i) => renderTool(t, `orphan-${agent}-${i}`))}
            </div>
          ))}
        </div>
      )
    }

    items.push({
      key: 'tool',
      label: (
        <span className="trace-panel-label">
          <ToolOutlined /> {treeView ? '协作链路' : '工具调用'}
          <span className="trace-count">{toolList.length}</span>
        </span>
      ),
      children: treeView ? (
        tree
      ) : (
        <div className="trace-tools">
          {showGroups
            ? groups.map((g) => (
                <div
                  className={`trace-tool-group${g.isSub ? ' trace-tool-group--sub' : ''}`}
                  key={g.key}
                >
                  <div className="trace-tool-group-head">
                    <span className="trace-tool-group-name">{g.label}</span>
                    <span className="trace-count">{g.tools.length}</span>
                  </div>
                  {g.tools.map((t, i) => renderTool(t, `${g.key}-${i}`))}
                </div>
              ))
            : toolList.map((t, i) => renderTool(t, `${t.name}-${i}`))}
        </div>
      ),
    })
  }

  return (
    <Collapse
      ghost
      size="small"
      className="chat-trace-collapse"
      items={items}
      activeKey={activeKeys}
      onChange={(keys) => setActiveKeys(Array.isArray(keys) ? (keys as string[]) : [String(keys)])}
    />
  )
}

/** 气泡底栏：token 用量/费用 + 可复制 traceId */
export function TraceFooter({ usage, traceId }: { usage?: UsageTrace | null; traceId?: string | null }) {
  const { message } = App.useApp()
  if (!usage && !traceId) return null

  const copyTraceId = () => {
    if (!traceId) return
    const done = () => message.success('traceId 已复制')
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(traceId).then(done).catch(() => message.warning('复制失败，请手动选择'))
    } else {
      message.warning('浏览器不支持自动复制')
    }
  }

  return (
    <div className="chat-trace-footer">
      {usage && (usage.inputTokens > 0 || usage.outputTokens > 0) && (
        <span className="chat-trace-usage">
          <ThunderboltOutlined /> 输入 {usage.inputTokens} · 输出 {usage.outputTokens}
          {usage.fallback && <span className="chat-trace-fallback">备用模型</span>}
          {usage.cancelled ? (
            <span className="chat-trace-cancelled">已停止</span>
          ) : (
            <span className="chat-trace-cost">¥{Number(usage.costYuan ?? 0).toFixed(4)}</span>
          )}
        </span>
      )}
      {traceId && (
        <Tooltip title="点击复制全链路 traceId">
          <span className="chat-trace-id" onClick={copyTraceId}>
            <CopyOutlined /> {traceId.length > 13 ? traceId.slice(0, 8) + '…' : traceId}
          </span>
        </Tooltip>
      )}
    </div>
  )
}
