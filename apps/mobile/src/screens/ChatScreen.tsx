import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItem,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import Ionicons from '@expo/vector-icons/Ionicons'
import {
  api,
  streamChat,
  listConversations,
  createConversation,
  renameConversation,
  deleteConversation,
  type ApprovalRequestData,
  type ChatAttachment,
  type ChatImageInput,
  type Conversation,
  type FeedbackInfo,
  type RagTrace,
  type Skill,
  type StreamHandle,
  type ToolTrace,
  type UsageTrace,
} from '../api'
import type { MainTabParamList } from '../types/navigation'
import { useAuth } from '../auth'
import { uuidv4 } from '../utils/uuid'
import { TraceFooter, TracePanels, type CiteSignal } from '../components/TracePanels'
import CitationText from '../components/CitationText'
import HistoricalTrace from '../components/HistoricalTrace'
import FeedbackBar from '../components/FeedbackBar'
import ApprovalModal from '../components/ApprovalModal'
import AuthImage from '../components/AuthImage'
import assistantAvatar from '../../assets/assistant-avatar.jpg'

/** 图片限制（需与后端 app.chat.image 配置一致） */
const MAX_IMAGES = 3
const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

interface PendingImage {
  uid: string
  mimeType: string
  dataUrl: string
  base64: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  /** 全链路 traceId（历史消息由 history 接口返回；实时流由客户端生成并上送） */
  traceId?: string
  tools?: ToolTrace[]
  recalls?: RagTrace[]
  usage?: UsageTrace & { costYuan?: number }
  /** 本回合赞/踩反馈 */
  feedback?: FeedbackInfo | null
  /** 历史消息的图片附件（服务端按 id 鉴权拉取） */
  attachments?: ChatAttachment[]
  /** 乐观气泡的本地图片 dataURL */
  localImages?: string[]
}

type Props = BottomTabScreenProps<MainTabParamList, 'Chat'>

/** 根据当前时间生成问候语 */
function greetingOf(): string {
  const h = new Date().getHours()
  if (h < 5) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

export default function ChatScreen({ route }: Props) {
  const { user, logout } = useAuth()

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [errorTip, setErrorTip] = useState('')
  const [mountedSkills, setMountedSkills] = useState<Skill[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState(0)
  const [convModalVisible, setConvModalVisible] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const [approvalQueue, setApprovalQueue] = useState<ApprovalRequestData[]>([])
  const [citeSignals, setCiteSignals] = useState<Record<number, CiteSignal>>({})
  const streamRef = useRef<StreamHandle | null>(null)
  const listRef = useRef<FlatList<Message>>(null)
  const bootstrappedRef = useRef(false)

  const currentApproval = approvalQueue[0]

  useEffect(() => {
    void loadConversations()
    return () => streamRef.current?.close()
  }, [])

  // 深链参数（通知/「我的」跳转）带 conversationId 时切换过去（首屏由 loadConversations 处理）
  useEffect(() => {
    const wanted = route.params?.conversationId
    if (wanted == null || !bootstrappedRef.current) return
    if (wanted !== activeConversationId) void switchConversation(wanted)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.conversationId])

  /** 不可变更新最后一条助手消息 */
  function patchLast(patch: Partial<Message>) {
    setMessages((m) => {
      const copy = [...m]
      const last = copy[copy.length - 1]
      if (last && last.role === 'assistant') {
        copy[copy.length - 1] = { ...last, ...patch }
      }
      return copy
    })
  }

  /** 加载会话列表；无会话时自动新建一个；有深链参数则优先切到该会话 */
  async function loadConversations() {
    try {
      const list = await listConversations()
      if (list.length === 0) {
        const created = await createConversation('新对话')
        setConversations([created])
        setActiveConversationId(created.id)
        setHistoryLoading(false)
      } else {
        setConversations(list)
        const wanted = route.params?.conversationId
        const target = wanted != null && list.some((c) => c.id === wanted) ? wanted : list[0].id
        await switchConversation(target)
      }
    } catch {
      setHistoryLoading(false)
    } finally {
      bootstrappedRef.current = true
    }
  }

  /** 切换会话：加载该会话历史 */
  async function switchConversation(id: number) {
    setActiveConversationId(id)
    setMessages([])
    setCiteSignals({})
    setHistoryLoading(true)
    try {
      const data = await api<{ messages: Message[] }>(`/api/chat/history?conversationId=${id}`)
      setMessages(data.messages || [])
    } catch {
      // 历史加载失败不阻塞，可继续对话
    } finally {
      setHistoryLoading(false)
    }
  }

  /** 新建会话 */
  async function handleCreate() {
    try {
      const created = await createConversation('新对话')
      setConversations((l) => [created, ...l])
      setActiveConversationId(created.id)
      setMessages([])
      setCiteSignals({})
      setErrorTip('')
    } catch (err: any) {
      setErrorTip(err?.message || '新建会话失败')
    }
  }

  function openRename(conv: Conversation) {
    setRenameTarget(conv)
    setRenameValue(conv.title)
  }

  async function handleRename() {
    if (!renameTarget) return
    const title = renameValue.trim()
    if (!title) return
    try {
      const updated = await renameConversation(renameTarget.id, title)
      setConversations((l) => l.map((c) => (c.id === updated.id ? updated : c)))
      setRenameTarget(null)
    } catch (err: any) {
      setErrorTip(err?.message || '重命名失败')
    }
  }

  function confirmDelete(conv: Conversation) {
    Alert.alert('删除会话', `将删除「${conv.title}」及其全部消息，确定？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => void handleDelete(conv) },
    ])
  }

  async function handleDelete(conv: Conversation) {
    try {
      await deleteConversation(conv.id)
      setConversations((l) => {
        const rest = l.filter((c) => c.id !== conv.id)
        if (conv.id === activeConversationId) {
          if (rest.length > 0) {
            void switchConversation(rest[0].id)
          } else {
            setActiveConversationId(0)
            setMessages([])
          }
        }
        return rest
      })
    } catch (err: any) {
      setErrorTip(err?.message || '删除失败')
    }
  }

  // tab 切回聊天页时刷新已挂载技能
  useFocusEffect(
    useCallback(() => {
      let alive = true
      api<{ skills: Skill[] }>('/api/skills')
        .then((data) => {
          if (alive) setMountedSkills((data.skills || []).filter((s) => s.mounted))
        })
        .catch(() => {
          // 技能加载失败不阻塞对话
        })
      return () => {
        alive = false
      }
    }, []),
  )

  /** 选择图片：类型/大小/数量前端预校验（后端仍有权威校验） */
  async function pickImages() {
    const remaining = MAX_IMAGES - pendingImages.length
    if (remaining <= 0) {
      Alert.alert('提示', `单条消息最多发送 ${MAX_IMAGES} 张图片`)
      return
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert('无法访问相册', '请在系统设置中允许应用访问照片')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      base64: true,
      quality: 0.8,
    })
    if (result.canceled || !result.assets?.length) return

    const loaded: PendingImage[] = []
    for (const a of result.assets.slice(0, remaining)) {
      const mime = a.mimeType || 'image/jpeg'
      if (!ACCEPTED_IMAGE_TYPES.includes(mime)) continue
      if (a.fileSize != null && a.fileSize > MAX_IMAGE_SIZE) continue
      const base64 = a.base64
      if (!base64) continue
      loaded.push({ uid: uuidv4(), mimeType: mime, dataUrl: `data:${mime};base64,${base64}`, base64 })
    }
    if (loaded.length === 0) {
      Alert.alert('未能添加图片', '请确认格式为 JPEG/PNG/GIF/WebP 且单张不超过 5MB')
      return
    }
    setPendingImages((prev) => [...prev, ...loaded].slice(0, MAX_IMAGES))
  }

  function removePendingImage(uid: string) {
    setPendingImages((prev) => prev.filter((p) => p.uid !== uid))
  }

  function send() {
    const text = input.trim()
    if (loading) return
    // 文字与图片至少有其一（纯图片回合合法）
    if (!text && pendingImages.length === 0) return

    const imagesToSend: ChatImageInput[] = pendingImages.map((p) => ({
      mimeType: p.mimeType,
      data: p.base64,
    }))
    const localPreviews = pendingImages.map((p) => p.dataUrl)
    setPendingImages([])

    setMessages((m) => [
      ...m,
      { role: 'user', content: text, localImages: localPreviews },
      { role: 'assistant', content: '' },
    ])
    setInput('')
    setLoading(true)
    setErrorTip('')

    void streamChat(
      text,
      activeConversationId,
      {
        onTraceId: (id) => patchLast({ traceId: id }),
        onToken: (token) => {
          setMessages((m) => {
            const copy = [...m]
            const last = copy[copy.length - 1]
            if (last && last.role === 'assistant') {
              copy[copy.length - 1] = { ...last, content: last.content + token }
            }
            return copy
          })
        },
        onTool: (tool) =>
          setMessages((m) => {
            const copy = [...m]
            const last = copy[copy.length - 1]
            if (last && last.role === 'assistant') {
              copy[copy.length - 1] = { ...last, tools: [...(last.tools || []), tool] }
            }
            return copy
          }),
        onRag: (rag) =>
          setMessages((m) => {
            const copy = [...m]
            const last = copy[copy.length - 1]
            if (last && last.role === 'assistant') {
              copy[copy.length - 1] = { ...last, recalls: [...(last.recalls || []), rag] }
            }
            return copy
          }),
        onUsage: (usage) => patchLast({ usage }),
        onReset: () => patchLast({ tools: [], recalls: [], usage: undefined }),
        onApproval: (approval) => setApprovalQueue((q) => [...q, approval]),
        onDone: () => setLoading(false),
        onError: (err) => {
          if (err.status === 401) {
            logout()
            setMessages([])
          } else {
            setErrorTip(err.message)
            setMessages((m) => {
              const copy = [...m]
              const last = copy[copy.length - 1]
              if (last && last.role === 'assistant' && !last.content) {
                copy[copy.length - 1] = { ...last, content: `请求失败：${err.message}` }
              }
              return copy
            })
          }
          setLoading(false)
        },
      },
      imagesToSend,
    )
      .then((handle) => {
        streamRef.current = handle
      })
      .catch(() => setLoading(false))
  }

  function stop() {
    streamRef.current?.close()
    setLoading(false)
  }

  function patchMessageAt(index: number, patch: Partial<Message>) {
    setMessages((list) => list.map((m, i) => (i === index ? { ...m, ...patch } : m)))
  }

  /** 审批决策完成：出队并（可选）提示错误 */
  function handleApprovalDone(error?: string) {
    if (error) setErrorTip(error)
    setApprovalQueue((q) => q.slice(1))
  }

  const displayName = user?.nickname || user?.username || '朋友'
  const isEmpty = !historyLoading && messages.length === 0
  const canSend = !!input.trim() || pendingImages.length > 0

  const renderItem: ListRenderItem<Message> = ({ item, index }) => {
    if (item.role === 'user') {
      const hasImages = (item.localImages?.length || 0) > 0 || (item.attachments?.length || 0) > 0
      return (
        <View style={[styles.row, styles.rowUser]}>
          <View style={[styles.bubble, styles.bubbleUser]}>
            {item.content ? <Text style={styles.textUser}>{item.content}</Text> : null}
            {hasImages ? (
              <View style={styles.attachWrap}>
                {item.localImages?.map((src, i) => (
                  <Image key={`l${i}`} source={{ uri: src }} style={styles.attachImg} />
                ))}
                {item.attachments?.map((a) => (
                  <AuthImage key={`a${a.id}`} attachmentId={a.id} size={140} />
                ))}
              </View>
            ) : null}
          </View>
        </View>
      )
    }

    const streaming = loading && index === messages.length - 1
    const hasLiveTrace = (item.tools?.length || 0) > 0 || (item.recalls?.length || 0) > 0
    const docSegmentCount = (item.recalls || []).reduce(
      (n, r) => n + (r.segments || []).filter((s) => s.type !== 'conversation').length,
      0,
    )

    return (
      <View style={[styles.row, styles.rowAssistant]}>
        <Image source={assistantAvatar} style={styles.avatar} />
        <View style={[styles.bubble, styles.bubbleAssistant]}>
          {streaming && !item.content && !hasLiveTrace ? (
            <View style={styles.thinkingRow}>
              <ActivityIndicator size="small" color="#4d86ff" />
              <Text style={styles.thinkingText}>思考中…</Text>
            </View>
          ) : (
            <>
              <TracePanels tools={item.tools} recalls={item.recalls} citeSignal={citeSignals[index] ?? null} />
              {item.content ? (
                <CitationText
                  content={item.content}
                  streaming={streaming}
                  docSegmentCount={docSegmentCount}
                  onCite={(n) => setCiteSignals((prev) => ({ ...prev, [index]: { n, ts: Date.now() } }))}
                />
              ) : null}
              {!streaming && !hasLiveTrace && item.traceId ? (
                <HistoricalTrace key={item.traceId} traceId={item.traceId} />
              ) : null}
              {(hasLiveTrace || item.usage) && <TraceFooter usage={item.usage} traceId={item.traceId} />}
              {!streaming && item.traceId && item.content ? (
                <FeedbackBar
                  traceId={item.traceId}
                  initial={item.feedback ?? null}
                  onChange={(fb) => patchMessageAt(index, { feedback: fb })}
                />
              ) : null}
            </>
          )}
        </View>
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.convBtn} onPress={() => setConvModalVisible(true)} hitSlop={10}>
          <Text style={styles.convBtnText}>☰ 会话</Text>
        </Pressable>
        <Text style={styles.headerTitle}>
          <Text style={styles.headerDot}>● </Text>Agent AI
        </Text>
      </View>

      {isEmpty ? (
        <View style={styles.welcome}>
          <View style={styles.heroWrap}>
            <View style={styles.heroHalo} />
            <Image source={assistantAvatar} style={styles.hero} />
          </View>
          <Text style={styles.greeting}>
            {greetingOf()}，{displayName}
          </Text>
          <Text style={styles.welcomeSub}>
            温柔而高效地和你对话，写东西、查资料都可以交给我
            {mountedSkills.length === 0 ? ' · 可在「技能管理」中挂载工具技能' : ''}
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          style={styles.list}
          data={messages}
          keyExtractor={(_, i) => String(i)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={historyLoading ? <Text style={styles.tip}>加载历史消息...</Text> : null}
        />
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        {errorTip ? <Text style={styles.errorTip}>{errorTip}</Text> : null}
        {mountedSkills.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.skillsBar}
            contentContainerStyle={styles.skillsContent}
          >
            <Text style={styles.skillsLabel}>已挂载技能</Text>
            {mountedSkills.map((s) => (
              <Pressable
                key={s.name}
                style={styles.skillChip}
                onPress={() => Alert.alert(s.name, s.shortDescription || '无描述')}
              >
                <Text style={styles.skillChipText}>{s.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {pendingImages.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.previewBar}
            contentContainerStyle={styles.previewContent}
          >
            {pendingImages.map((img) => (
              <View key={img.uid} style={styles.previewItem}>
                <Image source={{ uri: img.dataUrl }} style={styles.previewImg} />
                <Pressable style={styles.previewRemove} onPress={() => removePendingImage(img.uid)} hitSlop={6}>
                  <Ionicons name="close" size={13} color="#fff" />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : null}

        <View style={[styles.composer, { maxWidth: 720 }]}>
          <Pressable
            style={[styles.imageBtn, (loading || pendingImages.length >= MAX_IMAGES) && styles.imageBtnDisabled]}
            onPress={pickImages}
            disabled={loading || pendingImages.length >= MAX_IMAGES}
            hitSlop={8}
          >
            <Ionicons name="image-outline" size={22} color="#4d86ff" />
          </Pressable>
          <TextInput
            style={styles.input}
            multiline
            value={input}
            onChangeText={setInput}
            placeholder={pendingImages.length > 0 ? '补充说明，或直接发送图片' : '有问题，随便问'}
            placeholderTextColor="#aab3c5"
            returnKeyType="send"
            blurOnSubmit={false}
            onSubmitEditing={() => {
              if (!input.includes('\n')) send()
            }}
          />
          <Pressable
            style={[styles.sendBtn, loading || canSend ? styles.sendBtnActive : null]}
            disabled={!loading && !canSend}
            onPress={loading ? stop : send}
          >
            <Text style={styles.sendText}>{loading ? '∥' : '↑'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* 会话列表 */}
      <Modal
        visible={convModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setConvModalVisible(false)}
      >
        <View style={styles.modalMask}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>会话</Text>
              <Pressable
                onPress={() => {
                  void handleCreate()
                  setConvModalVisible(false)
                }}
                hitSlop={10}
              >
                <Text style={styles.modalAdd}>＋ 新建</Text>
              </Pressable>
            </View>
            <FlatList
              data={conversations}
              keyExtractor={(c) => String(c.id)}
              style={styles.convList}
              renderItem={({ item }) => (
                <View style={styles.convRow}>
                  <Pressable
                    style={styles.convRowMain}
                    onPress={() => {
                      setConvModalVisible(false)
                      void switchConversation(item.id)
                    }}
                  >
                    <Text
                      style={[
                        styles.convRowTitle,
                        item.id === activeConversationId && styles.convRowTitleActive,
                      ]}
                      numberOfLines={1}
                    >
                      {item.title}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => openRename(item)} hitSlop={8}>
                    <Text style={styles.convRowOp}>改</Text>
                  </Pressable>
                  <Pressable onPress={() => confirmDelete(item)} hitSlop={8}>
                    <Text style={[styles.convRowOp, styles.convRowOpDanger]}>删</Text>
                  </Pressable>
                </View>
              )}
              ListEmptyComponent={<Text style={styles.tip}>暂无会话</Text>}
            />
            <Pressable style={styles.modalClose} onPress={() => setConvModalVisible(false)}>
              <Text style={styles.modalCloseText}>关闭</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* 重命名会话 */}
      <Modal
        visible={!!renameTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameTarget(null)}
      >
        <View style={styles.modalMask}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>重命名会话</Text>
            <TextInput
              style={styles.renameInput}
              value={renameValue}
              onChangeText={setRenameValue}
              autoFocus
              placeholder="会话标题"
              placeholderTextColor="#aab3c5"
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalBtn} onPress={() => setRenameTarget(null)}>
                <Text style={styles.modalBtnText}>取消</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={() => void handleRename()}
              >
                <Text style={styles.modalBtnTextPrimary}>保存</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <ApprovalModal approval={currentApproval ?? null} onDone={handleApprovalDone} />
    </SafeAreaView>
  )
}

const ACCENT = '#4d86ff'

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
  headerDot: { color: ACCENT, fontSize: 13 },
  convBtn: { position: 'absolute', left: 16 },
  convBtnText: { fontSize: 14, color: '#4d86ff', fontWeight: '600' },
  // 会话列表 / 重命名弹窗
  modalMask: {
    flex: 1,
    backgroundColor: 'rgba(23,43,92,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#1d2738' },
  modalAdd: { fontSize: 14, color: '#4d86ff', fontWeight: '600' },
  convList: { flexGrow: 0 },
  convRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eef2fb',
    gap: 12,
  },
  convRowMain: { flex: 1 },
  convRowTitle: { fontSize: 15, color: '#2c384c' },
  convRowTitleActive: { color: ACCENT, fontWeight: '700' },
  convRowOp: { fontSize: 13, color: '#8590a6' },
  convRowOpDanger: { color: '#e5484d' },
  modalClose: { marginTop: 14, alignItems: 'center', paddingVertical: 8 },
  modalCloseText: { fontSize: 14, color: '#8590a6' },
  renameInput: {
    marginTop: 12,
    backgroundColor: '#f6f9ff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#2c384c',
    borderWidth: 1,
    borderColor: '#e4ebf7',
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  modalBtn: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 10, backgroundColor: '#eef2fb' },
  modalBtnPrimary: { backgroundColor: ACCENT },
  modalBtnText: { fontSize: 14, color: '#5f6c84' },
  modalBtnTextPrimary: { fontSize: 14, color: '#fff', fontWeight: '600' },
  welcome: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  heroWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  heroHalo: {
    position: 'absolute',
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: 'rgba(77,134,255,0.14)',
  },
  hero: {
    width: 104,
    height: 104,
    borderRadius: 52,
    borderWidth: 4,
    borderColor: '#fff',
    shadowColor: '#4d86ff',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  greeting: { fontSize: 26, fontWeight: '700', color: '#1d2738', textAlign: 'center' },
  welcomeSub: { fontSize: 14, color: '#5f6c84', marginTop: 10, textAlign: 'center', lineHeight: 21 },
  list: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 8, maxWidth: 720, alignSelf: 'center', width: '100%' },
  row: { flexDirection: 'row', marginBottom: 24 },
  rowUser: { justifyContent: 'flex-end' },
  rowAssistant: { alignItems: 'flex-start' },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#fff',
    marginRight: 12,
    marginTop: 2,
    shadowColor: '#4d86ff',
    shadowOpacity: 0.22,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  bubble: { maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 11, shadowColor: '#172b5c' },
  bubbleUser: {
    backgroundColor: ACCENT,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 6,
    shadowOpacity: 0.24,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  bubbleAssistant: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#edf2fb',
    borderTopLeftRadius: 6,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  textUser: { color: '#fff', fontSize: 15, lineHeight: 22 },
  attachWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  attachImg: { width: 140, height: 140, borderRadius: 10, backgroundColor: '#eef2fb' },
  thinkingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  thinkingText: { fontSize: 14, color: '#8590a6' },
  tip: { textAlign: 'center', color: '#8590a6', marginTop: 40 },
  errorTip: { textAlign: 'center', color: '#e5484d', fontSize: 13, marginBottom: 8 },
  skillsBar: { flexGrow: 0, maxWidth: 720, alignSelf: 'center', width: '100%' },
  skillsContent: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 8, gap: 8 },
  skillsLabel: { color: '#8590a6', fontSize: 12 },
  skillChip: { backgroundColor: '#eef2fb', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  skillChipText: { color: '#4d86ff', fontSize: 13, fontWeight: '600' },
  previewBar: { flexGrow: 0, maxWidth: 720, alignSelf: 'center', width: '100%' },
  previewContent: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 8, gap: 10 },
  previewItem: { position: 'relative' },
  previewImg: { width: 64, height: 64, borderRadius: 10, backgroundColor: '#eef2fb' },
  previewRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(23,43,92,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 720,
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 8,
  },
  imageBtn: { paddingBottom: 12, paddingLeft: 2 },
  imageBtnDisabled: { opacity: 0.4 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e4ebf7',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    paddingRight: 52,
    fontSize: 15,
    color: '#2c384c',
    shadowColor: '#172b5c',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  sendBtn: {
    position: 'absolute',
    right: 17,
    bottom: 15,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#e6eaf2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnActive: { backgroundColor: ACCENT },
  sendText: { color: '#fff', fontSize: 16, fontWeight: '700', marginTop: -2 },
})
