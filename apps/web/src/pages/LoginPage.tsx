import { useState } from 'react'
import { Button, Card, Form, Input, Tabs, Typography, App as AntdApp } from 'antd'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import characterSplash from '../assets/character-splash.jpg'
import appIcon from '../assets/app-icon.jpg'

interface LoginFormValues {
  username: string
  password: string
  nickname?: string
}

export default function LoginPage() {
  const { login, register } = useAuth()
  const navigate = useNavigate()
  const { message } = AntdApp.useApp()
  const [loading, setLoading] = useState(false)

  async function handleSubmit(values: LoginFormValues, mode: 'login' | 'register') {
    setLoading(true)
    try {
      if (mode === 'login') {
        await login(values.username.trim(), values.password)
      } else {
        await register(values.username.trim(), values.password, values.nickname?.trim() || '')
      }
      message.success(mode === 'login' ? '登录成功' : '注册成功，已自动登录')
      navigate('/')
    } catch (err: any) {
      message.error(err.message || '操作失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      {/* 左侧品牌立绘 */}
      <div className="auth-hero">
        <div className="auth-hero-glow" />
        <div className="auth-hero-figure">
          <img src={characterSplash} alt="Agent AI 助手" />
        </div>
      </div>

      {/* 右侧登录表单 */}
      <div className="auth-panel">
        <Card className="auth-card" variant="borderless">
        <div className="auth-brand">
          <img className="auth-logo" src={appIcon} alt="Agent AI" />
          <Typography.Title level={3} style={{ margin: 0 }}>
            Agent AI 对话助手
          </Typography.Title>
          <Typography.Text type="secondary">登录后开始与你的智能助手对话</Typography.Text>
        </div>

        <Tabs
          centered
          defaultActiveKey="login"
          items={[
            {
              key: 'login',
              label: '登录',
              children: (
                <Form
                  layout="vertical"
                  onFinish={(values) => handleSubmit(values, 'login')}
                  autoComplete="off"
                >
                  <Form.Item
                    name="username"
                    rules={[{ required: true, message: '请输入用户名' }]}
                  >
                    <Input prefix={<UserOutlined />} placeholder="用户名" size="large" />
                  </Form.Item>
                  <Form.Item
                    name="password"
                    rules={[{ required: true, message: '请输入密码' }]}
                  >
                    <Input.Password prefix={<LockOutlined />} placeholder="密码" size="large" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block size="large" loading={loading}>
                    登 录
                  </Button>
                </Form>
              ),
            },
            {
              key: 'register',
              label: '注册',
              children: (
                <Form
                  layout="vertical"
                  onFinish={(values) => handleSubmit(values, 'register')}
                  autoComplete="off"
                >
                  <Form.Item
                    name="username"
                    rules={[
                      { required: true, message: '请输入用户名' },
                      { min: 3, message: '用户名至少 3 个字符' },
                    ]}
                  >
                    <Input prefix={<UserOutlined />} placeholder="用户名（至少 3 个字符）" size="large" />
                  </Form.Item>
                  <Form.Item name="nickname">
                    <Input placeholder="昵称（可选）" size="large" />
                  </Form.Item>
                  <Form.Item
                    name="password"
                    rules={[
                      { required: true, message: '请输入密码' },
                      { min: 6, message: '密码至少 6 位' },
                    ]}
                  >
                    <Input.Password prefix={<LockOutlined />} placeholder="密码（至少 6 位）" size="large" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block size="large" loading={loading}>
                    注册并登录
                  </Button>
                </Form>
              ),
            },
          ]}
        />
        </Card>
      </div>
    </div>
  )
}
