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
import Ionicons from '@expo/vector-icons/Ionicons'
import {
  getFeedbackReasons,
  submitFeedback,
  type FeedbackInfo,
  type FeedbackReason,
} from '../api'

/** 点踩原因字典：模块级单例 Promise，失败退化为空（不阻断反馈） */
let reasonsPromise: Promise<FeedbackReason[]> | null = null
function loadReasons(): Promise<FeedbackReason[]> {
  if (!reasonsPromise) reasonsPromise = getFeedbackReasons().catch(() => [] as FeedbackReason[])
  return reasonsPromise
}

interface Props {
  traceId: string
  initial?: FeedbackInfo | null
  onChange?: (fb: FeedbackInfo | null) => void
}

/** 回答反馈条：赞即时、踩弹原因、再点取消、赞踩互斥 */
export default function FeedbackBar({ traceId, initial, onChange }: Props) {
  const [rating, setRating] = useState<number>(initial?.rating ?? 0)
  const [reasonCode, setReasonCode] = useState<string>(initial?.reasonCode ?? '')
  const [comment, setComment] = useState<string>(initial?.comment ?? '')
  const [popOpen, setPopOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [reasons, setReasons] = useState<FeedbackReason[]>([])

  // 切换消息 / 初始态变化时同步
  useEffect(() => {
    setRating(initial?.rating ?? 0)
    setReasonCode(initial?.reasonCode ?? '')
    setComment(initial?.comment ?? '')
  }, [traceId, initial])

  useEffect(() => {
    void loadReasons().then(setReasons)
  }, [])

  async function post(next: number, reason?: string, note?: string) {
    if (submitting) return
    const prevRating = rating
    setSubmitting(true)
    setRating(next) // 乐观更新
    try {
      const res = await submitFeedback(traceId, next, reason, note)
      setRating(res.rating)
      if (res.rating === 0) {
        setReasonCode('')
        setComment('')
        onChange?.(null)
      } else {
        onChange?.({ rating: res.rating, reasonCode: reason ?? null, comment: note ?? null })
      }
    } catch {
      setRating(prevRating) // 失败回滚
    } finally {
      setSubmitting(false)
    }
  }

  function handleLike() {
    void post(rating === 1 ? 0 : 1)
  }

  function handleDislike() {
    if (rating === -1) {
      void post(0)
      return
    }
    setReasonCode('')
    setComment('')
    setPopOpen(true)
  }

  function submitDown() {
    setPopOpen(false)
    void post(-1, reasonCode || undefined, comment.trim() || undefined)
  }

  return (
    <View style={styles.bar}>
      <Pressable onPress={handleLike} hitSlop={8} style={styles.btn}>
        <Ionicons
          name={rating === 1 ? 'thumbs-up' : 'thumbs-up-outline'}
          size={16}
          color={rating === 1 ? '#4d86ff' : '#8590a6'}
        />
      </Pressable>
      <Pressable onPress={handleDislike} hitSlop={8} style={styles.btn}>
        <Ionicons
          name={rating === -1 ? 'thumbs-down' : 'thumbs-down-outline'}
          size={16}
          color={rating === -1 ? '#e5484d' : '#8590a6'}
        />
      </Pressable>
      {submitting ? <ActivityIndicator size="small" color="#8590a6" /> : null}

      <Modal visible={popOpen} transparent animationType="fade" onRequestClose={() => setPopOpen(false)}>
        <View style={styles.mask}>
          <View style={styles.card}>
            <Text style={styles.title}>这条回答哪里不满意？</Text>
            <ScrollView style={styles.reasonList} keyboardShouldPersistTaps="handled">
              {reasons.length === 0 ? (
                <Text style={styles.empty}>暂无可选原因</Text>
              ) : (
                reasons.map((r) => {
                  const active = reasonCode === r.code
                  return (
                    <Pressable
                      key={r.code}
                      style={[styles.reasonRow, active && styles.reasonRowActive]}
                      onPress={() => setReasonCode(active ? '' : r.code)}
                    >
                      <Ionicons
                        name={active ? 'radio-button-on' : 'radio-button-off'}
                        size={16}
                        color={active ? '#4d86ff' : '#b6c0d2'}
                      />
                      <Text style={[styles.reasonText, active && styles.reasonTextActive]}>{r.label}</Text>
                    </Pressable>
                  )
                })
              )}
            </ScrollView>
            <TextInput
              style={styles.comment}
              value={comment}
              onChangeText={setComment}
              placeholder="补充说明（选填）"
              placeholderTextColor="#aab3c5"
              multiline
            />
            <View style={styles.actions}>
              <Pressable style={styles.btnGhost} onPress={() => setPopOpen(false)}>
                <Text style={styles.btnGhostText}>取消</Text>
              </Pressable>
              <Pressable style={styles.btnPrimary} onPress={submitDown}>
                <Text style={styles.btnPrimaryText}>提交</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8 },
  btn: { padding: 2 },
  mask: {
    flex: 1,
    backgroundColor: 'rgba(23,43,92,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 18, padding: 18, maxHeight: '80%' },
  title: { fontSize: 15, fontWeight: '700', color: '#1d2738', marginBottom: 10 },
  reasonList: { flexGrow: 0, maxHeight: 260 },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 10,
  },
  reasonRowActive: { backgroundColor: '#eef4ff' },
  reasonText: { fontSize: 14, color: '#2c384c' },
  reasonTextActive: { color: '#4d86ff', fontWeight: '600' },
  empty: { fontSize: 13, color: '#8590a6', paddingVertical: 12, textAlign: 'center' },
  comment: {
    marginTop: 10,
    backgroundColor: '#f6f9ff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e4ebf7',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#2c384c',
    minHeight: 60,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  btnGhost: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 10, backgroundColor: '#eef2fb' },
  btnGhostText: { fontSize: 14, color: '#5f6c84' },
  btnPrimary: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 10, backgroundColor: '#4d86ff' },
  btnPrimaryText: { fontSize: 14, color: '#fff', fontWeight: '600' },
})
