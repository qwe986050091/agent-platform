import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import Ionicons from '@expo/vector-icons/Ionicons'
import type { RagSegment, RagTrace, ToolTrace, UsageTrace } from '../api'
import { moneyFmt } from '../utils/format'

export interface CiteSignal {
  n: number
  ts: number
}

interface PanelProps {
  tools?: ToolTrace[]
  recalls?: RagTrace[]
  citeSignal?: CiteSignal | null
}

interface SegRow {
  seg: RagSegment
  /** 文档片段序号（历史对话片段为 null，不编号） */
  docNo: number | null
}

/** 工具参数紧凑展示：k=v, k2=v2（最长 48 字） */
function compactArgs(raw?: string): string {
  if (!raw) return ''
  let s = raw
  try {
    const obj = JSON.parse(raw)
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      s = Object.entries(obj)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(', ')
    }
  } catch {
    // 非 JSON 原样展示
  }
  return s.length > 48 ? s.slice(0, 48) + '…' : s
}

/** 展平召回片段并给文档片段编号（与 CitationText 的 [n] 对齐） */
function flattenSegments(recalls?: RagTrace[]): SegRow[] {
  const rows: SegRow[] = []
  let docNo = 0
  for (const r of recalls || []) {
    for (const seg of r.segments || []) {
      if (seg.type === 'conversation') rows.push({ seg, docNo: null })
      else rows.push({ seg, docNo: ++docNo })
    }
  }
  return rows
}

function Section({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string
  count: number
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <View style={styles.section}>
      <Pressable style={styles.sectionHead} onPress={onToggle}>
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={13} color="#5f6c84" />
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionCount}>{count}</Text>
      </Pressable>
      {open ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  )
}

/** 思考过程面板：知识召回 + 工具调用（移动端默认折叠，引用点击可展开并高亮） */
export function TracePanels({ tools, recalls, citeSignal }: PanelProps) {
  const [openRag, setOpenRag] = useState(false)
  const [openTool, setOpenTool] = useState(false)
  const [flashNo, setFlashNo] = useState<number | null>(null)

  // 引用 [n] 点击：展开知识召回并高亮对应片段
  useEffect(() => {
    if (!citeSignal) return
    setOpenRag(true)
    setFlashNo(citeSignal.n)
    const t = setTimeout(() => setFlashNo(null), 1800)
    return () => clearTimeout(t)
  }, [citeSignal])

  const toolList = tools || []
  const rows = flattenSegments(recalls)
  if (toolList.length === 0 && rows.length === 0) return null

  return (
    <View style={styles.wrap}>
      {rows.length > 0 ? (
        <Section title="知识召回" count={rows.length} open={openRag} onToggle={() => setOpenRag((v) => !v)}>
          {rows.map((row, i) => {
            const seg = row.seg
            const isConv = seg.type === 'conversation'
            const channel = seg.channel
            return (
              <View
                key={i}
                style={[styles.seg, row.docNo != null && row.docNo === flashNo && styles.segFlash]}
              >
                <View style={styles.segHead}>
                  {row.docNo != null ? <Text style={styles.docNo}>[{row.docNo}]</Text> : null}
                  <Text style={styles.segSource} numberOfLines={1}>
                    {isConv ? '历史对话' : seg.source || '未知来源'}
                  </Text>
                  {channel && channel !== 'vector' ? (
                    <View style={[styles.chanTag, channel === 'keyword' ? styles.chanKeyword : styles.chanBoth]}>
                      <Text style={styles.chanText}>{channel === 'keyword' ? '关键词命中' : '语义+关键词'}</Text>
                    </View>
                  ) : null}
                  {seg.rerankScore != null ? (
                    <Text style={styles.meta}>精排 {Number(seg.rerankScore).toFixed(2)}</Text>
                  ) : null}
                  <Text style={styles.meta}>相似度 {Math.round((seg.score || 0) * 100)}%</Text>
                </View>
                <Text style={styles.segText}>{seg.text}</Text>
              </View>
            )
          })}
        </Section>
      ) : null}

      {toolList.length > 0 ? (
        <Section title="工具调用" count={toolList.length} open={openTool} onToggle={() => setOpenTool((v) => !v)}>
          {toolList.map((t, i) => (
            <View key={i} style={styles.toolRow}>
              <View style={styles.toolHead}>
                <Ionicons
                  name={t.success ? 'checkmark-circle' : 'close-circle'}
                  size={14}
                  color={t.success ? '#2fa84f' : '#e5484d'}
                />
                <Text style={styles.toolName} numberOfLines={1}>
                  {t.name}
                </Text>
                <Text style={styles.meta}>{t.durationMs}ms</Text>
              </View>
              {compactArgs(t.arguments) ? (
                <Text style={styles.toolArgs} numberOfLines={2}>
                  {compactArgs(t.arguments)}
                </Text>
              ) : null}
              {t.result || t.error ? (
                <Text style={styles.toolResult} numberOfLines={6}>
                  {(t.success ? t.result : t.error) || ''}
                </Text>
              ) : null}
            </View>
          ))}
        </Section>
      ) : null}
    </View>
  )
}

/** 回合用量底栏：输入/输出 token、费用、备用模型/已停止标记、可复制 traceId */
export function TraceFooter({ usage, traceId }: { usage?: UsageTrace; traceId?: string }) {
  if (!usage && !traceId) return null
  const shortId = traceId ? (traceId.length > 13 ? `${traceId.slice(0, 8)}…` : traceId) : ''

  const hasTokens = !!usage && (usage.inputTokens > 0 || usage.outputTokens > 0)
  return (
    <View style={styles.footer}>
      <View style={styles.footerLeft}>
        {hasTokens ? (
          <Text style={styles.footerText}>
            输入 {usage!.inputTokens} · 输出 {usage!.outputTokens}
          </Text>
        ) : null}
        {usage?.fallback ? <Text style={styles.footerWarn}>备用模型</Text> : null}
        {usage?.cancelled ? (
          <Text style={styles.footerWarn}>已停止</Text>
        ) : hasTokens || usage?.costYuan != null ? (
          <Text style={styles.footerText}>{moneyFmt(usage?.costYuan)}</Text>
        ) : null}
      </View>
      {traceId ? (
        <Pressable
          hitSlop={8}
          onPress={() => {
            void Clipboard.setStringAsync(traceId)
          }}
        >
          <Text style={styles.footerId}>trace {shortId} · 复制</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  section: {
    backgroundColor: '#f7f9fe',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e7eefb',
    marginBottom: 6,
    overflow: 'hidden',
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 10 },
  sectionTitle: { flex: 1, fontSize: 13, fontWeight: '600', color: '#5f6c84' },
  sectionCount: { fontSize: 12, color: '#8590a6' },
  sectionBody: { paddingHorizontal: 10, paddingBottom: 10, gap: 8 },
  seg: { borderLeftWidth: 2, borderLeftColor: '#d7e3fb', paddingLeft: 8 },
  segFlash: { borderLeftColor: '#4d86ff', backgroundColor: '#eaf1ff' },
  segHead: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  docNo: { fontSize: 12, fontWeight: '700', color: '#4d86ff' },
  segSource: { fontSize: 12, color: '#2c384c', fontWeight: '600', maxWidth: '46%' },
  chanTag: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  chanKeyword: { backgroundColor: '#fff2e0' },
  chanBoth: { backgroundColor: '#f0e9ff' },
  chanText: { fontSize: 10, color: '#7a5cff' },
  meta: { fontSize: 11, color: '#8590a6' },
  segText: { fontSize: 12, color: '#5f6c84', lineHeight: 18 },
  toolRow: { borderLeftWidth: 2, borderLeftColor: '#e3eaf7', paddingLeft: 8 },
  toolHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toolName: { flex: 1, fontSize: 12, fontWeight: '600', color: '#2c384c' },
  toolArgs: { fontSize: 11, color: '#8590a6', marginTop: 3 },
  toolResult: {
    fontSize: 11,
    color: '#5f6c84',
    marginTop: 4,
    backgroundColor: '#fff',
    borderRadius: 6,
    padding: 6,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  footerText: { fontSize: 11, color: '#8590a6' },
  footerWarn: { fontSize: 11, color: '#d48806' },
  footerId: { fontSize: 11, color: '#4d86ff' },
})
