import { Button } from 'antd'
import { AppstoreOutlined, BookOutlined, EditOutlined, StarOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import characterHome from '../assets/character-home.jpg'

/** 首页：品牌欢迎页，展示立绘与快捷入口 */
export default function HomePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const name = user?.nickname || user?.username || '朋友'

  return (
    <div className="home-page">
      <div className="home-inner">
        {/* 左侧文案与入口 */}
        <div className="home-copy">
          <span className="home-badge">
            <StarOutlined /> 你的专属 AI 助手
          </span>
          <h1 className="home-title">
            你好呀，<span className="home-title-accent">{name}</span>
          </h1>
          <p className="home-subtitle">
            温柔又高效地陪你写东西、查资料、整理知识。
            <br />
            有什么想做的，现在就开始吧。
          </p>

          <div className="home-actions">
            <Button
              type="primary"
              size="large"
              icon={<EditOutlined />}
              onClick={() => navigate('/chat')}
            >
              开始新对话
            </Button>
            <Button size="large" icon={<BookOutlined />} onClick={() => navigate('/knowledge')}>
              知识库
            </Button>
            <Button size="large" icon={<AppstoreOutlined />} onClick={() => navigate('/skills')}>
              技能管理
            </Button>
          </div>

          <div className="home-chips">
            <span>✨ 自然对话</span>
            <span>📚 知识库问答</span>
            <span>🧩 技能挂载</span>
            <span>☁️ 随时陪伴</span>
          </div>
        </div>

        {/* 右侧立绘 */}
        <div className="home-figure">
          <div className="home-figure-glow" />
          <div className="home-figure-card">
            <img src={characterHome} alt="Agent AI 助手立绘" />
          </div>
        </div>
      </div>
    </div>
  )
}
