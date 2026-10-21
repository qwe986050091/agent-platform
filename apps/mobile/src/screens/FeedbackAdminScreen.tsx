import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import * as Clipboard from 'expo-clipboard'
import Ionicons from '@expo/vector-icons/Ionicons'
import {
  getAdminFeedback,
  getFeedbackReasons,
  getFeedbackStats,
  type AdminFeedbackRow,
  type FeedbackReason,
  type FeedbackStats,
} from '../api'
import type { RootStackParamList } from '../types/navigation'
import { formatDateParam, formatTime, numberFmt } from '../utils/format'

const SIZE = 20
const RANGES = [
  { days: 7, label: '近 7 天' },
  { days: 30, label: '近 30 天' },
  { days: 90, label: '近 90 天' },
]

interface Filters {
  rating?: number
  reason?: string
  keyword?: string
}

/** 管理员反馈后台：统计卡 + 筛选 + 分页列表 + 展开查看问答 */
export default function FeedbackAdminScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [stats, setStats] = useState<FeedbackStats | null>(null)
  const [rows, setRows] = useState<AdminFeedbackRow[]>([])
  const [page, setPage] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const [days, setDays] = useState(30)
  const [filters, setFilters] = useState<Filters>({})
  const [keywordInput, setKeywordInput] = useState('')
  const [reasons, setReasons] = useState<FeedbackReason[]>([])
  const [reasonPickerOpen, setReasonPickerOpen] = useState(false)

  useEffect(() => {
    void getFeedbackReasons().then(setReasons).catch(() => setReasons([]))
  }, [])

  useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filters, days])

  async function loadAll() {
    setLoading(true)
    const to = new Date()
    const from = new Date()
    from.setDate(from.getDate() - (days - 1))
    const fromStr = formatDateParam(from)
    const toStr = formatDateParam(to)
    try {
      const data = await getAdminFeedback({ ...filters, from: fromStr, to: toStr, page, size: SIZE })
      setRows(data.content || [])
      setTotal(data.total || 0)
      setTotalPages(Math.max(1, data.totalPages || 1))
      setForbidden(false)
    } catch (err: any) {
      if (err?.status === 403) setForbidden(true)
      else setRows([])
    } finally {
      setLoading(false)
    }
    try {
      setStats(await getFeedbackStats(fromStr, toStr))
    } catch {
      // 统计 403/失败静默
    }
  }

  function applyKeyword() {
    setPage(0)
    setFilters((f) => ({ ...f, keyword: keywordInput.trim() || undefined }))
  }

  function resetAll() {
    setKeywordInput('')
    setPage(0)
    setFilters({})
  }

  function setRating(r: number | undefined) {
    setPage(0)
    setFilters((f) => ({ ...f, rating: f.rating === r ? undefined : r }))
  }

  if (forbidden) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable style={styles.headerBack} onPress={() => navigation.goBack()} hitSlop={10}>
            <Ionicons name="chevron-back" size={22} color="#4d86ff" />
          </Pressable>
          <Text style={styles.headerTitle}>反馈管理</Text>
        </View>
        <View style={styles.forbidden}>
          <Ionicons name="lock-closed-outline" size={40} color="#b6c0d2" />
          <Text style={styles.forbiddenText}>无访问权限</Text>
        </View>
      </SafeAreaView>
    )
  }

  const reasonLabel = filters.reason
    ? reasons.find((r) => r.code === filters.reason)?.label || filters.reason
    : '全部原因'

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.headerBack} onPress={() => navigation.goBack()} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color="#4d86ff" />
        </Pressable>
        <Text style={styles.headerTitle}>反馈管理</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* 统计卡 */}
        <View style={styles.cardGrid}>
          <StatCard label="反馈总数" value={numberFmt(stats?.total)} />
          <StatCard label="点赞" value={numberFmt(stats?.up)} tone="#2fa84f" />
          <StatCard label="点踩" value={numberFmt(stats?.down)} tone="#e5484d" />
        </View>
        <View style={styles.reasonCard}>
          <Text style={styles.reasonTitle}>点踩原因分布</Text>
          <View style={styles.reasonTags}>
            {(stats?.byReason || []).length === 0 ? (
              <Text style={styles.muted}>暂无点踩</Text>
            ) : (
              stats!.byReason.map((r) => (
                <View key={r.reasonCode || 'none'} style={styles.reasonTag}>
                  <Text style={styles.reasonTagText}>
                    {r.reasonLabel || '未填原因'}：{r.count}
                  </Text>
                </View>
              ))
            )}
          </View>
        </View>

        {/* 筛选 */}
        <View style={styles.filterCard}>
          <View style={styles.rangeRow}>
            {RANGES.map((r) => (
              <Pressable
                key={r.days}
                style={[styles.rangeBtn, days === r.days && styles.rangeBtnActive]}
                onPress={() => {
                  setPage(0)
                  setDays(r.days)
                }}
              >
                <Text style={[styles.rangeText, days === r.days && styles.rangeTextActive]}>{r.label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.chipRow}>
            <Pressable
              style={[styles.chip, filters.rating === 1 && styles.chipLike]}
              onPress={() => setRating(1)}
            >
              <Text style={[styles.chipText, filters.rating === 1 && styles.chipTextActive]}>点赞</Text>
            </Pressable>
            <Pressable
              style={[styles.chip, filters.rating === -1 && styles.chipDislike]}
              onPress={() => setRating(-1)}
            >
              <Text style={[styles.chipText, filters.rating === -1 && styles.chipTextActive]}>点踩</Text>
            </Pressable>
            <Pressable style={styles.chip} onPress={() => setReasonPickerOpen(true)}>
              <Text style={styles.chipText} numberOfLines={1}>
                {reasonLabel} ▾
              </Text>
            </Pressable>
          </View>

          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              value={keywordInput}
              onChangeText={setKeywordInput}
              placeholder="搜索备注 / 问答内容"
              placeholderTextColor="#aab3c5"
              returnKeyType="search"
              onSubmitEditing={applyKeyword}
            />
            <Pressable style={styles.searchBtn} onPress={applyKeyword}>
              <Text style={styles.searchBtnText}>查询</Text>
            </Pressable>
            <Pressable style={styles.resetBtn} onPress={resetAll}>
              <Text style={styles.resetBtnText}>重置</Text>
            </Pressable>
          </View>
        </View>

        {/* 列表 */}
        {loading ? (
          <ActivityIndicator color="#4d86ff" style={{ marginTop: 28 }} />
        ) : rows.length === 0 ? (
          <Text style={styles.empty}>没有符合条件的反馈</Text>
        ) : (
          rows.map((r) => {
            const open = expandedId === r.id
            return (
              <Pressable
                key={r.id}
                style={styles.fbRow}
                onPress={() => setExpandedId(open ? null : r.id)}
              >
                <View style={styles.fbHead}>
                  <View style={[styles.ratingTag, r.rating === 1 ? styles.ratingUp : styles.ratingDown]}>
                    <Text style={styles.ratingTagText}>{r.rating === 1 ? '赞' : '踩'}</Text>
                  </View>
                  <Text style={styles.fbUser} numberOfLines={1}>
                    {r.userId}
                  </Text>
                  <Text style={styles.fbTime}>{formatTime(r.createdAt)}</Text>
                </View>
                <Text style={styles.fbConv} numberOfLines={1}>
                  {r.conversationTitle || `会话 ${r.conversationId}`}
                </Text>
                {r.rating === -1 ? (
                  <Text style={styles.fbReason} numberOfLines={2}>
                    {r.reasonLabel || '未填原因'}
                    {r.comment ? ` · ${r.comment}` : ''}
                  </Text>
                ) : null}

                {open ? (
                  <View style={styles.expand}>
                    <Text style={styles.expandLabel}>用户提问</Text>
                    <Text style={styles.expandText}>
                      {r.question || '（未取到提问，可能来自历史回合）'}
                    </Text>
                    <Text style={styles.expandLabel}>助手回答</Text>
                    <Text style={styles.expandText}>{r.answer || '（无回答内容）'}</Text>
                    <Pressable
                      onPress={() => {
                        void Clipboard.setStringAsync(r.traceId)
                      }}
                      hitSlop={6}
                    >
                      <Text style={styles.traceId}>trace {r.traceId} · 复制</Text>
                    </Pressable>
                  </View>
                ) : null}
              </Pressable>
            )
          })
        )}

        {/* 分页 */}
        {rows.length > 0 ? (
          <View style={styles.pager}>
            <Pressable
              style={[styles.pageBtn, page <= 0 && styles.pageBtnDisabled]}
              disabled={page <= 0}
              onPress={() => setPage((p) => Math.max(0, p - 1))}
            >
              <Text style={styles.pageBtnText}>上一页</Text>
            </Pressable>
            <Text style={styles.pageInfo}>
              第 {page + 1} / {totalPages} 页 · 共 {total} 条
            </Text>
            <Pressable
              style={[styles.pageBtn, page >= totalPages - 1 && styles.pageBtnDisabled]}
              disabled={page >= totalPages - 1}
              onPress={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              <Text style={styles.pageBtnText}>下一页</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      {/* 点踩原因选择 */}
      <Modal
        visible={reasonPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setReasonPickerOpen(false)}
      >
        <View style={styles.mask}>
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>按点踩原因筛选</Text>
            <ScrollView style={{ maxHeight: 300 }}>
              <Pressable
                style={styles.pickerRow}
                onPress={() => {
                  setPage(0)
                  setFilters((f) => ({ ...f, reason: undefined }))
                  setReasonPickerOpen(false)
                }}
              >
                <Text style={styles.pickerText}>全部原因</Text>
              </Pressable>
              {reasons.map((r) => (
                <Pressable
                  key={r.code}
                  style={styles.pickerRow}
                  onPress={() => {
                    setPage(0)
                    setFilters((f) => ({ ...f, reason: r.code }))
                    setReasonPickerOpen(false)
                  }}
                >
                  <Text style={[styles.pickerText, filters.reason === r.code && styles.pickerTextActive]}>
                    {r.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
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
  forbidden: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  forbiddenText: { fontSize: 15, color: '#8590a6' },
  cardGrid: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e4ebf7',
    padding: 14,
  },
  statLabel: { fontSize: 12, color: '#8590a6' },
  statValue: { fontSize: 18, fontWeight: '700', color: '#1d2738', marginTop: 8 },
  reasonCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e4ebf7',
    padding: 14,
    marginTop: 10,
  },
  reasonTitle: { fontSize: 13, fontWeight: '700', color: '#1d2738', marginBottom: 8 },
  reasonTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reasonTag: { backgroundColor: '#fff2f2', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  reasonTagText: { fontSize: 12, color: '#d4380d' },
  muted: { fontSize: 12, color: '#8590a6' },
  filterCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e4ebf7',
    padding: 14,
    marginTop: 12,
  },
  rangeRow: { flexDirection: 'row', gap: 10 },
  rangeBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e4ebf7',
    alignItems: 'center',
  },
  rangeBtnActive: { backgroundColor: '#eef4ff', borderColor: '#4d86ff' },
  rangeText: { fontSize: 12, color: '#5f6c84', fontWeight: '600' },
  rangeTextActive: { color: '#4d86ff' },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#f1f4fb',
    maxWidth: '50%',
  },
  chipLike: { backgroundColor: '#e9f7ee' },
  chipDislike: { backgroundColor: '#ffecec' },
  chipText: { fontSize: 12, color: '#5f6c84', fontWeight: '600' },
  chipTextActive: { color: '#1d2738' },
  searchRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  searchInput: {
    flex: 1,
    backgroundColor: '#fafbff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e4ebf7',
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: '#2c384c',
  },
  searchBtn: {
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#4d86ff',
  },
  searchBtnText: { fontSize: 13, color: '#fff', fontWeight: '600' },
  resetBtn: {
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#eef2fb',
  },
  resetBtnText: { fontSize: 13, color: '#5f6c84' },
  fbRow: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e4ebf7',
    padding: 14,
    marginTop: 10,
  },
  fbHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ratingTag: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  ratingUp: { backgroundColor: '#e9f7ee' },
  ratingDown: { backgroundColor: '#ffecec' },
  ratingTagText: { fontSize: 11, color: '#1d2738', fontWeight: '700' },
  fbUser: { flex: 1, fontSize: 13, color: '#2c384c' },
  fbTime: { fontSize: 11, color: '#8590a6' },
  fbConv: { fontSize: 12, color: '#5f6c84', marginTop: 8 },
  fbReason: { fontSize: 12, color: '#d4380d', marginTop: 6 },
  expand: { marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#eef2fb', paddingTop: 10 },
  expandLabel: { fontSize: 12, color: '#8590a6', marginBottom: 4, marginTop: 6 },
  expandText: { fontSize: 13, color: '#2c384c', lineHeight: 19 },
  traceId: { fontSize: 12, color: '#4d86ff', marginTop: 10 },
  empty: { textAlign: 'center', color: '#8590a6', marginTop: 32, fontSize: 14 },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  pageBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#eef2fb',
  },
  pageBtnDisabled: { opacity: 0.5 },
  pageBtnText: { fontSize: 13, color: '#5f6c84', fontWeight: '600' },
  pageInfo: { fontSize: 12, color: '#8590a6' },
  mask: {
    flex: 1,
    backgroundColor: 'rgba(23,43,92,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  pickerCard: { width: '100%', maxWidth: 400, backgroundColor: '#fff', borderRadius: 16, padding: 16 },
  pickerTitle: { fontSize: 15, fontWeight: '700', color: '#1d2738', marginBottom: 10 },
  pickerRow: { paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eef2fb' },
  pickerText: { fontSize: 14, color: '#2c384c' },
  pickerTextActive: { color: '#4d86ff', fontWeight: '700' },
})
