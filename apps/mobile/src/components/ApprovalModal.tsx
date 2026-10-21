import { useEffect, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { decideApproval, type ApprovalRequestData } from '../api'

interface Props {
  approval: ApprovalRequestData | null
  /** 决策完成（error 非空表示提交失败，交由上层提示） */
  onDone: (error?: string) => void
}

function riskView(level?: string) {
  if (level === 'high') return { text: '高危', color: '#e5484d', bg: '#ffecec' }
  if (level === 'medium') return { text: '中危', color: '#d48806', bg: '#fff7e6' }
  return { text: '低危', color: '#3b6fd4', bg: '#e8efff' }
}

/** 高危工具人工确认弹窗（单弹窗，队列由上层串行处理） */
export default function ApprovalModal({ approval, onDone }: Props) {
  const [deciding, setDeciding] = useState(false)
  const [remember, setRemember] = useState(false)

  useEffect(() => {
    setRemember(false)
    setDeciding(false)
  }, [approval?.approvalId])

  async function decide(approved: boolean) {
    if (!approval || deciding) return
    setDeciding(true)
    try {
      await decideApproval(approval.approvalId, approved, approved && remember)
      onDone()
    } catch (err: any) {
      onDone(`审批提交失败：${err?.message || '网络错误'}（服务端将按超时自动拒绝）`)
    } finally {
      setDeciding(false)
    }
  }

  const risk = riskView(approval?.riskLevel)

  return (
    <Modal visible={!!approval} transparent animationType="fade" onRequestClose={() => void decide(false)}>
      <View style={styles.mask}>
        <View style={styles.card}>
          <View style={styles.head}>
            <Ionicons name="warning" size={18} color="#d4380d" />
            <Text style={styles.title}>{approval?.title || '高危操作确认'}</Text>
          </View>

          <Text style={styles.desc}>
            AI 助手即将执行外部操作，请核对以下工具与参数；拒绝后该操作不会执行。
          </Text>

          <View style={styles.metaRow}>
            <View style={[styles.riskTag, { backgroundColor: risk.bg }]}>
              <Text style={[styles.riskText, { color: risk.color }]}>{risk.text}</Text>
            </View>
            <Text style={styles.tool} numberOfLines={1}>
              {approval?.tool}
            </Text>
          </View>

          <ScrollView style={styles.argsBox}>
            <Text style={styles.args}>{approval?.argsPreview || '（无参数）'}</Text>
          </ScrollView>

          <Pressable style={styles.rememberRow} onPress={() => setRemember((v) => !v)}>
            <Ionicons
              name={remember ? 'checkbox' : 'square-outline'}
              size={18}
              color={remember ? '#4d86ff' : '#b6c0d2'}
            />
            <Text style={styles.rememberText}>本次会话始终允许此工具（同一会话后续调用不再询问）</Text>
          </Pressable>

          <View style={styles.actions}>
            <Pressable style={styles.btnReject} onPress={() => void decide(false)} disabled={deciding}>
              <Text style={styles.btnRejectText}>拒绝</Text>
            </Pressable>
            <Pressable
              style={[styles.btnAllow, risk.color === '#e5484d' && styles.btnAllowDanger]}
              onPress={() => void decide(true)}
              disabled={deciding}
            >
              {deciding ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.btnAllowText}>允许执行</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  mask: {
    flex: 1,
    backgroundColor: 'rgba(23,43,92,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: { width: '100%', maxWidth: 480, backgroundColor: '#fff', borderRadius: 18, padding: 18, maxHeight: '82%' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  title: { flex: 1, fontSize: 16, fontWeight: '700', color: '#1d2738' },
  desc: { fontSize: 13, color: '#5f6c84', lineHeight: 19, marginBottom: 12 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  riskTag: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  riskText: { fontSize: 12, fontWeight: '700' },
  tool: { fontSize: 13, color: '#2c384c', flexShrink: 1 },
  argsBox: {
    maxHeight: 200,
    backgroundColor: '#f6f9ff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e4ebf7',
    padding: 10,
  },
  args: { fontSize: 12, color: '#2c384c', lineHeight: 18 },
  rememberRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12 },
  rememberText: { flex: 1, fontSize: 13, color: '#5f6c84', lineHeight: 19 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  btnReject: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: '#eef2fb' },
  btnRejectText: { fontSize: 14, color: '#5f6c84', fontWeight: '600' },
  btnAllow: {
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#4d86ff',
  },
  btnAllowDanger: { backgroundColor: '#e5484d' },
  btnAllowText: { fontSize: 14, color: '#fff', fontWeight: '700' },
})
