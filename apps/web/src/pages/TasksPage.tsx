import { useEffect, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
} from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'
import {
  api,
  createTask,
  deleteTask,
  listTaskRuns,
  listTasks,
  runTaskNow,
  updateTask,
  type ScheduledTask,
  type ScheduledTaskRun,
  type TaskPayload,
} from '../api'
import { fireTestNotification } from '../hooks/useNotifications'
import assistantAvatar from '../assets/assistant-avatar.jpg'

/** cron 预设快捷（点击回填；v1 不做可视化构建器） */
const CRON_PRESETS: Array<{ label: string; value: string }> = [
  { label: '每天 08:00', value: '0 0 8 * * *' },
  { label: '每周一 09:00', value: '0 0 9 * * 1' },
  { label: '每小时整点', value: '0 0 * * * *' },
]

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

interface TaskFormValues {
  name: string
  prompt: string
  cronExpr: string
  toolsWhitelist?: string[]
  enabled: boolean
}

/** 执行状态徽标（与后端 scheduled_task_run.status 对齐） */
function statusView(status: string | null | undefined) {
  switch (status) {
    case 'success':
      return <Tag color="green">成功</Tag>
    case 'failed':
      return <Tag color="red">失败</Tag>
    case 'running':
      return <Tag color="blue">执行中</Tag>
    case 'skipped_budget':
      return <Tag color="orange">预算跳过</Tag>
    default:
      return <Tag color="default">—</Tag>
  }
}

/** 常见 cron 的「人话描述」（识别不了就原样回显表达式） */
function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 6) return expr
  const [sec, min, hour, day, month, week] = parts
  const hhmm = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
  if (sec !== '0' || day !== '*' || month !== '*') return expr
  if (week === '*') {
    if (hour === '*') return `每小时第 ${min} 分`
    if (min === '*' && hour.startsWith('*/')) return `每 ${hour.slice(2)} 小时`
    if (/^\d+$/.test(hour) && /^\d+$/.test(min)) return `每天 ${hhmm}`
    return expr
  }
  if (/^\d+$/.test(hour) && /^\d+$/.test(min) && /^\d+$/.test(week)) {
    const w = Number(week)
    const label = WEEKDAY_CN[w === 7 ? 0 : w]
    return label ? `每${label} ${hhmm}` : expr
  }
  return expr
}

function formatTime(value?: string | null): string {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—'
}

/**
 * 定时任务管理页（P2-9 M1c）：
 * 任务列表（启停/立即执行/编辑/删除/执行记录）+ 新建/编辑 Modal + 执行记录抽屉。
 * 结果落在任务专属会话（点「查看结果」跳转 /chat）。
 */
export default function TasksPage() {
  const { message } = AntdApp.useApp()
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [tools, setTools] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  /** null=新建；否则为被编辑任务 id */
  const [editingId, setEditingId] = useState<number | null>(null)
  /** 执行记录抽屉的目标任务 */
  const [runsTarget, setRunsTarget] = useState<ScheduledTask | null>(null)
  const [runs, setRuns] = useState<ScheduledTaskRun[]>([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [form] = Form.useForm<TaskFormValues>()
  /** 浏览器通知权限（系统通知需用户手势申请；站内 toast 不依赖它） */
  const [notifPermission, setNotifPermission] = useState<'unsupported' | NotificationPermission>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  )

  useEffect(() => {
    void loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [taskData, toolData] = await Promise.all([
        listTasks(),
        api<{ tools: string[] }>('/api/skills/tools').catch(() => ({ tools: [] })),
      ])
      setTasks(taskData)
      setTools(toolData.tools || [])
    } catch (err: any) {
      message.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ========== 新建 / 编辑 ==========
  function openCreate() {
    setEditingId(null)
    form.setFieldsValue({
      name: '',
      prompt: '',
      cronExpr: '0 0 8 * * *',
      toolsWhitelist: [],
      enabled: true,
    })
    setModalOpen(true)
  }

  function openEdit(task: ScheduledTask) {
    setEditingId(task.id)
    form.setFieldsValue({
      name: task.name,
      prompt: task.prompt,
      cronExpr: task.cronExpr,
      toolsWhitelist: task.toolsWhitelist || [],
      enabled: task.enabled,
    })
    setModalOpen(true)
  }

  async function handleSubmit(values: TaskFormValues) {
    const payload: TaskPayload = {
      name: values.name.trim(),
      prompt: values.prompt.trim(),
      cronExpr: values.cronExpr.trim(),
      toolsWhitelist: values.toolsWhitelist || [],
      enabled: values.enabled,
    }
    setSubmitting(true)
    try {
      if (editingId == null) {
        await createTask(payload)
        message.success(`任务「${payload.name}」已创建`)
      } else {
        await updateTask(editingId, payload)
        message.success(`任务「${payload.name}」已更新`)
      }
      setModalOpen(false)
      await loadAll()
    } catch (err: any) {
      message.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // ========== 启停 / 立即执行 / 删除 ==========
  async function toggleEnabled(task: ScheduledTask, enabled: boolean) {
    try {
      await updateTask(task.id, { enabled })
      message.success(enabled ? `已启用「${task.name}」` : `已停用「${task.name}」`)
      await loadAll()
    } catch (err: any) {
      message.error(err.message)
    }
  }

  async function handleRunNow(task: ScheduledTask) {
    try {
      const resp = await runTaskNow(task.id)
      message.success(resp.message || '已开始执行')
      // 执行是异步的：稍后刷新列表可见最新状态
      setTimeout(() => void loadAll(), 3000)
    } catch (err: any) {
      message.error(err.message)
    }
  }

  async function handleDelete(task: ScheduledTask) {
    try {
      await deleteTask(task.id)
      message.success(`已删除「${task.name}」（专属会话与历史消息已保留）`)
      await loadAll()
    } catch (err: any) {
      message.error(err.message)
    }
  }

  // ========== 执行记录 ==========
  async function openRuns(task: ScheduledTask) {
    setRunsTarget(task)
    setRunsLoading(true)
    try {
      setRuns(await listTaskRuns(task.id))
    } catch (err: any) {
      message.error(err.message)
    } finally {
      setRunsLoading(false)
    }
  }

  // ========== 浏览器系统通知（M2） ==========
  async function toggleBrowserNotify(checked: boolean) {
    if (typeof Notification === 'undefined') {
      message.warning('当前浏览器不支持系统通知，任务结果仍会以站内提示呈现')
      return
    }
    if (!checked) {
      message.info('关闭系统通知请使用浏览器地址栏的权限设置')
      return
    }
    // 必须由用户手势触发申请（不能登录后自动弹）
    const permission = await Notification.requestPermission()
    setNotifPermission(permission)
    if (permission === 'granted') {
      // 授权成功立即发一条测试通知：系统通知是否真能看到只能在浏览器端验证
      const test = fireTestNotification()
      message.success(test.ok
        ? '已开启浏览器通知，并已发送一条测试通知（若没看到，请检查 Windows 通知设置/专注助手是否屏蔽了 Chrome）'
        : `已获得权限，但测试通知发送失败：${test.reason}`)
    } else {
      message.warning('未获得通知权限；任务结果仍会以站内提示和任务专属会话呈现')
    }
  }

  /** 手动发一条测试系统通知（自检权限/系统屏蔽） */
  function handleTestNotification() {
    if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      void toggleBrowserNotify(true)
      return
    }
    const test = fireTestNotification()
    if (test.ok) {
      message.success('已发送测试通知；若没看到，请检查 Windows 通知设置/专注助手是否屏蔽了 Chrome')
    } else {
      message.warning(`测试通知未发出：${test.reason}`)
    }
  }

  return (
    <div className="tasks-page">
      <div className="tasks-header">
        <h2 className="tasks-title">定时任务</h2>
        <Space wrap>
          <Space size={6}>
            <span className="task-muted">浏览器通知</span>
            <Tooltip title="授权后任务完成会弹浏览器系统通知；所有标签页关闭后系统通知不可达（结果始终保留在任务专属会话）。若点了「测试」仍看不到弹窗，请检查 Windows 系统通知设置/专注助手是否屏蔽了 Chrome">
              <Switch
                size="small"
                checked={notifPermission === 'granted'}
                disabled={notifPermission === 'unsupported'}
                onChange={(checked) => void toggleBrowserNotify(checked)}
              />
            </Tooltip>
            {notifPermission === 'granted' && <Tag color="green">已开启</Tag>}
            {notifPermission === 'default' && <Tag>未开启</Tag>}
            {notifPermission === 'denied' && <Tag color="red">已拒绝（需在地址栏权限处修改）</Tag>}
            {notifPermission === 'unsupported' && <Tag>浏览器不支持</Tag>}
            <Button size="small" onClick={handleTestNotification} disabled={notifPermission === 'unsupported'}>
              测试
            </Button>
          </Space>
          <Button icon={<ReloadOutlined />} onClick={() => void loadAll()}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建任务
          </Button>
        </Space>
      </div>

      <Card className="tasks-panel">
        <Table<ScheduledTask>
          rowKey="id"
          loading={loading}
          dataSource={tasks}
          pagination={false}
          locale={{
            emptyText: (
              <Empty
                image={<img className="empty-illust" src={assistantAvatar} alt="" />}
                imageStyle={{ height: 'auto' }}
                description="还没有定时任务，创建一个试试吧（如「每天早上 8 点播报天气」）"
              />
            ),
          }}
          columns={[
            {
              title: '名称 / 指令',
              dataIndex: 'name',
              render: (_, task) => (
                <div className="task-name-cell">
                  <div className="task-name">{task.name}</div>
                  <Tooltip title={task.prompt}>
                    <div className="task-prompt-ellipsis">{task.prompt}</div>
                  </Tooltip>
                </div>
              ),
            },
            {
              title: '计划',
              dataIndex: 'cronExpr',
              width: 190,
              render: (expr: string) => (
                <div>
                  <div>{describeCron(expr)}</div>
                  <div className="tasks-cron-raw">{expr}</div>
                </div>
              ),
            },
            {
              title: '下次执行',
              dataIndex: 'nextRunAt',
              width: 150,
              render: (value: string | null, task) =>
                task.enabled ? formatTime(value) : <span className="task-muted">已停用</span>,
            },
            {
              title: '上次结果',
              width: 190,
              render: (_, task) => (
                <Space size={6} wrap>
                  {statusView(task.lastRun?.status)}
                  <span className="task-muted">
                    {task.lastRun?.finishedAt
                      ? formatTime(task.lastRun.finishedAt)
                      : '尚未执行'}
                  </span>
                  {task.lastRun?.errorMessage ? (
                    <Tooltip title={task.lastRun.errorMessage}>
                      <span className="task-error-hint">错误详情</span>
                    </Tooltip>
                  ) : null}
                </Space>
              ),
            },
            {
              title: '启用',
              width: 70,
              render: (_, task) => (
                <Switch
                  size="small"
                  checked={task.enabled}
                  onChange={(checked) => void toggleEnabled(task, checked)}
                />
              ),
            },
            {
              title: '操作',
              width: 270,
              render: (_, task) => (
                <Space size={4} wrap>
                  <Button
                    size="small"
                    type="primary"
                    ghost
                    icon={<PlayCircleOutlined />}
                    onClick={() => void handleRunNow(task)}
                  >
                    立即执行
                  </Button>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(task)}>
                    编辑
                  </Button>
                  <Button
                    size="small"
                    icon={<UnorderedListOutlined />}
                    onClick={() => void openRuns(task)}
                  >
                    记录
                  </Button>
                  <Popconfirm
                    title={`删除任务「${task.name}」？`}
                    description="专属会话与历史消息会保留"
                    okText="删除"
                    okButtonProps={{ danger: true }}
                    cancelText="取消"
                    onConfirm={() => handleDelete(task)}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      {/* 新建 / 编辑 Modal */}
      <Modal
        title={editingId == null ? '新建定时任务' : '编辑定时任务'}
        open={modalOpen}
        onOk={() => form.submit()}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
        confirmLoading={submitting}
        width={640}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          requiredMark="optional"
        >
          <Form.Item
            name="name"
            label="任务名称"
            rules={[{ required: true, message: '请输入任务名称' }, { max: 100, message: '最多 100 字' }]}
          >
            <Input placeholder="如 每日早报" maxLength={100} />
          </Form.Item>
          <Form.Item
            name="prompt"
            label="任务指令"
            rules={[{ required: true, message: '请输入任务指令' }, { max: 4000, message: '最多 4000 字' }]}
            extra="执行时系统会自动在指令前注入当前时间，可直接写「今天」「本周」这类相对时间"
          >
            <Input.TextArea
              rows={4}
              maxLength={4000}
              showCount
              placeholder="如：搜索今天的 AI 行业新闻，整理成 5 条要点发给我"
            />
          </Form.Item>
          <Form.Item
            name="cronExpr"
            label="执行计划（cron，秒 分 时 日 月 周，时区 Asia/Shanghai）"
            rules={[{ required: true, message: '请输入 cron 表达式' }]}
            extra={
              <Space size={6} wrap style={{ marginTop: 6 }}>
                <span>快捷：</span>
                {CRON_PRESETS.map((p) => (
                  <Button
                    key={p.value}
                    size="small"
                    onClick={() => form.setFieldValue('cronExpr', p.value)}
                  >
                    {p.label}
                  </Button>
                ))}
              </Space>
            }
          >
            <Input placeholder="0 0 8 * * *" style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          <Form.Item
            name="toolsWhitelist"
            label="允许自动使用的工具（可选）"
            extra={
              <div className="tasks-risk-note">
                勾选的工具将在任务执行时自动放行，无需你确认；请仅勾选任务确实需要且可信的工具。
                未勾选时任务只能使用无需确认的普通工具，涉及敏感操作会被自动拒绝。
              </div>
            }
          >
            <Select
              mode="multiple"
              allowClear
              placeholder={`从内置工具中选择（共 ${tools.length} 个可用）`}
              options={tools.map((t) => ({ label: t, value: t }))}
              disabled={tools.length === 0}
            />
          </Form.Item>
          <Form.Item name="enabled" label="创建后立即启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      {/* 执行记录抽屉 */}
      <Drawer
        title={runsTarget ? `执行记录 · ${runsTarget.name}` : '执行记录'}
        open={!!runsTarget}
        onClose={() => setRunsTarget(null)}
        width={720}
      >
        <Table<ScheduledTaskRun>
          rowKey="id"
          size="small"
          loading={runsLoading}
          dataSource={runs}
          pagination={false}
          locale={{ emptyText: '暂无执行记录' }}
          columns={[
            {
              title: '开始时间',
              dataIndex: 'startedAt',
              width: 150,
              render: (v: string | null) => formatTime(v),
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (s: string) => statusView(s),
            },
            {
              title: '耗时',
              dataIndex: 'durationMs',
              width: 90,
              render: (v: number | null) => (v == null ? '—' : `${v} ms`),
            },
            {
              title: '错误',
              dataIndex: 'errorMessage',
              render: (v: string | null) =>
                v ? (
                  <Tooltip title={v}>
                    <span className="task-prompt-ellipsis">{v}</span>
                  </Tooltip>
                ) : (
                  <span className="task-muted">—</span>
                ),
            },
            {
              title: '结果',
              width: 100,
              render: (_, run) => (
                <Button
                  size="small"
                  type="link"
                  disabled={!runsTarget?.conversationId}
                  onClick={() => {
                    if (runsTarget?.conversationId) {
                      setRunsTarget(null)
                      navigate(`/chat?conversationId=${runsTarget.conversationId}`)
                    }
                  }}
                >
                  查看会话
                </Button>
              ),
            },
          ]}
        />
      </Drawer>
    </div>
  )
}