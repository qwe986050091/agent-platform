import { useCallback, useEffect, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Card,
  DatePicker,
  Empty,
  Input,
  Result,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { LikeOutlined, DislikeOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import {
  getAdminFeedback,
  getFeedbackReasons,
  getFeedbackStats,
  type AdminFeedbackRow,
  type FeedbackReason,
  type FeedbackStats,
} from '../api'

const { RangePicker } = DatePicker

interface Filters {
  rating?: number
  reason?: string
  keyword?: string
  from?: string
  to?: string
}

/**
 * 反馈管理 / Bad case 后台（P2-11.1，管理员白名单可见）：
 * 筛选（评分/原因/关键词/时间）+ 统计卡片 + 分页反馈表，展开行查看完整问题、答案与 traceId。
 */
export default function FeedbackAdminPage() {
  const { message } = AntdApp.useApp()
  const [reasons, setReasons] = useState<FeedbackReason[]>([])
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>([
    dayjs().subtract(29, 'day'),
    dayjs(),
  ])
  // 输入态（点查询才生效）
  const [ratingInput, setRatingInput] = useState<number | undefined>(undefined)
  const [reasonInput, setReasonInput] = useState<string | undefined>(undefined)
  const [keywordInput, setKeywordInput] = useState('')
  // 已生效筛选（初始范围与 RangePicker 默认的近 30 天保持一致）
  const [filters, setFilters] = useState<Filters>(() => ({
    from: dayjs().subtract(29, 'day').format('YYYY-MM-DD'),
    to: dayjs().format('YYYY-MM-DD'),
  }))
  const [page, setPage] = useState(0)

  const [rows, setRows] = useState<AdminFeedbackRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState<FeedbackStats | null>(null)
  const [forbidden, setForbidden] = useState(false)

  const rangeParams = useCallback((): { from?: string; to?: string } => {
    if (!range || !range[0] || !range[1]) return {}
    return { from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD') }
  }, [range])

  const loadList = useCallback(
    async (f: Filters, p: number) => {
      setLoading(true)
      try {
        const data = await getAdminFeedback({ ...f, page: p, size: 20 })
        setRows(data.content)
        setTotal(data.total)
        setForbidden(false)
      } catch (e: any) {
        if (e?.status === 403) {
          setForbidden(true)
        } else {
          message.error(e?.message || '反馈列表加载失败')
        }
      } finally {
        setLoading(false)
      }
    },
    [message],
  )

  const loadStats = useCallback(
    async (f: Filters) => {
      try {
        setStats(await getFeedbackStats(f.from, f.to))
      } catch (e: any) {
        if (e?.status !== 403) message.error(e?.message || '统计加载失败')
      }
    },
    [message],
  )

  useEffect(() => {
    getFeedbackReasons().then(setReasons).catch(() => undefined)
  }, [])

  useEffect(() => {
    void loadList(filters, page)
    void loadStats(filters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page])

  function applySearch() {
    setPage(0)
    setFilters({
      rating: ratingInput,
      reason: reasonInput || undefined,
      keyword: keywordInput.trim() || undefined,
      ...rangeParams(),
    })
  }

  function resetSearch() {
    setRatingInput(undefined)
    setReasonInput(undefined)
    setKeywordInput('')
    setRange(null)
    setPage(0)
    setFilters({})
  }

  // 时间范围变更即时生效（同时影响列表与统计）
  function changeRange(v: [Dayjs, Dayjs] | null) {
    setRange(v)
    setPage(0)
    setFilters((prev) => ({
      ...prev,
      ...(v && v[0] && v[1]
        ? { from: v[0].format('YYYY-MM-DD'), to: v[1].format('YYYY-MM-DD') }
        : { from: undefined, to: undefined }),
    }))
  }

  const columns: ColumnsType<AdminFeedbackRow> = [
    {
      title: '评价',
      dataIndex: 'rating',
      key: 'rating',
      width: 72,
      render: (r: number) =>
        r === 1 ? (
          <Tag icon={<LikeOutlined />} color="green">
            赞
          </Tag>
        ) : (
          <Tag icon={<DislikeOutlined />} color="red">
            踩
          </Tag>
        ),
    },
    { title: '用户', dataIndex: 'userId', key: 'userId', width: 130, ellipsis: true },
    {
      title: '会话',
      dataIndex: 'conversationTitle',
      key: 'conversation',
      width: 160,
      ellipsis: true,
      render: (t: string) => (
        <Tooltip title={t}>
          <span>{t}</span>
        </Tooltip>
      ),
    },
    {
      title: '点踩原因',
      key: 'reason',
      width: 220,
      render: (_, row) =>
        row.rating === -1 ? (
          <Space direction="vertical" size={2}>
            {row.reasonLabel && <Tag color="orange">{row.reasonLabel}</Tag>}
            {row.comment && (
              <Typography.Text type="secondary" ellipsis={{ tooltip: row.comment }} style={{ maxWidth: 200 }}>
                {row.comment}
              </Typography.Text>
            )}
          </Space>
        ) : (
          <span style={{ color: '#bbb' }}>—</span>
        ),
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (t: string) => (t ? dayjs(t).format('YYYY-MM-DD HH:mm') : ''),
    },
  ]

  if (forbidden) {
    return (
      <div className="feedback-page">
        <Result
          status="403"
          title="无访问权限"
          subTitle="反馈管理仅对管理员开放，如有需要请联系管理员将你的用户名加入白名单。"
        />
      </div>
    )
  }

  return (
    <div className="feedback-page">
      <div className="feedback-header">
        <h2 className="feedback-title">反馈管理</h2>
        <RangePicker
          value={range as any}
          allowClear
          onChange={(v) => changeRange(v as unknown as [Dayjs, Dayjs] | null)}
        />
      </div>

      <div className="feedback-cards">
        <Card className="feedback-card">
          <Statistic title="反馈总数" value={stats?.total ?? 0} />
        </Card>
        <Card className="feedback-card">
          <Statistic
            title={<span><LikeOutlined /> 点赞</span>}
            value={stats?.up ?? 0}
            valueStyle={{ color: '#389e0d' }}
          />
        </Card>
        <Card className="feedback-card">
          <Statistic
            title={<span><DislikeOutlined /> 点踩</span>}
            value={stats?.down ?? 0}
            valueStyle={{ color: '#cf1322' }}
          />
        </Card>
        <Card className="feedback-card feedback-reasons-card" title="点踩原因分布">
          {stats && stats.byReason.length > 0 ? (
            <Space size={[6, 6]} wrap>
              {stats.byReason.map((r) => (
                <Tag key={r.reasonCode || 'none'} color="orange">
                  {r.reasonLabel || '未填原因'}：{r.count}
                </Tag>
              ))}
            </Space>
          ) : (
            <span style={{ color: '#bbb' }}>暂无点踩</span>
          )}
        </Card>
      </div>

      <Card className="feedback-filter-card">
        <Space wrap>
          <Select
            style={{ width: 110 }}
            placeholder="评价"
            allowClear
            value={ratingInput}
            onChange={(v) => setRatingInput(v)}
            options={[
              { value: 1, label: '点赞' },
              { value: -1, label: '点踩' },
            ]}
          />
          <Select
            style={{ width: 160 }}
            placeholder="点踩原因"
            allowClear
            value={reasonInput}
            onChange={(v) => setReasonInput(v)}
            options={reasons.map((r) => ({ value: r.code, label: r.label }))}
          />
          <Input
            style={{ width: 240 }}
            placeholder="搜索备注 / 问答内容"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onPressEnter={applySearch}
            allowClear
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={applySearch}>
            查询
          </Button>
          <Button icon={<ReloadOutlined />} onClick={resetSearch}>
            重置
          </Button>
        </Space>
      </Card>

      <Spin spinning={loading}>
        {!loading && rows.length === 0 ? (
          <Empty description="没有符合条件的反馈" style={{ marginTop: 64 }} />
        ) : (
          <Table
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={rows}
            className="feedback-table"
            pagination={{
              current: page + 1,
              pageSize: 20,
              total,
              showSizeChanger: false,
              showTotal: (t) => `共 ${t} 条`,
              onChange: (p) => setPage(p - 1),
            }}
            expandable={{
              expandedRowRender: (row) => (
                <div className="feedback-detail">
                  <div className="feedback-detail-block">
                    <div className="feedback-detail-label">用户提问</div>
                    <pre className="feedback-detail-text">{row.question || '（未取到提问，可能来自历史回合）'}</pre>
                  </div>
                  <div className="feedback-detail-block">
                    <div className="feedback-detail-label">助手回答</div>
                    <pre className="feedback-detail-text">{row.answer || '（无回答内容）'}</pre>
                  </div>
                  <div className="feedback-detail-meta">
                    <span>traceId：</span>
                    <Typography.Text copyable code style={{ fontSize: 12 }}>
                      {row.traceId}
                    </Typography.Text>
                  </div>
                </div>
              ),
            }}
          />
        )}
      </Spin>
    </div>
  )
}
