/**
 * Agent 平台多端共享类型契约。
 *
 * 这里只放 DTO / 接口形状，不放任何平台实现：
 * Web（localStorage + fetch）、移动端（AsyncStorage + react-native-sse）、
 * 桌面端（Electron preload 桥）都从这里取类型，避免三份定义漂移。
 */

// ==================== 认证 ====================

export interface AuthUser {
  username: string
  nickname: string
  /** 管理员（白名单驱动，仅控制后台菜单显隐；接口仍由服务端 AdminInterceptor 兜底 403） */
  admin?: boolean
}

/** 登录/注册//me 接口返回 */
export interface AuthResponse {
  token?: string
  username: string
  nickname: string
  admin?: boolean
}

// ==================== 多会话 ====================

export interface Conversation {
  id: number
  title: string
  createdAt?: string
  updatedAt?: string
}

// ==================== 知识库（RAG 文档） ====================

export interface KnowledgeDoc {
  id: number
  docName: string
  docType: string
  chunkCount: number
  createdAt: string
}

/** 移动端表单上传的文件描述（RN FormData 原生写法） */
export interface UploadFileSource {
  uri: string
  name: string
  type?: string
}

// ==================== 全链路 trace ====================

export interface ToolTrace {
  round: number
  id?: string
  name: string
  arguments?: string
  result?: string
  success: boolean
  error?: string | null
  durationMs: number
  /** 发起该工具调用的 Agent 归属：null/缺省=主 Agent（顶层），非空=子代理技能名（Agent-as-Tool 嵌套归属） */
  agentId?: string | null
}

export interface RagSegment {
  docId?: string
  source: string
  type: string
  text: string
  score: number
  /** 命中通道：vector 语义 / keyword 关键词 / both 双路（老数据缺省 vector） */
  channel?: 'vector' | 'keyword' | 'both' | string
  /** Rerank 精排 raw logit（未启用精排时为空） */
  rerankScore?: number | null
}

export interface RagTrace {
  query: string
  segments: RagSegment[]
  /** 发起检索的 Agent：null/缺省=主 Agent，非空=子代理技能名 */
  agentId?: string | null
}

/** 一次子代理委派（父子 Agent 调用树节点） */
export interface DelegationTrace {
  id: string
  /** 子代理技能名；planner=计划编排节点 */
  agent: string
  /** 父委派 id：null/缺省=主 Agent 直接发起 */
  parentId?: string | null
  task?: string
  success: boolean
  error?: string | null
  durationMs: number
  tokens: number
}

export interface UsageTrace {
  model?: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  rounds: number
  fallback: boolean
  cancelled: boolean
  durationMs: number
  /** backend 转发 usage 事件/历史回查时附加（费用只以后端计算为准） */
  costYuan?: number
}

/** 历史 trace 懒加载返回（GET /api/chat/traces/{traceId}） */
export interface TraceDetail {
  traceId: string
  usage: UsageTrace
  tools: ToolTrace[]
  recalls: RagTrace[]
  delegations: DelegationTrace[]
}

// ==================== 多模态图片 ====================

/** 发送图片入参：data 为不含 data: 前缀的原始 base64 */
export interface ChatImageInput {
  mimeType: string
  data: string
}

/** 历史消息图片附件（元数据；字节经 /api/chat/attachments/{id} 鉴权拉取） */
export interface ChatAttachment {
  id: number
  mimeType: string
}

// ==================== 高危工具人工确认 ====================

export interface ApprovalRequestData {
  approvalId: string
  /** LangChain4j 工具名（MCP 工具为原始名） */
  tool: string
  /** low / medium / high */
  riskLevel: string
  /** 中文动作标题（如「发起 HTTP 请求」） */
  title: string
  /** 参数预览（≤500 字符） */
  argsPreview: string
  traceId?: string
  conversationId?: number
}

export interface ApprovalDecisionResult {
  approvalId: string
  state: string
  tool: string
  conversationId: number
  remember: boolean
}

// ==================== 技能管理 ====================

export interface Skill {
  name: string
  shortDescription: string
  detailedDescription: string
  systemPrompt: string
  builtin: boolean
  mounted: boolean
  createdBy: string
  toolNames: string[]
  /** 技能类型：tool（普通技能包，默认）| agent（子代理：独立循环 + 私有工具） */
  type?: string
}

export interface SkillUploadPayload {
  name: string
  shortDescription: string
  detailedDescription: string
  systemPrompt: string
  toolNames: string[]
}

// ==================== 用量统计 ====================

export interface UsageTotals {
  turns: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costYuan: number
}

export interface ModelUsageRow {
  model: string
  turns: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costYuan: number
}

export interface ConversationUsageRow {
  conversationId: number
  title: string | null
  turns: number
  totalTokens: number
  costYuan: number
}

export interface UsageSummary {
  range: { from: string; to: string }
  totals: UsageTotals
  byModel: ModelUsageRow[]
  byConversation: ConversationUsageRow[]
}

// ==================== 回答反馈 ====================

/** 某条助手消息上的反馈状态（history 接口附带） */
export interface FeedbackInfo {
  rating: number // 1=赞，-1=踩
  reasonCode?: string | null
  comment?: string | null
}

export interface FeedbackReason {
  code: string
  label: string
}

export interface AdminFeedbackRow {
  id: number
  traceId: string
  userId: string
  conversationId: number
  conversationTitle: string
  rating: number
  reasonCode?: string | null
  reasonLabel?: string | null
  comment?: string | null
  question?: string | null
  answer?: string | null
  createdAt: string
  updatedAt: string
}

export interface AdminFeedbackPage {
  content: AdminFeedbackRow[]
  page: number
  size: number
  total: number
  totalPages: number
}

export interface FeedbackReasonStat {
  reasonCode: string | null
  reasonLabel: string | null
  count: number
}

export interface FeedbackStats {
  total: number
  up: number
  down: number
  byReason: FeedbackReasonStat[]
}

export interface FeedbackListParams {
  rating?: number // 1 / -1 / 不传
  reason?: string
  keyword?: string
  from?: string // yyyy-MM-dd
  to?: string
  page?: number
  size?: number
}

// ==================== 定时任务 ====================

/** 任务最近一次执行结果（列表页「上次结果」列） */
export interface ScheduledTaskLastRun {
  status: string
  finishedAt: string
  durationMs: number
  errorMessage: string
  assistantMessageId: number
}

export interface ScheduledTask {
  id: number
  name: string
  prompt: string
  /** Spring 6 段 cron（秒 分 时 日 月 周） */
  cronExpr: string
  enabled: boolean
  /** 任务级预授权工具（勾选=该任务自动放行这些工具，无需用户确认） */
  toolsWhitelist: string[]
  /** 任务专属会话（懒创建；结果在其中查看） */
  conversationId: number | null
  /** 下次执行时间（停用为 null） */
  nextRunAt: string | null
  lastRunAt: string | null
  createdAt: string
  updatedAt: string
  lastRun: ScheduledTaskLastRun | null
}

export interface ScheduledTaskRun {
  id: number
  /** running / success / failed / skipped_budget */
  status: string
  traceId?: string | null
  durationMs?: number | null
  errorMessage?: string | null
  startedAt?: string | null
  finishedAt?: string | null
  assistantMessageId?: number | null
}

/** 创建/更新入参（PATCH 语义：仅传要改的字段） */
export interface TaskPayload {
  name?: string
  prompt?: string
  cronExpr?: string
  toolsWhitelist?: string[]
  enabled?: boolean
}

// ==================== 站内通知 ====================

export interface AppNotification {
  id: number
  /** 事件类型（v1 恒为 task_result，预留扩展） */
  type: string
  title: string
  body?: string | null
  /** 点击跳转目标会话（任务专属会话） */
  targetConversationId?: number | null
  read: boolean
  createdAt: string
}

// ==================== Agent 评测 ====================

/** 一次评测运行（聚合指标 + 元信息） */
export interface EvalRunRow {
  runId: string
  label?: string | null
  datasetName?: string | null
  mode?: string | null
  model?: string | null
  judgeEnabled: boolean
  total: number
  passed: number
  failed: number
  passRate: number
  /** 无对应样本时为 null（N/A），前端显示「—」 */
  toolAccuracy?: number | null
  citationAccuracy?: number | null
  pointCoverage?: number | null
  refusalRate?: number | null
  avgTokens: number
  avgDurationMs: number
  generatedAt?: string | null
  createdAt?: string | null
}

/** 逐例结果 */
export interface EvalCaseRow {
  caseId: string
  category?: string | null
  passed: boolean
  failedChecks: string[]
  /** 断言明细 JSON 字符串（[{name,passed,expected,actual,detail}]） */
  checksJson?: string | null
  answer?: string | null
  actualTools: string[]
  citedDocs: string[]
  retrievedDocs: string[]
  tokens: number
  durationMs: number
}

export interface EvalRunDetail {
  run: EvalRunRow
  cases: EvalCaseRow[]
}

export interface EvalTrendPoint {
  runId: string
  label?: string | null
  passRate: number
  toolAccuracy?: number | null
  citationAccuracy?: number | null
  pointCoverage?: number | null
  refusalRate?: number | null
  createdAt?: string | null
}

export interface EvalStats {
  latest: EvalRunRow | null
  trend: EvalTrendPoint[]
  runCount: number
  candidateNew: number
}

export interface EvalDiffView {
  baseRunId: string
  currentRunId: string
  base: EvalRunRow
  current: EvalRunRow
  fixedCases: string[]
  brokenCases: string[]
  metricDeltas: Record<string, number | null>
}

/** 反馈反哺的候选用例 */
export interface EvalCandidateRow {
  id: number
  traceId: string
  userId: string
  question?: string | null
  answer?: string | null
  reasonCode?: string | null
  comment?: string | null
  suggestedCategory: string
  suggestedPoints: string[]
  status: string
  createdAt?: string | null
}

export interface EvalRunPage {
  content: EvalRunRow[]
  page: number
  size: number
  total: number
  totalPages: number
}

// ==================== Electron 桌面端桥 ====================

/** 本地 MCP Server 进程状态（Electron 主进程 → 渲染进程） */
export interface DesktopMcpStatus {
  state: 'starting' | 'running' | 'stopped' | 'error'
  /** http://127.0.0.1:{port}/mcp（running 时存在） */
  endpoint?: string
  pid?: number
  error?: string
}

/** preload 注入到 window.agentDesktop 的受控桥 */
export interface DesktopBridge {
  isDesktop: true
  mcp: {
    getStatus(): Promise<DesktopMcpStatus>
    /** 订阅状态变化，返回取消订阅函数 */
    onStatus(callback: (status: DesktopMcpStatus) => void): () => void
  }
}
