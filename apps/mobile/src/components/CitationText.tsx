import { Fragment, type ReactNode } from 'react'
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native'

const REF_RE = /\[(\d{1,2})\]/g

interface Props {
  content: string
  streaming?: boolean
  /** 文档片段总数（历史对话片段不参与编号）：超出范围的 [n] 原样输出 */
  docSegmentCount: number
  onCite?: (n: number) => void
  style?: StyleProp<TextStyle>
}

/** 把回答里的 [n] 渲染为可点引用 chip（仅当 n 落在文档片段范围内） */
export default function CitationText({ content, streaming, docSegmentCount, onCite, style }: Props) {
  const nodes: ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  REF_RE.lastIndex = 0

  while ((m = REF_RE.exec(content)) !== null) {
    const start = m.index
    if (start > last) {
      nodes.push(<Fragment key={`t${key++}`}>{content.slice(last, start)}</Fragment>)
    }
    const n = Number(m[1])
    if (n >= 1 && n <= docSegmentCount) {
      nodes.push(
        <Text key={`c${key++}`} style={styles.chip} onPress={() => onCite?.(n)}>
          [{n}]
        </Text>,
      )
    } else {
      nodes.push(<Fragment key={`r${key++}`}>{m[0]}</Fragment>)
    }
    last = start + m[0].length
  }
  if (last < content.length) {
    nodes.push(<Fragment key={`t${key++}`}>{content.slice(last)}</Fragment>)
  }

  return (
    <Text style={[styles.text, style]}>
      {nodes}
      {streaming ? <Text style={styles.cursor}>▍</Text> : null}
    </Text>
  )
}

const styles = StyleSheet.create({
  text: { fontSize: 15, lineHeight: 23, color: '#2c384c' },
  chip: { color: '#4d86ff', fontWeight: '700' },
  cursor: { color: '#4d86ff' },
})
