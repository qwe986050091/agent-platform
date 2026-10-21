import { useState } from 'react'
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useAuth } from '../auth'
import appIcon from '../../assets/app-icon.jpg'

type Mode = 'login' | 'register'

export default function LoginScreen() {
  const { login, register } = useAuth()

  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit() {
    const u = username.trim()
    if (!u) return setError('请输入用户名')
    if (!password) return setError('请输入密码')
    if (mode === 'register' && u.length < 3) return setError('用户名至少 3 个字符')
    if (mode === 'register' && password.length < 6) return setError('密码至少 6 位')

    setError('')
    setLoading(true)
    try {
      if (mode === 'login') {
        await login(u, password)
      } else {
        await register(u, password, nickname.trim())
      }
    } catch (err: any) {
      setError(err?.message || '操作失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />

      <View style={styles.card}>
        <Image source={appIcon} style={styles.logo} />
        <Text style={styles.brand}>Agent AI</Text>
        <Text style={styles.subtitle}>
          {mode === 'login' ? '登录后开始与你的智能助手对话' : '注册一个新账号'}
        </Text>

        <View style={styles.tabs}>
          {(['login', 'register'] as Mode[]).map((m) => (
            <Pressable
              key={m}
              style={[styles.tab, mode === m && styles.tabActive]}
              onPress={() => {
                setMode(m)
                setError('')
              }}
            >
              <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>
                {m === 'login' ? '登录' : '注册'}
              </Text>
            </Pressable>
          ))}
        </View>

        {mode === 'register' ? (
          <TextInput
            style={styles.input}
            placeholder="昵称（可选）"
            placeholderTextColor="#aab3c5"
            value={nickname}
            onChangeText={setNickname}
          />
        ) : null}
        <TextInput
          style={styles.input}
          placeholder="用户名"
          placeholderTextColor="#aab3c5"
          autoCapitalize="none"
          value={username}
          onChangeText={setUsername}
        />
        <TextInput
          style={styles.input}
          placeholder={mode === 'register' ? '密码（至少 6 位）' : '密码'}
          placeholderTextColor="#aab3c5"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.submit, loading && styles.submitDisabled]}
          disabled={loading}
          onPress={submit}
        >
          <Text style={styles.submitText}>
            {loading ? '请稍候...' : mode === 'login' ? '登 录' : '注册并登录'}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f6f9ff',
    justifyContent: 'center',
    padding: 24,
    overflow: 'hidden',
  },
  glowTop: {
    position: 'absolute',
    top: -140,
    right: -100,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(77,134,255,0.16)',
  },
  glowBottom: {
    position: 'absolute',
    bottom: -160,
    left: -120,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(241,124,173,0.12)',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 26,
    paddingTop: 30,
    paddingBottom: 26,
    shadowColor: '#172b5c',
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignSelf: 'center',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(77,134,255,0.16)',
    shadowColor: '#4d86ff',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  brand: { fontSize: 22, fontWeight: '700', color: '#1d2738', textAlign: 'center', letterSpacing: 0.2 },
  subtitle: { fontSize: 14, color: '#5f6c84', textAlign: 'center', marginTop: 8, marginBottom: 22 },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#eef2fb',
    borderRadius: 12,
    padding: 4,
    marginBottom: 18,
  },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  tabActive: { backgroundColor: '#fff', shadowColor: '#172b5c', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  tabText: { fontSize: 14, color: '#8590a6' },
  tabTextActive: { color: '#4d86ff', fontWeight: '600' },
  input: {
    backgroundColor: '#fff',
    borderRadius: 13,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 15,
    color: '#2c384c',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e4ebf7',
  },
  error: { color: '#e5484d', fontSize: 13, marginBottom: 12 },
  submit: {
    backgroundColor: '#4d86ff',
    borderRadius: 13,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#4d86ff',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})