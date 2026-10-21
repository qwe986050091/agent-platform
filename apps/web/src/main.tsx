import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider, App as AntdApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import { AuthProvider } from './auth'
import './styles.css'

const FONT_STACK =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          // 品牌主色：晴空蓝（与粉发立绘相映）
          colorPrimary: '#4d86ff',
          colorInfo: '#4d86ff',
          colorSuccess: '#18b279',
          colorWarning: '#f0a028',
          colorError: '#ef4d6d',
          borderRadius: 10,
          fontFamily: FONT_STACK,
          colorBgLayout: '#f6f9ff',
          colorText: '#1d2738',
          colorTextSecondary: '#5f6c84',
          colorBorder: '#e4ebf7',
          colorBorderSecondary: '#edf2fb',
        },
        components: {
          Card: {
            borderRadiusLG: 16,
            boxShadowTertiary: '0 1px 2px rgba(23,43,92,0.04), 0 8px 24px rgba(23,43,92,0.05)',
          },
          Button: {
            borderRadius: 10,
            fontWeight: 500,
          },
          Input: {
            borderRadius: 10,
          },
          Tag: {
            borderRadiusSM: 999,
          },
        },
      }}
    >
      <AntdApp>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>,
)
