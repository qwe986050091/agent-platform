import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as DocumentPicker from 'expo-document-picker'
import Ionicons from '@expo/vector-icons/Ionicons'
import {
  deleteSkill,
  listSkills,
  listTools,
  mountSkill,
  unmountSkill,
  uploadSkill,
  uploadSkillFile,
  type Skill,
} from '../api'
import assistantAvatar from '../../assets/assistant-avatar.jpg'

/** 技能管理页：技能列表（挂载/卸载/删除）+ 上传新技能（在线表单 / .json 文件） */
export default function SkillsScreen() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [tools, setTools] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  // 上传表单状态
  const [name, setName] = useState('')
  const [shortDesc, setShortDesc] = useState('')
  const [detailedDesc, setDetailedDesc] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [selectedTools, setSelectedTools] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [fileUploading, setFileUploading] = useState(false)

  useEffect(() => {
    void loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [skillList, toolList] = await Promise.all([listSkills(), listTools()])
      setSkills(skillList)
      setTools(toolList)
    } catch (err: any) {
      Alert.alert('加载失败', err?.message || '网络连接失败')
    } finally {
      setLoading(false)
    }
  }

  async function toggleMount(s: Skill) {
    try {
      if (s.mounted) {
        await unmountSkill(s.name)
        Alert.alert('已卸载', `已卸载「${s.name}」`)
      } else {
        await mountSkill(s.name)
        Alert.alert('已挂载', `已挂载「${s.name}」`)
      }
      await loadAll()
    } catch (err: any) {
      Alert.alert('操作失败', err?.message || '网络连接失败')
    }
  }

  function confirmDelete(s: Skill) {
    Alert.alert('删除技能', `确定删除 Skill「${s.name}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteSkill(s.name)
            await loadAll()
          } catch (err: any) {
            Alert.alert('删除失败', err?.message || '网络连接失败')
          }
        },
      },
    ])
  }

  function toggleTool(t: string) {
    setSelectedTools((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    )
  }

  async function submitForm() {
    const trimmed = name.trim()
    if (!trimmed) return Alert.alert('提示', '请输入技能名称')
    setSubmitting(true)
    try {
      await uploadSkill({
        name: trimmed,
        shortDescription: shortDesc.trim(),
        detailedDescription: detailedDesc.trim(),
        systemPrompt: systemPrompt.trim(),
        toolNames: selectedTools,
      })
      Alert.alert('上传成功', `Skill「${trimmed}」上传成功`)
      setName('')
      setShortDesc('')
      setDetailedDesc('')
      setSystemPrompt('')
      setSelectedTools([])
      await loadAll()
    } catch (err: any) {
      Alert.alert('上传失败', err?.message || '网络连接失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function pickJsonFile() {
    if (fileUploading) return
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
    })
    if (result.canceled || !result.assets?.length) return
    const asset = result.assets[0]
    if (!/\.json$/i.test(asset.name)) {
      Alert.alert('文件格式错误', '请选择 .json 文件（SkillDefinition JSON）')
      return
    }
    setFileUploading(true)
    try {
      await uploadSkillFile({
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType || 'application/json',
      })
      Alert.alert('上传成功', `文件「${asset.name}」上传成功`)
      await loadAll()
    } catch (err: any) {
      Alert.alert('上传失败', err?.message || '网络连接失败')
    } finally {
      setFileUploading(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>技能管理</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* 全部技能 */}
        <Text style={styles.sectionTitle}>全部技能</Text>
        {loading ? (
          <ActivityIndicator color="#4d86ff" style={{ marginTop: 32 }} />
        ) : skills.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Image source={assistantAvatar} style={styles.emptyImg} />
            <Text style={styles.emptyText}>还没有技能，上传一个试试吧</Text>
          </View>
        ) : (
          skills.map((s) => (
            <View key={s.name} style={styles.skillCard}>
              <View style={styles.skillHead}>
                <View style={styles.skillTitleWrap}>
                  <Text style={styles.skillName} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <View style={styles.skillTags}>
                    {s.builtin ? (
                      <View style={styles.tagBuiltin}>
                        <Text style={styles.tagBuiltinText}>内置</Text>
                      </View>
                    ) : (
                      <View style={styles.tagCustom}>
                        <Text style={styles.tagCustomText}>自定义</Text>
                      </View>
                    )}
                    {s.mounted ? (
                      <View style={styles.tagMounted}>
                        <Text style={styles.tagMountedText}>已挂载</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                <View style={styles.skillActions}>
                  <Pressable
                    style={[styles.mountBtn, s.mounted && styles.mountBtnOn]}
                    onPress={() => toggleMount(s)}
                  >
                    <Text style={[styles.mountBtnText, s.mounted && styles.mountBtnTextOn]}>
                      {s.mounted ? '卸载' : '挂载'}
                    </Text>
                  </Pressable>
                  {!s.builtin ? (
                    <Pressable onPress={() => confirmDelete(s)} hitSlop={10} style={styles.deleteBtn}>
                      <Ionicons name="trash-outline" size={17} color="#e5484d" />
                    </Pressable>
                  ) : null}
                </View>
              </View>

              <Text style={styles.skillDesc}>{s.shortDescription || '（无描述）'}</Text>
              {s.toolNames?.length > 0 ? (
                <View style={styles.toolChips}>
                  <Text style={styles.toolLabel}>Tools：</Text>
                  {s.toolNames.map((t) => (
                    <View key={t} style={styles.toolChip}>
                      <Text style={styles.toolChipText}>{t}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ))
        )}

        {/* 上传新技能 */}
        <Text style={[styles.sectionTitle, styles.uploadSectionTitle]}>上传新技能</Text>

        <Pressable
          style={styles.fileUploadBtn}
          onPress={pickJsonFile}
          disabled={fileUploading}
        >
          <Ionicons name="document-text-outline" size={18} color="#4d86ff" />
          <Text style={styles.fileUploadBtnText}>
            {fileUploading ? '上传中…' : '从 JSON 文件上传'}
          </Text>
        </Pressable>
        <Text style={styles.fileUploadHint}>
          文件格式为 SkillDefinition JSON（含 name / systemPrompt / toolNames 等字段）
        </Text>

        <View style={styles.formCard}>
          <Text style={styles.formTitle}>或在线填写表单</Text>

          <Text style={styles.label}>技能名称</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="如 weather_time_report"
            placeholderTextColor="#aab3c5"
            returnKeyType="next"
          />

          <Text style={styles.label}>短描述</Text>
          <TextInput
            style={styles.input}
            value={shortDesc}
            onChangeText={setShortDesc}
            placeholder="一句话说明技能用途"
            placeholderTextColor="#aab3c5"
          />

          <Text style={styles.label}>详细描述</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            value={detailedDesc}
            onChangeText={setDetailedDesc}
            multiline
            textAlignVertical="top"
          />

          <Text style={styles.label}>系统提示词（System Prompt）</Text>
          <TextInput
            style={[styles.input, styles.inputPrompt]}
            value={systemPrompt}
            onChangeText={setSystemPrompt}
            multiline
            textAlignVertical="top"
            placeholder="告诉模型这个技能该按什么流程使用工具"
            placeholderTextColor="#aab3c5"
          />

          <Text style={styles.label}>关联内置工具</Text>
          {tools.length === 0 ? (
            <Text style={styles.noTools}>暂无可选工具</Text>
          ) : (
            <View style={styles.toolsWrap}>
              {tools.map((t) => {
                const active = selectedTools.includes(t)
                return (
                  <Pressable
                    key={t}
                    onPress={() => toggleTool(t)}
                    style={[styles.toolChip, active && styles.toolChipActive]}
                  >
                    <Text style={[styles.toolChipText, active && styles.toolChipTextActive]}>
                      {t}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          )}

          <Pressable
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            disabled={submitting}
            onPress={submitForm}
          >
            <Text style={styles.submitBtnText}>{submitting ? '上传中…' : '上传技能'}</Text>
          </Pressable>
        </View>
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
  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1d2738', marginBottom: 10 },
  uploadSectionTitle: { marginTop: 26 },
  skillCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e4ebf7',
    padding: 14,
    marginBottom: 10,
  },
  skillHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  skillTitleWrap: { flex: 1, marginRight: 8 },
  skillName: { fontSize: 15, fontWeight: '700', color: '#1d2738' },
  skillTags: { flexDirection: 'row', gap: 6, marginTop: 6 },
  tagBuiltin: { backgroundColor: '#eef2fb', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  tagBuiltinText: { fontSize: 11, color: '#5f6c84' },
  tagCustom: { backgroundColor: '#fff7e6', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  tagCustomText: { fontSize: 11, color: '#d48806', fontWeight: '600' },
  tagMounted: { backgroundColor: '#e8efff', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  tagMountedText: { fontSize: 11, color: '#3b6fd4', fontWeight: '600' },
  skillActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mountBtn: {
    borderWidth: 1,
    borderColor: '#4d86ff',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  mountBtnOn: { backgroundColor: '#4d86ff' },
  mountBtnText: { fontSize: 13, color: '#4d86ff', fontWeight: '600' },
  mountBtnTextOn: { color: '#fff' },
  deleteBtn: { padding: 4 },
  skillDesc: { fontSize: 13, color: '#5f6c84', marginTop: 10, lineHeight: 19 },
  toolChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  toolLabel: { fontSize: 12, color: '#8590a6' },
  toolChip: {
    backgroundColor: '#eef2fb',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  toolChipText: { fontSize: 12, color: '#3b6fd4' },
  fileUploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#4d86ff',
    paddingVertical: 13,
    marginBottom: 8,
  },
  fileUploadBtnText: { fontSize: 15, color: '#4d86ff', fontWeight: '600' },
  fileUploadHint: { fontSize: 12, color: '#8590a6', textAlign: 'center', marginBottom: 16 },
  formCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e4ebf7',
    padding: 16,
  },
  formTitle: { fontSize: 14, fontWeight: '600', color: '#1d2738', marginBottom: 14 },
  label: { fontSize: 13, color: '#5f6c84', marginBottom: 6, marginTop: 12 },
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
  inputMultiline: { minHeight: 60 },
  inputPrompt: { minHeight: 96 },
  noTools: { fontSize: 13, color: '#8590a6' },
  toolsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  toolChipActive: { backgroundColor: '#4d86ff' },
  toolChipTextActive: { color: '#fff' },
  submitBtn: {
    backgroundColor: '#4d86ff',
    borderRadius: 13,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 20,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  emptyWrap: { alignItems: 'center', marginTop: 48 },
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
