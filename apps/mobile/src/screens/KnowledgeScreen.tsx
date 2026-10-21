import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as DocumentPicker from 'expo-document-picker'
import Ionicons from '@expo/vector-icons/Ionicons'
import {
  deleteDocument,
  listDocuments,
  uploadDocument,
  type KnowledgeDoc,
} from '../api'
import assistantAvatar from '../../assets/assistant-avatar.jpg'

interface UploadingState {
  phase: 'uploading' | 'processing'
  fileName: string
  percent: number
}

const ALLOWED = /\.(txt|md|text|markdown|pdf|doc|docx|xls|xlsx|ppt|pptx|html|htm)$/i
const MAX_SIZE = 20 * 1024 * 1024

/** 知识库管理页：上传文档（txt/md/pdf/office/html）→ 后端切块向量化（RAG），对话时可被检索引用 */
export default function KnowledgeScreen() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState<UploadingState | null>(null)

  useEffect(() => {
    void loadDocs()
  }, [])

  const loadDocs = useCallback(async () => {
    setLoading(true)
    try {
      setDocs(await listDocuments())
    } catch (err: any) {
      Alert.alert('加载失败', err?.message || '网络连接失败')
    } finally {
      setLoading(false)
    }
  }, [])

  async function pickAndUpload() {
    if (uploading) return
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*', // 各厂商文件管理器对 .md/.text 的 MIME 映射不一致，用 */* + 扩展名自校验
      copyToCacheDirectory: true, // 必须 true：拷贝到缓存目录，保证拿到 file:// URI 可上传
    })
    if (result.canceled || !result.assets?.length) return
    const asset = result.assets[0]

    if (!ALLOWED.test(asset.name)) {
      Alert.alert('不支持的文件类型', '仅支持 txt / md / PDF / Word / Excel / PPT / HTML 文档')
      return
    }
    if (asset.size != null && asset.size > MAX_SIZE) {
      Alert.alert('文件过大', '文件不能超过 20MB')
      return
    }

    setUploading({ phase: 'uploading', fileName: asset.name, percent: 0 })
    try {
      const res = await uploadDocument(
        { uri: asset.uri, name: asset.name, type: asset.mimeType || 'text/plain' },
        (p) =>
          setUploading((u) => (u ? { ...u, percent: p, phase: p >= 100 ? 'processing' : 'uploading' } : u)),
      )
      setUploading(null)
      Alert.alert('上传成功', `《${asset.name}》已切分为 ${res.chunks} 个片段，对话时可被检索引用`)
      await loadDocs()
    } catch (err: any) {
      setUploading(null)
      Alert.alert('上传失败', err?.message || '网络连接失败')
    }
  }

  function confirmDelete(doc: KnowledgeDoc) {
    Alert.alert('删除文档', `确定删除文档「${doc.docName}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteDocument(doc.id)
            await loadDocs()
          } catch (err: any) {
            Alert.alert('删除失败', err?.message || '网络连接失败')
          }
        },
      },
    ])
  }

  const renderItem: ListRenderItem<KnowledgeDoc> = ({ item }) => (
    <View style={styles.docRow}>
      <View style={styles.docInfo}>
        <Text style={styles.docName} numberOfLines={1}>
          {item.docName}
        </Text>
        <View style={styles.docTags}>
          <View style={styles.tagType}>
            <Text style={styles.tagTypeText}>{item.docType}</Text>
          </View>
          <View style={styles.tagChunk}>
            <Text style={styles.tagChunkText}>{item.chunkCount} 片段</Text>
          </View>
        </View>
        {item.createdAt ? (
          <Text style={styles.docTime}>
            上传于 {new Date(item.createdAt).toLocaleString('zh-CN')}
          </Text>
        ) : null}
      </View>
      <Pressable onPress={() => confirmDelete(item)} hitSlop={10} style={styles.deleteBtn}>
        <Ionicons name="trash-outline" size={18} color="#e5484d" />
      </Pressable>
    </View>
  )

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>知识库</Text>
      </View>

      {/* 上传文档 */}
      <View style={styles.uploadCard}>
        <Pressable style={styles.uploadZone} onPress={pickAndUpload} disabled={!!uploading}>
          <Ionicons name="cloud-upload-outline" size={32} color="#4d86ff" />
          <Text style={styles.uploadText}>点击选择文档上传</Text>
          <Text style={styles.uploadHint}>
            支持 txt / md / PDF / Word / Excel / PPT / HTML；上传后自动切分、向量化，对话时可被 AI 检索引用
          </Text>
        </Pressable>

        {uploading ? (
          <View style={styles.progressCard}>
            {uploading.phase === 'uploading' ? (
              <>
                <Text style={styles.progressText}>
                  正在上传《{uploading.fileName}》 {uploading.percent}%
                </Text>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${uploading.percent}%` }]} />
                </View>
              </>
            ) : (
              <View style={styles.processingRow}>
                <ActivityIndicator color="#4d86ff" />
                <Text style={styles.progressText}>
                  文件已上传，正在切块并向量化（首次处理可能需要十几秒）…
                </Text>
              </View>
            )}
          </View>
        ) : null}
      </View>

      {/* 文档列表 */}
      <FlatList
        style={styles.list}
        data={docs}
        keyExtractor={(d) => String(d.id)}
        renderItem={renderItem}
        contentContainerStyle={docs.length === 0 ? styles.listEmptyContent : styles.listContent}
        ListHeaderComponent={
          docs.length > 0 ? <Text style={styles.sectionTitle}>我的知识库（{docs.length}）</Text> : null
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color="#4d86ff" style={{ marginTop: 48 }} />
          ) : (
            <View style={styles.emptyWrap}>
              <Image source={assistantAvatar} style={styles.emptyImg} />
              <Text style={styles.emptyText}>还没有知识文档，上传一个试试吧</Text>
            </View>
          )
        }
      />
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
  uploadCard: {
    margin: 16,
    marginBottom: 4,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e4ebf7',
    padding: 16,
  },
  uploadZone: { alignItems: 'center', paddingVertical: 12 },
  uploadText: { fontSize: 15, color: '#2c384c', fontWeight: '600', marginTop: 10 },
  uploadHint: {
    fontSize: 12,
    color: '#8590a6',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  progressCard: { marginTop: 8, paddingHorizontal: 4 },
  progressText: { fontSize: 13, color: '#5f6c84', marginBottom: 8 },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#eef2fb',
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: '#4d86ff' },
  processingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  list: { flex: 1, marginHorizontal: 16 },
  listContent: { paddingBottom: 24 },
  listEmptyContent: { flexGrow: 1 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1d2738', marginTop: 16, marginBottom: 8 },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e4ebf7',
    padding: 14,
    marginBottom: 10,
  },
  docInfo: { flex: 1, marginRight: 8 },
  docName: { fontSize: 15, fontWeight: '600', color: '#1d2738' },
  docTags: { flexDirection: 'row', gap: 8, marginTop: 8 },
  tagType: {
    backgroundColor: '#e8efff',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  tagTypeText: { fontSize: 11, color: '#3b6fd4', fontWeight: '600' },
  tagChunk: {
    backgroundColor: '#eef2fb',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  tagChunkText: { fontSize: 11, color: '#5f6c84' },
  docTime: { fontSize: 12, color: '#8590a6', marginTop: 8 },
  deleteBtn: { padding: 6 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', marginTop: 72 },
  emptyImg: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#4d86ff',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  emptyText: { color: '#8590a6', fontSize: 14, marginTop: 16 },
})
