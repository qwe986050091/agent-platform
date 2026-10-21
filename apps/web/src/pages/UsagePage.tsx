import { useCallback, useEffect, useState } from 'react'
import { App as AntdApp, Card, DatePicker, Empty, Spin, Statistic, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import {
  getUsageSummary,
  type ConversationUsageRow,
  type ModelUsageRow,
  type UsageSummary,
} from '../api'

const { RangePicker } = DatePicker

const numberFmt = (v: number) => v.toLocaleString('zh-CN')
const moneyFmt = (v: number) => `¥${Number(v || 0).toFixed(4)}`

/**
 * 用量统计页（P2-10）：时间范围 + 总量卡片 + 按模型/按会话分组表格。
 * 只展示当前登录用户自己的数据（后端强制按 userId 过滤）。
 */
export default function UsagePage() {
  const { message } = AntdApp.useApp()
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(29, 'day'), dayjs()])
  const [data, setData] = useState<UsageSummary | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (from: Dayjs, to: Dayjs) => {
    setLoading(true)
    try {
      const summary = await getUsageSummary(from.format('YYYY-MM-DD'), to.format('YYYY-MM-DD'))
      setData(summary)
    } catch (e: any) {
      message.error(e?.message || '用量加载失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load(range[0], range[1])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const modelColumns: ColumnsType<ModelUsageRow> = [
    { title: '模型', dataIndex: 'model', key: 'model' },
    { title: '对话轮次', dataIndex: 'turns', key: 'turns', align: 'right', render: numberFmt },
    { title: '输入 tokens', dataIndex: 'inputTokens', key: 'input', align: 'right', render: numberFmt },
    { title: '输出 tokens', dataIndex: 'outputTokens', key: 'output', align: 'right', render: numberFmt },
    { title: '总 tokens', dataIndex: 'totalTokens', key: 'total', align: 'right', render: numberFmt },
    { title: '费用', dataIndex: 'costYuan', key: 'cost', align: 'right', render: moneyFmt },
  ]

  const convColumns: ColumnsType<ConversationUsageRow> = [
    {
      title: '会话',
      dataIndex: 'title',
      key: 'title',
      render: (title: string | null, row) => title || (row.conversationId === 0 ? '默认会话' : `会话 ${row.conversationId}`),
    },
    { title: '对话轮次', dataIndex: 'turns', key: 'turns', align: 'right', render: numberFmt },
    { title: '总 tokens', dataIndex: 'totalTokens', key: 'total', align: 'right', render: numberFmt },
    { title: '费用', dataIndex: 'costYuan', key: 'cost', align: 'right', render: moneyFmt },
  ]

  const totals = data?.totals

  return (
    <div className="usage-page">
      <div className="usage-header">
        <h2 className="usage-title">用量统计</h2>
        <RangePicker
          value={range}
          allowClear={false}
          onChange={(v) => {
            if (v && v[0] && v[1]) {
              const next: [Dayjs, Dayjs] = [v[0], v[1]]
              setRange(next)
              void load(next[0], next[1])
            }
          }}
        />
      </div>

      <Spin spinning={loading}>
        <div className="usage-cards">
          <Card className="usage-card">
            <Statistic title="对话轮次" value={totals?.turns ?? 0} />
          </Card>
          <Card className="usage-card">
            <Statistic title="输入 tokens" value={totals?.inputTokens ?? 0} formatter={(v) => numberFmt(Number(v))} />
          </Card>
          <Card className="usage-card">
            <Statistic title="输出 tokens" value={totals?.outputTokens ?? 0} formatter={(v) => numberFmt(Number(v))} />
          </Card>
          <Card className="usage-card">
            <Statistic
              title="总费用（元）"
              value={totals?.costYuan ?? 0}
              precision={4}
              formatter={(v) => moneyFmt(Number(v))}
            />
          </Card>
        </div>

        {data && data.byModel.length === 0 && data.byConversation.length === 0 ? (
          <Empty description="所选范围内暂无用量记录" style={{ marginTop: 64 }} />
        ) : (
          <div className="usage-tables">
            <Card title="按模型" className="usage-table-card">
              <Table
                rowKey={(row) => row.model || 'unknown'}
                size="small"
                columns={modelColumns}
                dataSource={data?.byModel || []}
                pagination={false}
              />
            </Card>
            <Card title="按会话（Top 50）" className="usage-table-card">
              <Table
                rowKey="conversationId"
                size="small"
                columns={convColumns}
                dataSource={data?.byConversation || []}
                pagination={false}
              />
            </Card>
          </div>
        )}
      </Spin>
    </div>
  )
}
