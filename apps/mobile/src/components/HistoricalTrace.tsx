import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { getTrace, type TraceDetail } from '../api'
import { TraceFooter, TracePanels } from './TracePanels'

/** 模块级缓存：同一 traceId 的历史 trace 只拉一次 */
const traceCache = new Map<string, TraceDetail>()

/** 历史消息的思考过程回看：展开时按 traceId 懒加载 */
export default function HistoricalTrace({ traceId }: { traceId: string }) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<TraceDetail | null>(traceCache.get(traceId) ?? null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  async function load() {
    if (loading || detail) return
    const cached = traceCache.get(traceId)
    if (cached) {
      setDetail(cached)
      return
    }
    setLoading(true)
    setFailed(false)
    try {
      const d = await getTrace(traceId)
      traceCache.set(traceId, d)
      setDetail(d)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) void load()
  }

  const hasData = !!detail && ((detail.tools?.length || 0) > 0 || (detail.recalls?.length || 0) > 0)

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.head} onPress={toggle} hitSlop={6}>
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={13} color="#4d86ff" />
        <Text style={styles.headText}>查看思考过程</Text>
      </Pressable>
      {open ? (
        <View style={styles.body}>
          {loading ? (
            <View style={styles.row}>
              <ActivityIndicator size="small" color="#4d86ff" />
              <Text style={styles.tip}>加载中…</Text>
            </View>
          ) : failed ? (
            <Pressable onPress={() => void load()} hitSlop={6}>
              <Text style={styles.retry}>加载失败，点击重试</Text>
            </Pressable>
          ) : detail ? (
            <>
              {hasData ? (
                <TracePanels tools={detail.tools} recalls={detail.recalls} />
              ) : (
                <Text style={styles.tip}>该轮未触发工具调用或知识召回</Text>
              )}
              <TraceFooter usage={detail.usage} traceId={detail.traceId} />
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginTop: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headText: { fontSize: 12, color: '#4d86ff', fontWeight: '600' },
  body: { marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tip: { fontSize: 12, color: '#8590a6' },
  retry: { fontSize: 12, color: '#e5484d' },
})
