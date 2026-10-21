import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, clearAuth, getStoredUser, getToken, saveAuth, type AuthUser } from './api'

interface AuthContextValue {
  user: AuthUser | null
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string, nickname: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>(null as unknown as AuthContextValue)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser())

  /**
   * 启动时用本地 token 静默拉一次 /me：刷新昵称，并取得 admin 标志
   * （localStorage 里的旧数据没有该字段；失败则沿用本地缓存，由各接口的 401 兜底跳登录）。
   */
  useEffect(() => {
    const token = getToken()
    if (!token) return
    api<{ token: string; username: string; nickname: string; admin?: boolean }>('/api/auth/me')
      .then((data) => {
        const u: AuthUser = { username: data.username, nickname: data.nickname, admin: !!data.admin }
        saveAuth(data.token || token, u)
        setUser(u)
      })
      .catch(() => {
        /* 未登录/过期：忽略，后续受保护接口 401 会统一跳登录 */
      })
  }, [])

  async function login(username: string, password: string) {
    const data = await api<{ token: string; username: string; nickname: string; admin?: boolean }>(
      '/api/auth/login',
      { method: 'POST', body: { username, password } },
    )
    const u: AuthUser = { username: data.username, nickname: data.nickname, admin: !!data.admin }
    saveAuth(data.token, u)
    setUser(u)
  }

  async function register(username: string, password: string, nickname: string) {
    const data = await api<{ token: string; username: string; nickname: string; admin?: boolean }>(
      '/api/auth/register',
      { method: 'POST', body: { username, password, nickname } },
    )
    const u: AuthUser = { username: data.username, nickname: data.nickname, admin: !!data.admin }
    saveAuth(data.token, u)
    setUser(u)
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' })
    } catch {
      // 忽略登出请求失败，本地一定清理
    }
    clearAuth()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
