import { useState } from 'react'
import { Collapse, Spin } from 'antd'
import { FileSearchOutlined, ReloadOutlined } from '@ant-design/icons'
import { getTrace, type TraceDetail } from '../api'
import { TraceFooter, TracePanels } from './TracePanels'

/** 模块级缓存：同一会话内反复展开不重复请求 */
const traceCache = new Map<string, TraceDetail>()

/**
 * 历史助手消息的 trace 懒加载入口：
 * 展开「查看思考过程」时按 traceId 拉取工具/召回/用量并复用 TracePanels 渲染。
 */
export default function HistoricalTrace({ traceId }: { traceId: string }) {
  const [detail, setDetail] = useState<TraceDetail | null>(traceCache.get(traceId) || null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = async () => {
    if (detail || loading) return
    setLoading(true)
    setFailed(false)
    try {
      const data = await getTrace(traceId)
      traceCache.set(traceId, data)
      setDetail(data)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  const items = [
    {
      key: 'history-trace',
      label: (
        <span>
          <FileSearchOutlined /> 查看思考过程
        </span>
      ),
      children: loading ? (
        <span className="history-trace-loading">
          <Spin size="small" /> 加载中...
        </span>
      ) : failed ? (
        <span className="history-trace-error" onClick={load}>
          <ReloadOutlined /> 加载失败，点击重试
        </span>
      ) : detail ? (
        <>
          <TracePanels
            tools={detail.tools}
            recalls={detail.recalls}
            delegations={detail.delegations}
          />
          {detail.tools.length === 0 && detail.recalls.length === 0
            && (detail.delegations?.length || 0) === 0 && (
            <div className="history-trace-empty">该轮未触发工具调用、知识召回或子代理协作</div>
          )}
          <TraceFooter usage={detail.usage} traceId={detail.traceId} />
        </>
      ) : null,
    },
  ]

  return (
    <div className="history-trace-load">
      <Collapse ghost size="small" items={items} onChange={(keys) => {
        if ((keys as string[]).includes('history-trace')) void load()
      }} />
    </div>
  )
}
