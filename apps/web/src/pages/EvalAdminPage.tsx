import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Card,
  Empty,
  Modal,
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
import {
  ReloadOutlined,
  SyncOutlined,
  ExperimentOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import {
  dismissEvalCandidate,
  getEvalCandidates,
  getEvalDiff,
  getEvalRun,
  getEvalRuns,
  getEvalStats,
  promoteEvalCandidate,
  refreshEvalCandidates,
  type EvalCandidateRow,
  type EvalCaseRow,
  type EvalDiffView,
  type EvalRunRow,
  type EvalStats,
} from '../api'

const { Text, Paragraph } = Typography

/** 断言明细（与 agent 侧 EvalCheck 字段对齐） */
interface EvalCheckView {
  name: string
  passed: boolean
  expected?: string | null
  actual?: string | null
  detail?: string | null
}

function pct(v?: number | null): string {
  return v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`
}

function parseChecks(json?: string | null): EvalCheckView[] {
  if (!json) return []
  try {
    const arr = JSON.parse(json)
    return Array.isArray(arr) ? (arr as EvalCheckView[]) : []
  } catch {
    return []
  }
}

const CATEGORY_LABEL: Record<string, string> = {
  rag_qa: '知识问答',
  tool_call: '工具调用',
  safety: '安全拒答',
  plain: '普通对话',
}

/**
 * Agent 评测看板（P0-B，管理员白名单可见）：
 * 指标卡片 + 运行列表（展开看逐例断言）+ 与基线运行对比（修复/回归/指标 delta）
 * + 反馈反哺的候选用例（采纳生成可直接粘进数据集的 JSON 草稿）。
 */
export default function EvalAdminPage() {
  const { message } = AntdApp.useApp()
  const [forbidden, setForbidden] = useState(false)
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState<EvalStats | null>(null)
  const [runs, setRuns] = useState<EvalRunRow[]>([])
  const [detailCache, setDetailCache] = useState<Record<string, EvalCaseRow[]>>({})
  const [baseRunId, setBaseRunId] = useState<string | undefined>(undefined)
  const [diff, setDiff] = useState<EvalDiffView | null>(null)
  const [candidates, setCandidates] = useState<EvalCandidateRow[]>([])
  const [draft, setDraft] = useState<{ title: string; json: string } | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [s, page, cands] = await Promise.all([
        getEvalStats(),
        getEvalRuns(0, 20),
        getEvalCandidates('new'),
      ])
      setStats(s)
      setRuns(page.content)
      setCandidates(cands)
      setForbidden(false)
    } catch (e: any) {
      if (e?.status === 403) {
        setForbidden(true)
      } else {
        message.error(e?.message || '评测数据加载失败')
      }
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  /** 展开某次运行时按需拉取逐例结果 */
  const loadDetail = useCallback(
    async (runId: string) => {
      if (detailCache[runId]) return
      try {
        const detail = await getEvalRun(runId)
        setDetailCache((prev) => ({ ...prev, [runId]: detail.cases }))
      } catch (e: any) {
        message.error(e?.message || '运行详情加载失败')
      }
    },
    [detailCache, message],
  )

  const runOptions = useMemo(
    () => runs.map((r) => ({ value: r.runId, label: `${r.label || '未命名'} · ${r.runId}` })),
    [runs],
  )

  async function showDiff(runId: string) {
    if (!baseRunId) {
      message.warning('请先在上方选择基线运行')
      return
    }
    try {
      setDiff(await getEvalDiff(runId, baseRunId))
    } catch (e: any) {
      message.error(e?.message || '对比失败')
    }
  }

  async function handleRefreshCandidates() {
    try {
      const r = await refreshEvalCandidates()
      message.success(`扫描完成，新增 ${r.created} 条候选用例`)
      setCandidates(await getEvalCandidates('new'))
      setStats(await getEvalStats())
    } catch (e: any) {
      message.error(e?.message || '扫描失败')
    }
  }

  async function handlePromote(id: number) {
    try {
      const r = await promoteEvalCandidate(id)
      setDraft({ title: '已采纳：用例 JSON 草稿（可粘进 agent 仓评测数据集）', json: r.caseDraft })
      setCandidates(await getEvalCandidates('new'))
    } catch (e: any) {
      message.error(e?.message || '采纳失败')
    }
  }

  async function handleDismiss(id: number) {
    try {
      await dismissEvalCandidate(id)
      setCandidates(await getEvalCandidates('new'))
    } catch (e: any) {
      message.error(e?.message || '操作失败')
    }
  }

  const caseColumns: ColumnsType<EvalCaseRow> = [
    { title: '用例', dataIndex: 'caseId', key: 'caseId', width: 200, ellipsis: true },
    {
      title: '类别',
      dataIndex: 'category',
      key: 'category',
      width: 100,
      render: (c: string) => <Tag color="blue">{CATEGORY_LABEL[c] || c}</Tag>,
    },
    {
      title: '结果',
      dataIndex: 'passed',
      key: 'passed',
      width: 80,
      render: (p: boolean) =>
        p ? <Tag color="green">通过</Tag> : <Tag color="red">失败</Tag>,
    },
    {
      title: '失败断言',
      dataIndex: 'failedChecks',
      key: 'failedChecks',
      render: (checks: string[]) =>
        checks.length === 0 ? <span style={{ color: '#bbb' }}>—</span> : (
          <Space size={[4, 4]} wrap>
            {checks.map((c) => (
              <Tag key={c} color="red">{c}</Tag>
            ))}
          </Space>
        ),
    },
    { title: 'token', dataIndex: 'tokens', key: 'tokens', width: 80 },
    { title: '耗时(ms)', dataIndex: 'durationMs', key: 'durationMs', width: 90 },
  ]

  const runColumns: ColumnsType<EvalRunRow> = [
    {
      title: '运行',
      key: 'run',
      width: 220,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Text strong>{r.label || '未命名'}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{r.runId}</Text>
        </Space>
      ),
    },
    { title: '数据集', dataIndex: 'datasetName', key: 'datasetName', width: 150, ellipsis: true },
    {
      title: '模型',
      key: 'model',
      width: 180,
      ellipsis: true,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <span>{r.model || '—'}</span>
          <Text type="secondary" style={{ fontSize: 12 }}>{r.mode}</Text>
        </Space>
      ),
    },
    {
      title: '通过',
      key: 'pass',
      width: 110,
      render: (_, r) => (
        <span>
          {r.passed}/{r.total}
        </span>
      ),
    },
    {
      title: '通过率',
      dataIndex: 'passRate',
      key: 'passRate',
      width: 100,
      render: (v: number) => <Text strong>{pct(v)}</Text>,
    },
    { title: '工具', key: 'tool', width: 80, render: (_, r) => pct(r.toolAccuracy) },
    { title: '引用', key: 'cite', width: 80, render: (_, r) => pct(r.citationAccuracy) },
    { title: '要点', key: 'point', width: 80, render: (_, r) => pct(r.pointCoverage) },
    { title: '拒答', key: 'refusal', width: 80, render: (_, r) => pct(r.refusalRate) },
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (t: string) => (t ? dayjs(t).format('YYYY-MM-DD HH:mm') : ''),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_, r) => (
        <Button size="small" onClick={() => void showDiff(r.runId)}>
          与基线对比
        </Button>
      ),
    },
  ]

  const candidateColumns: ColumnsType<EvalCandidateRow> = [
    { title: '原提问', dataIndex: 'question', key: 'question', ellipsis: true },
    {
      title: '建议分类',
      dataIndex: 'suggestedCategory',
      key: 'suggestedCategory',
      width: 100,
      render: (c: string) => <Tag color="blue">{CATEGORY_LABEL[c] || c}</Tag>,
    },
    {
      title: '建议要点',
      dataIndex: 'suggestedPoints',
      key: 'suggestedPoints',
      width: 220,
      render: (pts: string[]) =>
        pts.length === 0 ? <span style={{ color: '#bbb' }}>—</span> : (
          <Space size={[4, 4]} wrap>
            {pts.map((p) => (
              <Tag key={p}>{p}</Tag>
            ))}
          </Space>
        ),
    },
    {
      title: '点踩原因',
      key: 'reason',
      width: 200,
      render: (_, r) => (
        <Space direction="vertical" size={2}>
          {r.reasonCode && <Tag color="orange">{r.reasonCode}</Tag>}
          {r.comment && (
            <Text type="secondary" ellipsis={{ tooltip: r.comment }} style={{ maxWidth: 180 }}>
              {r.comment}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      render: (_, r) => (
        <Space size={4}>
          <Button size="small" type="primary" onClick={() => void handlePromote(r.id)}>
            采纳
          </Button>
          <Button size="small" onClick={() => void handleDismiss(r.id)}>
            忽略
          </Button>
        </Space>
      ),
    },
  ]

  if (forbidden) {
    return (
      <div className="feedback-page">
        <Result
          status="403"
          title="无访问权限"
          subTitle="评测看板仅对管理员开放，如有需要请联系管理员将你的用户名加入白名单。"
        />
      </div>
    )
  }

  const latest = stats?.latest

  return (
    <div className="eval-page">
      <div className="feedback-header">
        <h2 className="feedback-title">
          <ExperimentOutlined /> Agent 评测
        </h2>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void loadAll()} loading={loading}>
            刷新
          </Button>
        </Space>
      </div>

      <div className="eval-cards">
        <Card className="feedback-card">
          <Statistic title="最新通过率" value={pct(latest?.passRate)} suffix={latest ? `${latest.passed}/${latest.total}` : ''} />
        </Card>
        <Card className="feedback-card">
          <Statistic title="工具选择正确率" value={pct(latest?.toolAccuracy)} />
        </Card>
        <Card className="feedback-card">
          <Statistic title="引用正确率" value={pct(latest?.citationAccuracy)} />
        </Card>
        <Card className="feedback-card">
          <Statistic title="要点覆盖率" value={pct(latest?.pointCoverage)} />
        </Card>
        <Card className="feedback-card">
          <Statistic title="安全拒答率" value={pct(latest?.refusalRate)} />
        </Card>
      </div>

      <Card
        className="feedback-filter-card"
        title="运行列表（展开查看逐例断言）"
        extra={
          <Space>
            <span style={{ color: '#7a869a', fontSize: 12 }}>基线运行</span>
            <Select
              style={{ width: 260 }}
              placeholder="选择基线运行用于对比"
              allowClear
              value={baseRunId}
              onChange={(v) => setBaseRunId(v)}
              options={runOptions}
            />
          </Space>
        }
      >
        <Spin spinning={loading}>
          {runs.length === 0 ? (
            <Empty description="还没有评测运行。在 agent 仓执行：mvnw spring-boot:run -Dspring-boot.run.profiles=eval" />
          ) : (
            <Table
              rowKey="runId"
              size="small"
              columns={runColumns}
              dataSource={runs}
              pagination={false}
              scroll={{ x: 1300 }}
              expandable={{
                onExpand: (expanded, record) => {
                  if (expanded) void loadDetail(record.runId)
                },
                expandedRowRender: (record) => (
                  <Table
                    rowKey="caseId"
                    size="small"
                    columns={caseColumns}
                    dataSource={detailCache[record.runId] || []}
                    pagination={{ pageSize: 12, size: 'small' }}
                    expandable={{
                      expandedRowRender: (c) => (
                        <div className="feedback-detail">
                          <div className="feedback-detail-block">
                            <div className="feedback-detail-label">助手回答</div>
                            <pre className="feedback-detail-text">{c.answer || '（无回答）'}</pre>
                          </div>
                          <div className="feedback-detail-block">
                            <div className="feedback-detail-label">断言明细</div>
                            <Space direction="vertical" size={2}>
                              {parseChecks(c.checksJson).map((ch, i) => (
                                <Text key={i} style={{ fontSize: 12 }}>
                                  {ch.passed ? <CheckCircleOutlined style={{ color: '#389e0d' }} /> : <CloseCircleOutlined style={{ color: '#cf1322' }} />}{' '}
                                  {ch.name}：期望「{ch.expected}」，实际「{ch.actual}」
                                  {ch.detail ? ` — ${ch.detail}` : ''}
                                </Text>
                              ))}
                            </Space>
                          </div>
                        </div>
                      ),
                    }}
                  />
                ),
              }}
            />
          )}
        </Spin>
      </Card>

      <Card
        className="feedback-filter-card"
        title={`反馈反哺候选（${candidates.length}）`}
        extra={
          <Button icon={<SyncOutlined />} onClick={() => void handleRefreshCandidates()}>
            扫描点踩反馈
          </Button>
        }
      >
        {candidates.length === 0 ? (
          <Empty description="暂无候选用例。点击右上角扫描点踩反馈生成。" />
        ) : (
          <Table
            rowKey="id"
            size="small"
            columns={candidateColumns}
            dataSource={candidates}
            pagination={false}
          />
        )}
      </Card>

      <Modal
        title={`与基线对比（${diff?.baseRunId || ''} → ${diff?.currentRunId || ''}）`}
        open={!!diff}
        onCancel={() => setDiff(null)}
        footer={<Button onClick={() => setDiff(null)}>关闭</Button>}
        width={560}
      >
        {diff && (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <div>
              <Text type="secondary">指标变化（本次 − 基线）</Text>
              <div style={{ marginTop: 6 }}>
                <Space size={[6, 6]} wrap>
                  {Object.entries(diff.metricDeltas).map(([k, v]) => (
                    <Tag key={k} color={v == null ? 'default' : v > 0 ? 'green' : v < 0 ? 'red' : 'default'}>
                      {k}: {v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`}
                    </Tag>
                  ))}
                </Space>
              </div>
            </div>
            <div>
              <Text type="secondary">修复用例（失败 → 通过）</Text>
              <div>
                {diff.fixedCases.length === 0 ? <Text type="secondary">无</Text> : diff.fixedCases.map((c) => (
                  <Tag key={c} color="green">{c}</Tag>
                ))}
              </div>
            </div>
            <div>
              <Text type="secondary">回归用例（通过 → 失败）</Text>
              <div>
                {diff.brokenCases.length === 0 ? <Text type="secondary">无</Text> : diff.brokenCases.map((c) => (
                  <Tooltip key={c} title="回归需重点关注">
                    <Tag color="red">{c}</Tag>
                  </Tooltip>
                ))}
              </div>
            </div>
          </Space>
        )}
      </Modal>

      <Modal
        title={draft?.title}
        open={!!draft}
        onCancel={() => setDraft(null)}
        footer={<Button onClick={() => setDraft(null)}>关闭</Button>}
        width={620}
      >
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          把下面的用例对象追加到 agent 仓 <Text code>src/main/resources/eval/dataset/agent-eval-v1.json</Text> 的数组里，
          并按需补全断言（requiredPoints / expectedDocs / expectedTools）。
        </Paragraph>
        <pre className="feedback-detail-text" style={{ maxHeight: 360 }}>{draft?.json}</pre>
      </Modal>
    </div>
  )
}
