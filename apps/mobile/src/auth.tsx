import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  api,
  clearAuth,
  getMe,
  getStoredUser,
  getToken,
  onUnauthorized,
  saveAuth,
  type AuthUser,
} from './api'

interface AuthContextValue {
  user: AuthUser | null
  ready: boolean
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string, nickname: string) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>(null as unknown as AuthContextValue)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [ready, setReady] = useState(false)

  // 登录态失效（401）时自动登出：清本地 + 置空 user → UI 回到登录页
  useEffect(() => {
    return onUnauthorized(() => {
      clearAuth().catch(() => {})
      setUser(null)
    })
  }, [])

  // 启动时从本地恢复登录态，并静默调 /api/auth/me 刷新昵称与管理员标志
  const refreshUser = useCallback(async () => {
    try {
      const stored = await getStoredUser()
      setUser(stored)
      const token = await getToken()
      if (!token) return
      const data = await getMe()
      const u: AuthUser = { username: data.username, nickname: data.nickname, admin: !!data.admin }
      await saveAuth(data.token || token, u)
      setUser(u)
    } catch {
      // 未登录/过期：忽略，后续受保护接口 401 会统一登出
    } finally {
      setReady(true)
    }
  }, [])

  async function setSession(token: string, username: string, nickname: string, admin?: boolean) {
    const u: AuthUser = { username, nickname, admin: !!admin }
    await saveAuth(token, u)
    setUser(u)
  }

  async function login(username: string, password: string) {
    const data = await api<{ token: string; username: string; nickname: string; admin?: boolean }>(
      '/api/auth/login',
      { method: 'POST', body: { username, password } },
    )
    await setSession(data.token, data.username, data.nickname, data.admin)
  }

  async function register(username: string, password: string, nickname: string) {
    const data = await api<{ token: string; username: string; nickname: string; admin?: boolean }>(
      '/api/auth/register',
      { method: 'POST', body: { username, password, nickname } },
    )
    await setSession(data.token, data.username, data.nickname, data.admin)
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' })
    } catch {
      // 忽略登出请求失败，本地一定清理
    }
    await clearAuth()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, ready, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}