import { useEffect, useMemo, useState } from 'react'
import { App as AntdApp, Button, Input, Popover, Radio, Space, Tooltip } from 'antd'
import { DislikeOutlined, LikeOutlined } from '@ant-design/icons'
import {
  getFeedbackReasons,
  submitFeedback,
  type FeedbackInfo,
  type FeedbackReason,
} from '../api'

// 原因字典全局只拉一次（多个气泡共享；失败静默退化为仅备注）
let reasonsPromise: Promise<FeedbackReason[]> | null = null
function loadReasons(): Promise<FeedbackReason[]> {
  if (!reasonsPromise) {
    reasonsPromise = getFeedbackReasons().catch(() => [])
  }
  return reasonsPromise
}

interface Props {
  traceId: string
  /** history 接口带回的既有反馈（无则 null） */
  initial: FeedbackInfo | null
  /** 反馈变更后同步给父组件（取消时回传 null） */
  onChange?: (feedback: FeedbackInfo | null) => void
}

/**
 * 助手回答反馈条（P2-11.1）：点赞即时提交；点踩弹出原因 + 备注表单；再点已选评价 = 取消。
 */
export default function FeedbackBar({ traceId, initial, onChange }: Props) {
  const { message } = AntdApp.useApp()
  const [rating, setRating] = useState<number>(initial?.rating ?? 0)
  const [reasons, setReasons] = useState<FeedbackReason[]>([])
  const [reasonCode, setReasonCode] = useState<string>(initial?.reasonCode || '')
  const [comment, setComment] = useState<string>(initial?.comment || '')
  const [popOpen, setPopOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // 切换历史会话时 initial 会整体替换，按 traceId 同步本地态
  useEffect(() => {
    setRating(initial?.rating ?? 0)
    setReasonCode(initial?.reasonCode || '')
    setComment(initial?.comment || '')
  }, [traceId, initial])

  useEffect(() => {
    loadReasons().then(setReasons)
  }, [])

  const busy = submitting

  async function post(next: number, reason?: string, note?: string) {
    setSubmitting(true)
    // 乐观更新
    const prev = rating
    setRating(next)
    try {
      const res = await submitFeedback(traceId, next, reason, note)
      const effective: FeedbackInfo | null =
        res.rating === 0 ? null : { rating: res.rating, reasonCode: reason || null, comment: note || null }
      if (res.rating === 0) {
        setReasonCode('')
        setComment('')
      }
      onChange?.(effective)
    } catch (err: any) {
      setRating(prev)
      message.error(err.message || '反馈提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  function handleLike() {
    if (busy) return
    void post(rating === 1 ? 0 : 1)
  }

  function handleDislikeClick() {
    if (busy) return
    // 已踩：再点直接取消；未踩：打开原因表单
    if (rating === -1) {
      void post(0)
      return
    }
    setReasonCode('')
    setComment('')
    setPopOpen(true)
  }

  function submitDown() {
    const reason = reasonCode || undefined
    const note = comment.trim() || undefined
    setPopOpen(false)
    void post(-1, reason, note)
  }

  const downForm = useMemo(
    () => (
      <div className="feedback-down-form">
        <Radio.Group
          className="feedback-reasons"
          value={reasonCode || null}
          onChange={(e) => setReasonCode(e.target.value)}
        >
          <Space direction="vertical" size={6}>
            {reasons.map((r) => (
              <Radio key={r.code} value={r.code}>
                {r.label}
              </Radio>
            ))}
          </Space>
        </Radio.Group>
        <Input.TextArea
          className="feedback-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="补充说明（可选，1000 字以内）"
          maxLength={1000}
          autoSize={{ minRows: 2, maxRows: 4 }}
        />
        <div className="feedback-down-actions">
          <Button size="small" onClick={() => setPopOpen(false)}>
            取消
          </Button>
          <Button size="small" type="primary" danger loading={submitting} onClick={submitDown}>
            提交反馈
          </Button>
        </div>
      </div>
    ),
    [reasons, reasonCode, comment, submitting],
  )

  return (
    <div className="feedback-bar">
      <Tooltip title="有帮助">
        <Button
          type="text"
          size="small"
          className={rating === 1 ? 'feedback-btn active up' : 'feedback-btn'}
          icon={<LikeOutlined />}
          disabled={busy}
          onClick={handleLike}
        />
      </Tooltip>
      <Popover
        title="这条回答哪里不好？"
        trigger="click"
        open={popOpen}
        onOpenChange={(open) => {
          if (!submitting) setPopOpen(open)
        }}
        content={downForm}
        placement="bottomLeft"
      >
        <Tooltip title="没帮助">
          <Button
            type="text"
            size="small"
            className={rating === -1 ? 'feedback-btn active down' : 'feedback-btn'}
            icon={<DislikeOutlined />}
            disabled={busy}
            onClick={handleDislikeClick}
          />
        </Tooltip>
      </Popover>
    </div>
  )
}
