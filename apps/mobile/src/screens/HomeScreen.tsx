import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useAuth } from '../auth'
import type { MainTabParamList } from '../types/navigation'
import characterHome from '../../assets/character-home.jpg'

type Props = BottomTabScreenProps<MainTabParamList, 'Home'>

const CHIPS = ['✨ 自然对话', '📚 知识库问答', '🧩 技能挂载', '☁️ 随时陪伴']

/** 首页：品牌欢迎页，展示立绘与快捷入口 */
export default function HomeScreen({ navigation }: Props) {
  const { user } = useAuth()
  const name = user?.nickname || user?.username || '朋友'

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>首页</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>你的专属 AI 助手</Text>
        </View>

        <Text style={styles.title}>
          你好呀，<Text style={styles.titleAccent}>{name}</Text>
        </Text>
        <Text style={styles.subtitle}>
          温柔又高效地陪你写东西、查资料、整理知识。
          {'\n'}有什么想做的，现在就开始吧。
        </Text>

        <Pressable style={styles.actionPrimary} onPress={() => navigation.navigate('Chat')}>
          <Ionicons name="create-outline" size={18} color="#fff" />
          <Text style={styles.actionPrimaryText}>开始新对话</Text>
        </Pressable>

        <View style={styles.actionRow}>
          <Pressable style={styles.actionCard} onPress={() => navigation.navigate('Knowledge')}>
            <Ionicons name="book-outline" size={20} color="#4d86ff" />
            <Text style={styles.actionText}>知识库</Text>
          </Pressable>
          <Pressable style={styles.actionCard} onPress={() => navigation.navigate('Skills')}>
            <Ionicons name="apps-outline" size={20} color="#4d86ff" />
            <Text style={styles.actionText}>技能管理</Text>
          </Pressable>
        </View>

        <View style={styles.chipsWrap}>
          {CHIPS.map((c) => (
            <View key={c} style={styles.chip}>
              <Text style={styles.chipText}>{c}</Text>
            </View>
          ))}
        </View>

        <View style={styles.figureWrap}>
          <View style={styles.figureHalo} />
          <View style={styles.figureCard}>
            <Image source={characterHome} style={styles.figure} />
          </View>
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
  content: {
    padding: 24,
    paddingBottom: 40,
    alignItems: 'center',
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#e8efff',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 14,
  },
  badgeText: { fontSize: 12, color: '#3b6fd4', fontWeight: '600' },
  title: { fontSize: 26, fontWeight: '700', color: '#1d2738', alignSelf: 'flex-start' },
  titleAccent: {
    color: '#4d86ff',
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 14,
    color: '#5f6c84',
    lineHeight: 21,
    marginTop: 10,
    marginBottom: 22,
    alignSelf: 'flex-start',
  },
  actionPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#4d86ff',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 28,
    shadowColor: '#4d86ff',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  actionPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    alignSelf: 'stretch',
  },
  actionCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e4ebf7',
    paddingVertical: 14,
  },
  actionText: { fontSize: 15, color: '#2c384c', fontWeight: '600' },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    marginTop: 22,
  },
  chip: {
    backgroundColor: '#eef2fb',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipText: { fontSize: 13, color: '#3b6fd4' },
  figureWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
    width: '100%',
  },
  figureHalo: {
    position: 'absolute',
    width: '96%',
    aspectRatio: 1,
    borderRadius: 999,
    backgroundColor: 'rgba(77,134,255,0.14)',
  },
  figureCard: {
    width: '88%',
    aspectRatio: 1,
    backgroundColor: '#fff',
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e4ebf7',
    shadowColor: '#4d86ff',
    shadowOpacity: 0.24,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  figure: { width: '100%', height: '100%' },
})
