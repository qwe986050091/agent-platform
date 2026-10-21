import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './auth'
import MainLayout from './layouts/MainLayout'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import ChatPage from './pages/ChatPage'
import SkillsPage from './pages/SkillsPage'
import TasksPage from './pages/TasksPage'
import KnowledgePage from './pages/KnowledgePage'
import UsagePage from './pages/UsagePage'
import FeedbackAdminPage from './pages/FeedbackAdminPage'
import EvalAdminPage from './pages/EvalAdminPage'

/** 登录守卫：未登录跳转登录页 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <MainLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<HomePage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/skills" element={<SkillsPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/admin/feedback" element={<FeedbackAdminPage />} />
        <Route path="/admin/eval" element={<EvalAdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
