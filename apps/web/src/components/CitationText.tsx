import type { ReactNode } from 'react'
import { Tag } from 'antd'

/**
 * 助手回答正文渲染（P1-9.4）：
 * 把回答中的 [n] 引用标记渲染成可点 chip，点击跳转到「知识召回」面板第 n 个文档片段。
 * 编号超出本轮文档片段数时（模型偶尔误标/代码内容）按纯文本展示，避免误导。
 */
const REF_RE = /\[(\d{1,2})\]/g

export function CitationText({
  content,
  streaming,
  docSegmentCount,
  onCite,
}: {
  content: string
  streaming?: boolean
  /** 本轮召回的文档片段数（历史对话片段不计编号） */
  docSegmentCount: number
  onCite?: (n: number) => void
}) {
  const nodes: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  REF_RE.lastIndex = 0
  while ((m = REF_RE.exec(content)) !== null) {
    const n = Number(m[1])
    nodes.push(content.slice(last, m.index))
    if (n >= 1 && n <= docSegmentCount) {
      nodes.push(
        <Tag
          key={`cite-${key++}`}
          color="blue"
          className="cite-chip"
          onClick={() => onCite?.(n)}
        >
          [{n}]
        </Tag>,
      )
    } else {
      nodes.push(m[0])
    }
    last = m.index + m[0].length
  }
  nodes.push(content.slice(last))

  return (
    <pre className="chat-text">
      {nodes}
      {streaming ? <span className="chat-cursor" /> : null}
    </pre>
  )
}
