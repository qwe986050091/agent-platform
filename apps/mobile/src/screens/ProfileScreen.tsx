import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useAuth } from '../auth'
import type { RootStackParamList } from '../types/navigation'
import assistantAvatar from '../../assets/assistant-avatar.jpg'

type Nav = NativeStackNavigationProp<RootStackParamList>

interface Entry {
  key: string
  label: string
  desc: string
  icon: keyof typeof Ionicons.glyphMap
  onPress: () => void
}

/** 「我的」：用户信息 + 定时任务/用量统计/反馈管理(admin)/退出登录 */
export default function ProfileScreen() {
  const { user, logout } = useAuth()
  const navigation = useNavigation<Nav>()
  const name = user?.nickname || user?.username || '用户'

  const entries: Entry[] = [
    {
      key: 'tasks',
      label: '定时任务',
      desc: '按计划自动执行指令',
      icon: 'alarm-outline',
      onPress: () => navigation.navigate('Tasks'),
    },
    {
      key: 'usage',
      label: '用量统计',
      desc: '查看对话轮次、token 与费用',
      icon: 'stats-chart-outline',
      onPress: () => navigation.navigate('Usage'),
    },
  ]
  if (user?.admin) {
    entries.push({
      key: 'feedback',
      label: '反馈管理',
      desc: '管理员：查看与筛选回答反馈',
      icon: 'mail-outline',
      onPress: () => navigation.navigate('FeedbackAdmin'),
    })
  }

  function confirmLogout() {
    Alert.alert('退出登录', '确定要退出当前账号吗？', [
      { text: '取消', style: 'cancel' },
      { text: '退出', style: 'destructive', onPress: () => void logout() },
    ])
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>我的</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.userCard}>
          <View style={styles.avatarWrap}>
            <Ionicons name="person" size={26} color="#4d86ff" />
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.userSub}>
              @{user?.username}
              {user?.admin ? ' · 管理员' : ''}
            </Text>
          </View>
        </View>

        <View style={styles.group}>
          {entries.map((e) => (
            <Pressable key={e.key} style={styles.row} onPress={e.onPress}>
              <View style={styles.rowIcon}>
                <Ionicons name={e.icon} size={19} color="#4d86ff" />
              </View>
              <View style={styles.rowMain}>
                <Text style={styles.rowLabel}>{e.label}</Text>
                <Text style={styles.rowDesc}>{e.desc}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#b6c0d2" />
            </Pressable>
          ))}
        </View>

        <Pressable style={styles.logoutBtn} onPress={confirmLogout}>
          <Ionicons name="log-out-outline" size={18} color="#e5484d" />
          <Text style={styles.logoutText}>退出登录</Text>
        </Pressable>

        <View style={styles.brand}>
          <Image source={assistantAvatar} style={styles.brandImg} />
          <Text style={styles.brandText}>Agent AI · 你的专属助手</Text>
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
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e4ebf7',
    padding: 16,
  },
  avatarWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#e8efff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userInfo: { flex: 1 },
  userName: { fontSize: 17, fontWeight: '700', color: '#1d2738' },
  userSub: { fontSize: 13, color: '#8590a6', marginTop: 4 },
  group: {
    marginTop: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e4ebf7',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eef2fb',
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#eef4ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowMain: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: '600', color: '#1d2738' },
  rowDesc: { fontSize: 12, color: '#8590a6', marginTop: 3 },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f5d9db',
    paddingVertical: 14,
  },
  logoutText: { fontSize: 15, color: '#e5484d', fontWeight: '600' },
  brand: { alignItems: 'center', marginTop: 36 },
  brandImg: { width: 64, height: 64, borderRadius: 32 },
  brandText: { fontSize: 12, color: '#aab3c5', marginTop: 10 },
})
