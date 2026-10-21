import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import Ionicons from '@expo/vector-icons/Ionicons'
import { getUsageSummary, type UsageSummary } from '../api'
import type { RootStackParamList } from '../types/navigation'
import { formatDateParam, moneyFmt, numberFmt } from '../utils/format'

const RANGES = [
  { days: 7, label: '近 7 天' },
  { days: 30, label: '近 30 天' },
  { days: 90, label: '近 90 天' },
]

/** 用量统计：范围预设 + 统计卡 + 按模型 / 按会话（Top 50） */
export default function UsageScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [days, setDays] = useState(30)
  const [data, setData] = useState<UsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorTip, setErrorTip] = useState('')

  useEffect(() => {
    void load(days)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days])

  async function load(d: number) {
    setLoading(true)
    setErrorTip('')
    const to = new Date()
    const from = new Date()
    from.setDate(from.getDate() - (d - 1))
    try {
      setData(await getUsageSummary(formatDateParam(from), formatDateParam(to)))
    } catch (err: any) {
      setErrorTip(err?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const totals = data?.totals
  const cards = [
    { label: '对话轮次', value: numberFmt(totals?.turns) },
    { label: '输入 tokens', value: numberFmt(totals?.inputTokens) },
    { label: '输出 tokens', value: numberFmt(totals?.outputTokens) },
    { label: '总费用', value: moneyFmt(totals?.costYuan) },
  ]
  const byModel = data?.byModel || []
  const byConversation = data?.byConversation || []
  const isEmpty = !loading && byModel.length === 0 && byConversation.length === 0

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.headerBack} onPress={() => navigation.goBack()} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color="#4d86ff" />
        </Pressable>
        <Text style={styles.headerTitle}>用量统计</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.rangeRow}>
          {RANGES.map((r) => (
            <Pressable
              key={r.days}
              style={[styles.rangeBtn, days === r.days && styles.rangeBtnActive]}
              onPress={() => setDays(r.days)}
            >
              <Text style={[styles.rangeText, days === r.days && styles.rangeTextActive]}>{r.label}</Text>
            </Pressable>
          ))}
        </View>

        {errorTip ? <Text style={styles.errorTip}>{errorTip}</Text> : null}

        <View style={styles.cardGrid}>
          {cards.map((c) => (
            <View key={c.label} style={styles.statCard}>
              <Text style={styles.statLabel}>{c.label}</Text>
              <Text style={styles.statValue}>{c.value}</Text>
            </View>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator color="#4d86ff" style={{ marginTop: 32 }} />
        ) : isEmpty ? (
          <Text style={styles.empty}>所选范围内暂无用量记录</Text>
        ) : (
          <>
            <Text style={styles.sectionTitle}>按模型</Text>
            <View style={styles.table}>
              <View style={[styles.tr, styles.trHead]}>
                <Text style={[styles.th, styles.colModel]}>模型</Text>
                <Text style={[styles.th, styles.colNum]}>轮次</Text>
                <Text style={[styles.th, styles.colNum]}>输入</Text>
                <Text style={[styles.th, styles.colNum]}>输出</Text>
                <Text style={[styles.th, styles.colNum]}>费用</Text>
              </View>
              {byModel.map((m) => (
                <View key={m.model || 'unknown'} style={styles.tr}>
                  <Text style={[styles.td, styles.colModel]} numberOfLines={1}>
                    {m.model || '未知'}
                  </Text>
                  <Text style={[styles.td, styles.colNum]}>{numberFmt(m.turns)}</Text>
                  <Text style={[styles.td, styles.colNum]}>{numberFmt(m.inputTokens)}</Text>
                  <Text style={[styles.td, styles.colNum]}>{numberFmt(m.outputTokens)}</Text>
                  <Text style={[styles.td, styles.colNum]}>{moneyFmt(m.costYuan)}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.sectionTitle}>按会话（Top 50）</Text>
            <View style={styles.table}>
              <View style={[styles.tr, styles.trHead]}>
                <Text style={[styles.th, styles.colConv]}>会话</Text>
                <Text style={[styles.th, styles.colNum]}>轮次</Text>
                <Text style={[styles.th, styles.colNum]}>tokens</Text>
                <Text style={[styles.th, styles.colNum]}>费用</Text>
              </View>
              {byConversation.map((c) => (
                <View key={c.conversationId} style={styles.tr}>
                  <Text style={[styles.td, styles.colConv]} numberOfLines={1}>
                    {c.title || (c.conversationId === 0 ? '默认会话' : `会话 ${c.conversationId}`)}
                  </Text>
                  <Text style={[styles.td, styles.colNum]}>{numberFmt(c.turns)}</Text>
                  <Text style={[styles.td, styles.colNum]}>{numberFmt(c.totalTokens)}</Text>
                  <Text style={[styles.td, styles.colNum]}>{moneyFmt(c.costYuan)}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f6f9ff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e4ebf7',
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#1d2738' },
  headerBack: { position: 'absolute', left: 8 },
  content: { padding: 16, paddingBottom: 40 },
  rangeRow: { flexDirection: 'row', gap: 10 },
  rangeBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e4ebf7',
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  rangeBtnActive: { backgroundColor: '#eef4ff', borderColor: '#4d86ff' },
  rangeText: { fontSize: 13, color: '#5f6c84', fontWeight: '600' },
  rangeTextActive: { color: '#4d86ff' },
  errorTip: { color: '#e5484d', fontSize: 13, marginTop: 12 },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  statCard: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e4ebf7',
    padding: 14,
  },
  statLabel: { fontSize: 12, color: '#8590a6' },
  statValue: { fontSize: 18, fontWeight: '700', color: '#1d2738', marginTop: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1d2738', marginTop: 22, marginBottom: 10 },
  table: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e4ebf7',
    overflow: 'hidden',
  },
  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eef2fb',
  },
  trHead: { backgroundColor: '#f7f9fe' },
  th: { fontSize: 12, color: '#8590a6', fontWeight: '600' },
  td: { fontSize: 12, color: '#2c384c' },
  colModel: { flex: 2 },
  colConv: { flex: 2 },
  colNum: { flex: 1, textAlign: 'right' },
  empty: { textAlign: 'center', color: '#8590a6', marginTop: 40, fontSize: 14 },
})
