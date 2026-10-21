import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { App as AntdApp, Checkbox, Image as AntImage, Input, Modal, Space, Spin, Tag, Tooltip } from 'antd'
import {
  ArrowUpOutlined,
  CloseOutlined,
  PictureOutlined,
  StopOutlined,
  ToolOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  api,
  createConversation,
  decideApproval,
  streamChat,
  type ApprovalRequestData,
  type ChatAttachment,
  type ChatImageInput,
  type DelegationTrace,
  type FeedbackInfo,
  type RagTrace,
  type ToolTrace,
  type UsageTrace,
} from '../api'
import { useAuth } from '../auth'
import { useConversations } from '../layouts/MainLayout'
import { TracePanels, TraceFooter, type CiteSignal } from '../components/TracePanels'
import { CitationText } from '../components/CitationText'
import HistoricalTrace from '../components/HistoricalTrace'
import FeedbackBar from '../components/FeedbackBar'
import AuthImage from '../components/AuthImage'
import assistantAvatar from '../assets/assistant-avatar.jpg'

const { TextArea } = Input

/** 图片限制（需与后端 app.chat.image 配置一致） */
const MAX_IMAGES = 3
const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

/** 待发送图片：本地预览 dataURL + 上送给后端的纯 base64 */
interface PendingImage {
  uid: string
  mimeType: string
  dataUrl: string
  base64: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  /** 全链路 traceId（历史消息由 history 接口返回；实时流由响应头返回） */
  traceId?: string
  tools?: ToolTrace[]
  recalls?: RagTrace[]
  /** 子代理委派节点（父子 Agent 调用树） */
  delegations?: DelegationTrace[]
  usage?: UsageTrace & { costYuan?: number }
  /** 本回合赞/踩反馈（history 接口附带；实时提交后本地回写） */
  feedback?: FeedbackInfo | null
  /** 历史消息的图片附件（P1-8，服务端按 id 鉴权拉取） */
  attachments?: ChatAttachment[]
  /** 乐观气泡的本地图片（刚发送、历史尚未刷新时直接展示 dataURL） */
  localImages?: string[]
}

interface Skill {
  name: string
  shortDescription: string
  mounted: boolean
}

/** 根据当前时间生成问候语 */
function greetingOf(): string {
  const h = new Date().getHours()
  if (h < 5) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

/** 用首条消息生成会话标题：折叠空白，超长截断（ChatGPT 风格；后端标题上限 200 字） */
function titleFromMessage(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > 30 ? `${oneLine.slice(0, 30)}…` : oneLine
}

export default function ChatPage() {
  const { user } = useAuth()
  const { message } = AntdApp.useApp()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { addConversation } = useConversations()

  // 会话 id 由 MainLayout 侧边栏通过 URL query 传入：
  // 无参数 = 草稿新会话（null，尚未落库）；0 = 默认/历史会话；N > 0 = 真实会话
  const convParam = searchParams.get('conversationId')
  const parsedConvId = convParam === null ? null : Number(convParam)
  const activeConversationId =
    parsedConvId !== null && Number.isFinite(parsedConvId) && parsedConvId >= 0 ? parsedConvId : null

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(activeConversationId !== null)
  const [mountedSkills, setMountedSkills] = useState<Skill[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  // 当前流式请求的 AbortController：点"停止"时 abort，前端断开 → 后端/agent 逐级取消生成
  const abortRef = useRef<AbortController | null>(null)
  // 草稿态首条消息刚建会话并 replace 到新 id 时，跳过一次历史重载（乐观气泡已在屏上）
  const skipHistoryLoadRef = useRef<number | null>(null)

  // 高危工具审批：SSE 推来的审批请求排队，单弹窗依次处理
  const [approvalQueue, setApprovalQueue] = useState<ApprovalRequestData[]>([])
  const [approvalDeciding, setApprovalDeciding] = useState(false)
  /** 引用 [n] 点击信号（按消息序号）：驱动对应 TracePanels 展开+定位高亮（P1-9.4） */
  const [citeSignals, setCiteSignals] = useState<Record<number, CiteSignal>>({})
  const [rememberGrant, setRememberGrant] = useState(false)
  const currentApproval = approvalQueue[0]

  // P1-8 待发送图片（本地预览 + 纯 base64）；隐藏的 file input 用于触发选择
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  /** 选择图片：类型/大小/数量前端预校验（后端仍有权威校验），读为 dataURL 预览 */
  async function handlePickImages(files: FileList | null) {
    if (!files || files.length === 0) return
    const remaining = MAX_IMAGES - pendingImages.length
    if (remaining <= 0) {
      message.warning(`单条消息最多发送 ${MAX_IMAGES} 张图片`)
      return
    }
    const picked = Array.from(files).slice(0, remaining)
    if (files.length > remaining) {
      message.warning(`单条消息最多发送 ${MAX_IMAGES} 张图片，已只取前 ${remaining} 张`)
    }
    const loaded: PendingImage[] = []
    for (const file of picked) {
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        message.warning(`「${file.name}」格式不支持，仅支持 JPEG/PNG/GIF/WebP`)
        continue
      }
      if (file.size > MAX_IMAGE_SIZE) {
        message.warning(`「${file.name}」超过 5MB，已跳过`)
        continue
      }
      const dataUrl = await fileToDataUrl(file)
      const comma = dataUrl.indexOf(',')
      loaded.push({
        uid: crypto.randomUUID(),
        mimeType: file.type,
        dataUrl,
        base64: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl,
      })
    }
    if (loaded.length > 0) {
      setPendingImages((prev) => [...prev, ...loaded].slice(0, MAX_IMAGES))
    }
  }

  function removePendingImage(uid: string) {
    setPendingImages((prev) => prev.filter((p) => p.uid !== uid))
  }

  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  // 进入页面 / 切换会话时加载对应历史；草稿态直接是空白欢迎页，不请求历史
  useEffect(() => {
    if (activeConversationId === null) {
      setMessages([])
      setHistoryLoading(false)
      return
    }
    if (skipHistoryLoadRef.current === activeConversationId) {
      skipHistoryLoadRef.current = null
      setHistoryLoading(false)
      return
    }
    loadHistory(activeConversationId)
  }, [activeConversationId])

  useEffect(() => {
    loadSkills()
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  async function loadHistory(conversationId: number) {
    setMessages([])
    setHistoryLoading(true)
    try {
      const data = await api<{ messages: Message[] }>(`/api/chat/history?conversationId=${conversationId}`)
      setMessages(data.messages || [])
    } catch (err: any) {
      message.error(err.message)
    } finally {
      setHistoryLoading(false)
    }
  }

  async function loadSkills() {
    try {
      const data = await api<{ skills: Skill[] }>('/api/skills')
      setMountedSkills((data.skills || []).filter((s) => s.mounted))
    } catch {
      // 技能加载失败不阻塞对话
    }
  }

  async function send() {
    const text = input.trim()
    if (loading) return
    // 文字与图片至少有其一（纯图片回合合法，后端会用兜底指令问模型）
    if (!text && pendingImages.length === 0) return

    // 取出待发图片并立即清空输入区（发送失败也不回滚到输入框，避免状态纠缠）
    const imagesToSend: ChatImageInput[] = pendingImages.map((p) => ({
      mimeType: p.mimeType,
      data: p.base64,
    }))
    const localPreviews = pendingImages.map((p) => p.dataUrl)
    setPendingImages([])

    let conversationId = activeConversationId

    // 草稿态：点击"新聊天"时未写库，直到首条消息真正发出才创建会话
    if (conversationId === null) {
      setLoading(true)
      try {
        const created = await createConversation(text ? titleFromMessage(text) : '图片消息')
        conversationId = created.id
        // 侧边栏即时置顶出现新会话；replace 换 URL（刷新/中断后仍在该会话）
        addConversation(created)
        skipHistoryLoadRef.current = created.id
        navigate(`/chat?conversationId=${created.id}`, { replace: true })
      } catch (err: any) {
        message.error(err.message)
        setLoading(false)
        return
      }
    }

    // 用户消息（含本地图片预览）+ 占位的空 AI 消息（token 逐段追加进去）
    setMessages((m) => [
      ...m,
      { role: 'user', content: text, localImages: localPreviews },
      { role: 'assistant', content: '' },
    ])
    setInput('')
    setLoading(true)

    const controller = new AbortController()
    abortRef.current = controller

    /** 不可变更新最后一条助手消息 */
    const patchLast = (patch: Partial<Message>) =>
      setMessages((m) => {
        const copy = [...m]
        const last = copy[copy.length - 1]
        if (last && last.role === 'assistant') {
          copy[copy.length - 1] = { ...last, ...patch }
        }
        return copy
      })

    try {
      await streamChat(text, conversationId, {
        signal: controller.signal,
        onTraceId: (id) => patchLast({ traceId: id }),
        onToken: (token) =>
          setMessages((m) => {
            const copy = [...m]
            const last = copy[copy.length - 1]
            if (last && last.role === 'assistant') {
              copy[copy.length - 1] = { ...last, content: last.content + token }
            }
            return copy
          }),
        onTool: (tool) =>
          setMessages((m) => {
            const copy = [...m]
            const last = copy[copy.length - 1]
            if (last && last.role === 'assistant') {
              copy[copy.length - 1] = { ...last, tools: [...(last.tools || []), tool] }
            }
            return copy
          }),
        onRag: (rag) =>
          setMessages((m) => {
            const copy = [...m]
            const last = copy[copy.length - 1]
            if (last && last.role === 'assistant') {
              copy[copy.length - 1] = { ...last, recalls: [...(last.recalls || []), rag] }
            }
            return copy
          }),
        onDelegation: (delegation) =>
          setMessages((m) => {
            const copy = [...m]
            const last = copy[copy.length - 1]
            if (last && last.role === 'assistant') {
              copy[copy.length - 1] = {
                ...last,
                delegations: [...(last.delegations || []), delegation],
              }
            }
            return copy
          }),
        onUsage: (usage) => patchLast({ usage }),
        onReset: () => patchLast({ tools: [], recalls: [], delegations: [], usage: undefined }),
        onApproval: (approval) =>
          setApprovalQueue((q) => [...q, approval]),
      }, imagesToSend)
    } catch (err: any) {
      // 用户主动停止：保留已生成内容，不弹错误
      if (err?.status === 0 && err?.message === '已停止生成') return
      message.error(err.message)
      setMessages((m) => {
        const copy = [...m]
        const last = copy[copy.length - 1]
        if (last && last.role === 'assistant') {
          copy[copy.length - 1] = {
            ...last,
            content: last.content || `请求失败：${err.message}，请稍后重试。`,
          }
        }
        return copy
      })
    } finally {
      abortRef.current = null
      setLoading(false)
      // 流结束清理未决审批（断连/取消时 agent 侧会自动拒绝）
      setApprovalQueue([])
      setRememberGrant(false)
      setApprovalDeciding(false)
    }
  }

  /** 提交高危工具审批决策：拒绝/允许（可选「本次会话始终允许」） */
  async function decideCurrentApproval(approved: boolean) {
    const approval = currentApproval
    if (!approval || approvalDeciding) return
    setApprovalDeciding(true)
    try {
      await decideApproval(approval.approvalId, approved, approved && rememberGrant)
    } catch (err: any) {
      message.error(`审批提交失败：${err.message}（服务端将按超时自动拒绝）`)
    } finally {
      setApprovalDeciding(false)
      setRememberGrant(false)
      setApprovalQueue((q) => q.slice(1))
    }
  }

  /** 停止当前生成：abort 前端 fetch → 后端/agent 逐级断开并取消 LLM 生成 */
  function stop() {
    abortRef.current?.abort()
  }

  /** 不可变更新指定位置的消息（反馈状态回写） */
  function patchMessageAt(index: number, patch: Partial<Message>) {
    setMessages((list) => list.map((m, idx) => (idx === index ? { ...m, ...patch } : m)))
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const displayName = user?.nickname || user?.username || '朋友'
  const isEmpty = !historyLoading && messages.length === 0

  // ============ 胶囊输入框（空态 / 对话态共用） ============
  const composer = (
    <div className="chat-composer-wrap">
      {mountedSkills.length > 0 && (
        <div className="chat-skills">
          <span className="chat-skills-label">
            <ToolOutlined /> 已挂载技能
          </span>
          {mountedSkills.map((s) => (
            <Tooltip key={s.name} title={s.shortDescription}>
              <span className="chat-skill-chip">{s.name}</span>
            </Tooltip>
          ))}
        </div>
      )}

      {pendingImages.length > 0 && (
        <div className="chat-image-preview-row">
          {pendingImages.map((img) => (
            <div key={img.uid} className="chat-image-preview-item">
              <img src={img.dataUrl} alt="待发送图片" />
              <button
                type="button"
                className="chat-image-preview-remove"
                aria-label="移除图片"
                onClick={() => removePendingImage(img.uid)}
              >
                <CloseOutlined />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="chat-composer">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          multiple
          hidden
          onChange={(e) => {
            void handlePickImages(e.target.files)
            // 允许重复选同一张图（不清空则 change 事件不再触发）
            e.target.value = ''
          }}
        />
        <button
          type="button"
          className="chat-image-btn"
          aria-label="发送图片"
          title="发送图片（JPEG/PNG/GIF/WebP，单张≤5MB，最多3张）"
          disabled={loading || pendingImages.length >= MAX_IMAGES}
          onClick={() => fileInputRef.current?.click()}
        >
          <PictureOutlined />
        </button>
        <TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={pendingImages.length > 0 ? '补充说明，或直接发送图片' : '有问题，随便问'}
          variant="borderless"
          autoSize={{ minRows: 1, maxRows: 6 }}
          disabled={loading}
        />
        <button
          type="button"
          className="chat-send-btn"
          aria-label={loading ? '停止生成' : '发送'}
          onClick={loading ? stop : send}
          disabled={!loading && !input.trim() && pendingImages.length === 0}
        >
          {loading ? <StopOutlined /> : <ArrowUpOutlined />}
        </button>
      </div>

      <p className="chat-hint">
        Enter 发送，Shift + Enter 换行
        {mountedSkills.length === 0 ? ' · 可在「技能管理」中挂载工具技能' : ''}
      </p>
    </div>
  )

  // ============ 高危工具审批弹窗（SSE 推来请求，决策走独立接口） ============
  const riskLevel = currentApproval?.riskLevel
  const riskColor = riskLevel === 'high' ? 'red' : riskLevel === 'medium' ? 'orange' : 'blue'
  const riskText = riskLevel === 'high' ? '高危' : riskLevel === 'medium' ? '中危' : '低危'
  const approvalModal = (
    <Modal
      open={!!currentApproval}
      title={
        <Space>
          <WarningOutlined style={{ color: '#d4380d' }} />
          {currentApproval?.title || '高危操作确认'}
        </Space>
      }
      okText="允许执行"
      cancelText="拒绝"
      confirmLoading={approvalDeciding}
      cancelButtonProps={{ disabled: approvalDeciding }}
      maskClosable={false}
      keyboard={false}
      width={560}
      okButtonProps={{ danger: riskLevel === 'high' }}
      onOk={() => void decideCurrentApproval(true)}
      onCancel={() => void decideCurrentApproval(false)}
    >
      {currentApproval && (
        <div className="approval-body">
          <p className="approval-desc">
            AI 助手即将执行外部操作，请核对以下工具与参数；拒绝后该操作不会执行。
          </p>
          <Space size={8} wrap style={{ marginBottom: 10 }}>
            <Tag color={riskColor}>{riskText}</Tag>
            <code className="approval-tool">{currentApproval.tool}</code>
          </Space>
          <pre className="approval-args">{currentApproval.argsPreview || '（无参数）'}</pre>
          <Checkbox
            checked={rememberGrant}
            onChange={(e) => setRememberGrant(e.target.checked)}
          >
            本次会话始终允许此工具（同一会话后续调用不再询问）
          </Checkbox>
        </div>
      )}
    </Modal>
  )

  // ============ 空态：居中问候 + 输入框 ============
  if (historyLoading) {
    return (
      <div className="chat-page">
        <div className="chat-loading">
          <Spin />
          <span>加载会话历史...</span>
        </div>
      </div>
    )
  }

  if (isEmpty) {
    return (
      <div className="chat-page chat-page--welcome">
        <div className="chat-welcome">
          <div className="chat-welcome-hero">
            <img src={assistantAvatar} alt="AI 助手" />
          </div>
          <h1 className="chat-greeting">
            {greetingOf()}，{displayName}
          </h1>
          <p className="chat-welcome-sub">温柔而高效地和你对话，写东西、查资料都可以交给我</p>
          {composer}
        </div>
        {approvalModal}
      </div>
    )
  }

  // ============ 对话态：消息流 + 底部输入框 ============
  return (
    <div className="chat-page">
      <div className="chat-message-list" ref={listRef}>
        <div className="chat-thread">
          {messages.map((m, i) => {
            const streaming = loading && i === messages.length - 1 && m.role === 'assistant'
            if (m.role === 'user') {
              const hasImages = (m.localImages?.length || 0) > 0 || (m.attachments?.length || 0) > 0
              return (
                <div key={i} className="chat-row user">
                  <div className="chat-bubble-user">
                    {/* 纯图片回合 content 为空串，不渲染空文本块 */}
                    {m.content && <pre className="chat-text">{m.content}</pre>}
                    {hasImages && (
                      <div className="chat-attachments">
                        {m.localImages?.map((src) => (
                          <AntImage
                            key={src.slice(0, 32)}
                            src={src}
                            width={160}
                            height={160}
                            style={{ objectFit: 'cover', borderRadius: 8 }}
                            alt="发送的图片"
                          />
                        ))}
                        {m.attachments?.map((a) => (
                          <AuthImage key={a.id} attachmentId={a.id} maxWidth={200} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            }
            const hasLiveTrace = (m.tools?.length || 0) > 0 || (m.recalls?.length || 0) > 0
              || (m.delegations?.length || 0) > 0
            // 回答里的 [n] 只对应文档片段（历史对话片段不编号）
            const docSegmentCount = (m.recalls || []).reduce(
              (n, r) => n + (r.segments || []).filter((s) => s.type !== 'conversation').length,
              0,
            )
            return (
              <div key={i} className="chat-row assistant">
                <img className="chat-avatar" src={assistantAvatar} alt="助手" />
                {streaming && !m.content && !hasLiveTrace ? (
                  <span className="chat-thinking">
                    <Spin size="small" /> 思考中...
                  </span>
                ) : (
                  <div className="chat-bubble-assistant">
                    <TracePanels
                      tools={m.tools}
                      recalls={m.recalls}
                      delegations={m.delegations}
                      citeSignal={citeSignals[i] ?? null}
                    />
                    {m.content && (
                      <CitationText
                        content={m.content}
                        streaming={streaming}
                        docSegmentCount={docSegmentCount}
                        onCite={(n) => setCiteSignals((prev) => ({ ...prev, [i]: { n, ts: Date.now() } }))}
                      />
                    )}
                    {/* 实时 trace 已在上方渲染；历史消息（无实时数据但有 traceId）懒加载回看 */}
                    {!streaming && !hasLiveTrace && m.traceId && (
                      <HistoricalTrace traceId={m.traceId} />
                    )}
                    {(hasLiveTrace || m.usage) && <TraceFooter usage={m.usage} traceId={m.traceId} />}
                    {/* 赞/踩：仅完整回复（非流式中）且有 traceId 时展示 */}
                    {!streaming && m.traceId && m.content && (
                      <FeedbackBar
                        traceId={m.traceId}
                        initial={m.feedback ?? null}
                        onChange={(fb) => patchMessageAt(i, { feedback: fb })}
                      />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {composer}
      {approvalModal}
    </div>
  )
}
