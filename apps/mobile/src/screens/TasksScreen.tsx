import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import Ionicons from '@expo/vector-icons/Ionicons'
import {
  createTask,
  deleteTask,
  listTaskRuns,
  listTasks,
  listTools,
  runTaskNow,
  updateTask,
  type ScheduledTask,
  type ScheduledTaskRun,
} from '../api'
import type { RootStackParamList } from '../types/navigation'
import { CRON_PRESETS, describeCron } from '../utils/cron'
import { formatTime } from '../utils/format'
import {
  getNotifPermission,
  presentLocalNotification,
  requestNotifPermission,
  type NotifPermission,
} from '../notifications'

type Nav = NativeStackNavigationProp<RootStackParamList>

function statusView(status?: string) {
  switch (status) {
    case 'success':
      return { text: '成功', color: '#2fa84f', bg: '#e9f7ee' }
    case 'failed':
      return { text: '失败', color: '#e5484d', bg: '#ffecec' }
    case 'running':
      return { text: '执行中', color: '#3b6fd4', bg: '#e8efff' }
    case 'skipped_budget':
      return { text: '预算跳过', color: '#d48806', bg: '#fff7e6' }
    default:
      return { text: '—', color: '#8590a6', bg: '#eef2fb' }
  }
}

/** 定时任务：列表 + 新建/编辑 + 立即执行 + 执行记录 + 通知开关 */
export default function TasksScreen() {
  const navigation = useNavigation<Nav>()

  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [tools, setTools] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  // 新建/编辑表单
  const [formVisible, setFormVisible] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [cronExpr, setCronExpr] = useState(CRON_PRESETS[0].value)
  const [whitelist, setWhitelist] = useState<string[]>([])
  const [enabled, setEnabled] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // 执行记录
  const [runsTarget, setRunsTarget] = useState<ScheduledTask | null>(null)
  const [runs, setRuns] = useState<ScheduledTaskRun[]>([])
  const [runsLoading, setRunsLoading] = useState(false)

  const [notifPerm, setNotifPerm] = useState<NotifPermission>('undetermined')

  useEffect(() => {
    void loadAll()
    void getNotifPermission().then(setNotifPerm)
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [taskList, toolList] = await Promise.all([listTasks(), listTools()])
      setTasks(taskList)
      setTools(toolList)
    } catch (err: any) {
      Alert.alert('加载失败', err?.message || '网络连接失败')
    } finally {
      setLoading(false)
    }
  }

  function openCreate() {
    setEditingId(null)
    setName('')
    setPrompt('')
    setCronExpr(CRON_PRESETS[0].value)
    setWhitelist([])
    setEnabled(true)
    setFormVisible(true)
  }

  function openEdit(t: ScheduledTask) {
    setEditingId(t.id)
    setName(t.name)
    setPrompt(t.prompt)
    setCronExpr(t.cronExpr)
    setWhitelist(t.toolsWhitelist || [])
    setEnabled(t.enabled)
    setFormVisible(true)
  }

  function toggleWhitelist(tool: string) {
    setWhitelist((prev) => (prev.includes(tool) ? prev.filter((x) => x !== tool) : [...prev, tool]))
  }

  async function submitForm() {
    const n = name.trim()
    const p = prompt.trim()
    const c = cronExpr.trim()
    if (!n) return Alert.alert('提示', '请输入任务名称')
    if (!p) return Alert.alert('提示', '请输入指令内容')
    if (!c) return Alert.alert('提示', '请输入 cron 表达式')
    setSubmitting(true)
    try {
      const payload = { name: n, prompt: p, cronExpr: c, toolsWhitelist: whitelist, enabled }
      if (editingId == null) await createTask(payload)
      else await updateTask(editingId, payload)
      setFormVisible(false)
      await loadAll()
    } catch (err: any) {
      Alert.alert('保存失败', err?.message || '网络连接失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleEnabled(t: ScheduledTask) {
    try {
      await updateTask(t.id, { enabled: !t.enabled })
      await loadAll()
    } catch (err: any) {
      Alert.alert('操作失败', err?.message || '网络连接失败')
    }
  }

  function confirmDelete(t: ScheduledTask) {
    Alert.alert('删除任务', `确定删除定时任务「${t.name}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTask(t.id)
            await loadAll()
          } catch (err: any) {
            Alert.alert('删除失败', err?.message || '网络连接失败')
          }
        },
      },
    ])
  }

  async function handleRunNow(t: ScheduledTask) {
    try {
      const res = await runTaskNow(t.id)
      Alert.alert('已开始执行', res.message || '任务将在后台运行，稍后可查看执行记录')
      setTimeout(() => void loadAll(), 3000)
    } catch (err: any) {
      Alert.alert('执行失败', err?.message || '网络连接失败')
    }
  }

  async function openRuns(t: ScheduledTask) {
    setRunsTarget(t)
    setRuns([])
    setRunsLoading(true)
    try {
      setRuns(await listTaskRuns(t.id))
    } catch (err: any) {
      Alert.alert('加载失败', err?.message || '网络连接失败')
    } finally {
      setRunsLoading(false)
    }
  }

  async function toggleNotify() {
    if (notifPerm === 'unsupported') {
      Alert.alert(
        '当前环境不支持系统通知',
        'Expo Go 已移除推送能力（SDK 53+），请用 development build 运行 App；此时任务结果仍会在应用内弹出提示条。',
      )
      return
    }
    if (notifPerm === 'granted') {
      Alert.alert('通知已开启', '如需关闭，请在系统设置中管理通知权限')
      return
    }
    const p = await requestNotifPermission()
    setNotifPerm(p)
    if (p === 'granted') {
      Alert.alert('已开启通知', '定时任务完成后会向你发送通知')
      void presentLocalNotification('通知已开启', '定时任务完成后将在此提醒你')
    } else if (p === 'unsupported') {
      Alert.alert('当前环境不支持系统通知', '请使用 development build 运行 App')
    } else {
      Alert.alert('未开启通知', '可在系统设置中允许通知后重试')
    }
  }

  function testNotify() {
    if (notifPerm !== 'granted') {
      void toggleNotify()
      return
    }
    void presentLocalNotification('测试通知', '这是一条来自 Agent AI 的测试通知')
    Alert.alert('已发送', '请查看系统通知栏')
  }

  const notifLabel =
    notifPerm === 'granted'
      ? '已开启'
      : notifPerm === 'denied'
        ? '已拒绝'
        : notifPerm === 'unsupported'
          ? '当前环境不支持（Expo Go）'
          : '未开启'
  const notifColor =
    notifPerm === 'granted' ? '#2fa84f' : notifPerm === 'denied' ? '#e5484d' : '#8590a6'

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.headerBack} onPress={() => navigation.goBack()} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color="#4d86ff" />
        </Pressable>
        <Text style={styles.headerTitle}>定时任务</Text>
        <Pressable style={styles.headerAdd} onPress={openCreate} hitSlop={10}>
          <Text style={styles.headerAddText}>＋ 新建</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* 通知设置 */}
        <View style={styles.notifCard}>
          <View style={styles.notifMain}>
            <Ionicons name="notifications-outline" size={18} color="#4d86ff" />
            <View style={styles.notifTextWrap}>
              <Text style={styles.notifTitle}>任务结果通知</Text>
              <Text style={[styles.notifStatus, { color: notifColor }]}>
                系统通知：{notifLabel}
              </Text>
            </View>
          </View>
          <View style={styles.notifActions}>
            <Pressable style={styles.notifBtn} onPress={toggleNotify}>
              <Text style={styles.notifBtnText}>{notifPerm === 'granted' ? '已开启' : '开启'}</Text>
            </Pressable>
            <Pressable style={[styles.notifBtn, styles.notifBtnGhost]} onPress={testNotify}>
              <Text style={styles.notifBtnGhostText}>测试</Text>
            </Pressable>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator color="#4d86ff" style={{ marginTop: 32 }} />
        ) : tasks.length === 0 ? (
          <Text style={styles.empty}>还没有定时任务，点击右上角新建</Text>
        ) : (
          tasks.map((t) => {
            const sv = statusView(t.lastRun?.status)
            return (
              <View key={t.id} style={styles.taskCard}>
                <View style={styles.taskHead}>
                  <Text style={styles.taskName} numberOfLines={1}>
                    {t.name}
                  </Text>
                  <Switch
                    value={t.enabled}
                    onValueChange={() => void toggleEnabled(t)}
                    trackColor={{ true: '#4d86ff', false: '#cfd8e8' }}
                  />
                </View>
                <Text style={styles.taskPrompt} numberOfLines={2}>
                  {t.prompt}
                </Text>

                <View style={styles.metaRow}>
                  <Ionicons name="time-outline" size={13} color="#8590a6" />
                  <Text style={styles.metaText}>{describeCron(t.cronExpr)}</Text>
                  <Text style={styles.metaCron}>({t.cronExpr})</Text>
                </View>
                <View style={styles.metaRow}>
                  <Ionicons name="play-forward-outline" size={13} color="#8590a6" />
                  <Text style={styles.metaText}>
                    下次：{t.enabled ? formatTime(t.nextRunAt) : '已停用'}
                  </Text>
                </View>
                <View style={styles.metaRow}>
                  <Ionicons name="pulse-outline" size={13} color="#8590a6" />
                  <Text style={styles.metaText}>上次：</Text>
                  <View style={[styles.statusTag, { backgroundColor: sv.bg }]}>
                    <Text style={[styles.statusTagText, { color: sv.color }]}>{sv.text}</Text>
                  </View>
                  <Text style={styles.metaText}>
                    {t.lastRun?.finishedAt ? formatTime(t.lastRun.finishedAt) : '尚未执行'}
                  </Text>
                </View>
                {t.lastRun?.errorMessage ? (
                  <Text style={styles.taskError} numberOfLines={2}>
                    错误：{t.lastRun.errorMessage}
                  </Text>
                ) : null}

                <View style={styles.taskActions}>
                  <Pressable style={styles.actBtn} onPress={() => void handleRunNow(t)}>
                    <Text style={styles.actBtnText}>立即执行</Text>
                  </Pressable>
                  <Pressable style={styles.actBtn} onPress={() => openEdit(t)}>
                    <Text style={styles.actBtnText}>编辑</Text>
                  </Pressable>
                  <Pressable style={styles.actBtn} onPress={() => void openRuns(t)}>
                    <Text style={styles.actBtnText}>记录</Text>
                  </Pressable>
                  <Pressable style={[styles.actBtn, styles.actBtnDanger]} onPress={() => confirmDelete(t)}>
                    <Text style={styles.actBtnDangerText}>删除</Text>
                  </Pressable>
                </View>
              </View>
            )
          })
        )}
      </ScrollView>

      {/* 新建/编辑 */}
      <Modal visible={formVisible} transparent animationType="slide" onRequestClose={() => setFormVisible(false)}>
        <View style={styles.mask}>
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>{editingId == null ? '新建定时任务' : '编辑定时任务'}</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>任务名称</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="如 每日早报"
                placeholderTextColor="#aab3c5"
                maxLength={100}
              />
              <Text style={styles.label}>指令内容</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={prompt}
                onChangeText={setPrompt}
                placeholder="执行时系统会自动在指令前注入当前时间"
                placeholderTextColor="#aab3c5"
                multiline
                textAlignVertical="top"
                maxLength={4000}
              />
              <Text style={styles.label}>执行计划（cron）</Text>
              <View style={styles.presetRow}>
                {CRON_PRESETS.map((p) => (
                  <Pressable
                    key={p.value}
                    style={[styles.presetChip, cronExpr === p.value && styles.presetChipActive]}
                    onPress={() => setCronExpr(p.value)}
                  >
                    <Text style={[styles.presetText, cronExpr === p.value && styles.presetTextActive]}>
                      {p.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                style={styles.input}
                value={cronExpr}
                onChangeText={setCronExpr}
                placeholder="0 0 8 * * *"
                placeholderTextColor="#aab3c5"
                autoCapitalize="none"
              />
              <Text style={styles.hint}>Spring 6 段：秒 分 时 日 月 周（当前：{describeCron(cronExpr)}）</Text>

              <Text style={styles.label}>预授权工具（勾选=该任务自动放行，不弹确认）</Text>
              {tools.length === 0 ? (
                <Text style={styles.hint}>暂无可选工具</Text>
              ) : (
                <View style={styles.toolsWrap}>
                  {tools.map((tool) => {
                    const active = whitelist.includes(tool)
                    return (
                      <Pressable
                        key={tool}
                        style={[styles.toolChip, active && styles.toolChipActive]}
                        onPress={() => toggleWhitelist(tool)}
                      >
                        <Text style={[styles.toolChipText, active && styles.toolChipTextActive]}>{tool}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              )}

              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>启用任务</Text>
                <Switch
                  value={enabled}
                  onValueChange={setEnabled}
                  trackColor={{ true: '#4d86ff', false: '#cfd8e8' }}
                />
              </View>
            </ScrollView>

            <View style={styles.formActions}>
              <Pressable style={styles.formBtnGhost} onPress={() => setFormVisible(false)}>
                <Text style={styles.formBtnGhostText}>取消</Text>
              </Pressable>
              <Pressable style={styles.formBtnPrimary} onPress={() => void submitForm()} disabled={submitting}>
                <Text style={styles.formBtnPrimaryText}>{submitting ? '保存中…' : '保存'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 执行记录 */}
      <Modal
        visible={!!runsTarget}
        transparent
        animationType="slide"
        onRequestClose={() => setRunsTarget(null)}
      >
        <View style={styles.mask}>
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>执行记录 · {runsTarget?.name}</Text>
            {runsLoading ? (
              <ActivityIndicator color="#4d86ff" style={{ marginVertical: 24 }} />
            ) : runs.length === 0 ? (
              <Text style={styles.empty}>暂无执行记录</Text>
            ) : (
              <ScrollView style={{ maxHeight: 380 }}>
                {runs.map((r) => {
                  const sv = statusView(r.status)
                  return (
                    <View key={r.id} style={styles.runRow}>
                      <View style={styles.runHead}>
                        <View style={[styles.statusTag, { backgroundColor: sv.bg }]}>
                          <Text style={[styles.statusTagText, { color: sv.color }]}>{sv.text}</Text>
                        </View>
                        <Text style={styles.runTime}>{formatTime(r.startedAt)}</Text>
                        <Text style={styles.runDuration}>
                          {r.durationMs != null ? `${r.durationMs} ms` : '—'}
                        </Text>
                      </View>
                      {r.errorMessage ? (
                        <Text style={styles.runError} numberOfLines={3}>
                          {r.errorMessage}
                        </Text>
                      ) : null}
                    </View>
                  )
                })}
              </ScrollView>
            )}

            <View style={styles.formActions}>
              <Pressable
                style={styles.formBtnGhost}
                disabled={!runsTarget?.conversationId}
                onPress={() => {
                  const conv = runsTarget?.conversationId
                  setRunsTarget(null)
                  if (conv != null) navigation.navigate('Main', { screen: 'Chat', params: { conversationId: conv } })
                }}
              >
                <Text style={[styles.formBtnGhostText, !runsTarget?.conversationId && styles.disabledText]}>
                  查看会话
                </Text>
              </Pressable>
              <Pressable style={styles.formBtnPrimary} onPress={() => setRunsTarget(null)}>
                <Text style={styles.formBtnPrimaryText}>关闭</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  headerAdd: { position: 'absolute', right: 16 },
  headerAddText: { fontSize: 14, color: '#4d86ff', fontWeight: '600' },
  content: { padding: 16, paddingBottom: 40 },
  notifCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e4ebf7',
    padding: 14,
    marginBottom: 12,
  },
  notifMain: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  notifTextWrap: { flex: 1 },
  notifTitle: { fontSize: 14, fontWeight: '600', color: '#1d2738' },
  notifStatus: { fontSize: 12, marginTop: 3 },
  notifActions: { flexDirection: 'row', gap: 8 },
  notifBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#4d86ff' },
  notifBtnText: { fontSize: 12, color: '#fff', fontWeight: '600' },
  notifBtnGhost: { backgroundColor: '#eef2fb' },
  notifBtnGhostText: { fontSize: 12, color: '#5f6c84', fontWeight: '600' },
  empty: { textAlign: 'center', color: '#8590a6', marginTop: 40, fontSize: 14 },
  taskCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e4ebf7',
    padding: 14,
    marginBottom: 10,
  },
  taskHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  taskName: { flex: 1, fontSize: 15, fontWeight: '700', color: '#1d2738' },
  taskPrompt: { fontSize: 13, color: '#5f6c84', marginTop: 8, lineHeight: 19 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  metaText: { fontSize: 12, color: '#5f6c84' },
  metaCron: { fontSize: 11, color: '#aab3c5' },
  statusTag: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  statusTagText: { fontSize: 11, fontWeight: '700' },
  taskError: { fontSize: 12, color: '#e5484d', marginTop: 8 },
  taskActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 9,
    backgroundColor: '#eef2fb',
  },
  actBtnText: { fontSize: 12, color: '#3b6fd4', fontWeight: '600' },
  actBtnDanger: { backgroundColor: '#ffeded' },
  actBtnDangerText: { fontSize: 12, color: '#e5484d', fontWeight: '600' },
  mask: {
    flex: 1,
    backgroundColor: 'rgba(23,43,92,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  formCard: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    maxHeight: '86%',
  },
  formTitle: { fontSize: 16, fontWeight: '700', color: '#1d2738', marginBottom: 6 },
  label: { fontSize: 13, color: '#5f6c84', marginBottom: 6, marginTop: 12 },
  hint: { fontSize: 11, color: '#8590a6', marginTop: 6 },
  input: {
    backgroundColor: '#fafbff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e4ebf7',
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: '#2c384c',
  },
  inputMultiline: { minHeight: 84 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f1f4fb',
  },
  presetChipActive: { backgroundColor: '#4d86ff' },
  presetText: { fontSize: 12, color: '#5f6c84', fontWeight: '600' },
  presetTextActive: { color: '#fff' },
  toolsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  toolChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#eef2fb',
  },
  toolChipActive: { backgroundColor: '#4d86ff' },
  toolChipText: { fontSize: 12, color: '#3b6fd4' },
  toolChipTextActive: { color: '#fff' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  switchLabel: { fontSize: 14, color: '#2c384c', fontWeight: '600' },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  formBtnGhost: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: '#eef2fb' },
  formBtnGhostText: { fontSize: 14, color: '#5f6c84', fontWeight: '600' },
  disabledText: { opacity: 0.4 },
  formBtnPrimary: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: '#4d86ff' },
  formBtnPrimaryText: { fontSize: 14, color: '#fff', fontWeight: '700' },
  runRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eef2fb',
    paddingVertical: 10,
  },
  runHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  runTime: { flex: 1, fontSize: 12, color: '#5f6c84' },
  runDuration: { fontSize: 12, color: '#8590a6' },
  runError: { fontSize: 12, color: '#e5484d', marginTop: 6 },
})
