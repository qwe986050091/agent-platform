import { useCallback, useEffect, useRef, useState } from 'react'
import petMascotRaw from '../assets/pet-mascot-raw.jpg'
import { cutoutWhiteBackground } from '../utils/cutout'

const IDLE_MS = 20000

const LINES = [
  '嗨～今天也要元气满满哦！',
  '有什么想问的，尽管戳我啦～',
  '啦啦啦～我就在这儿陪着你',
  '写累了？喝口水再继续嘛',
  '知识库和技能都备好啦，随时开工！',
  '嘿嘿，被你发现啦',
  '今天的你也超厉害的！',
  '需要我帮忙的时候，点我一下就好～',
]
const PAT_LINES = ['嘿嘿，摸摸头好舒服～', '再多摸一下嘛', '开心！给你比个心', '哇，被宠爱了呢', '最喜欢和你待在一起啦']
const WAKE_LINES = ['唔…我刚刚打了个小盹儿', '你回来啦！我还以为你走丢了呢', '呼…睡饱啦，继续加油！', '啊呜…被你叫醒啦～']

const HEART = (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
  </svg>
)
const STAR = (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2l1.9 6.3L20 10l-6.1 1.7L12 18l-1.9-6.3L4 10l6.1-1.7z" />
  </svg>
)

interface Spark {
  id: number
  left: number
  top: number
  heart: boolean
  delay: number
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/**
 * 桌宠小助手：固定在右下角的 Q 版形象
 * - 单击：摸摸头（蹦跳 + 爱心星星 + 撒娇台词）
 * - 静置 20s：打盹冒 Zzz，点击或移动鼠标即唤醒
 */
export default function DeskPet() {
  const [bubble, setBubble] = useState<{ show: boolean; text: string }>({ show: false, text: '' })
  const [idle, setIdle] = useState(false)
  const [sparks, setSparks] = useState<Spark[]>([])
  const [petSrc, setPetSrc] = useState('')

  const imgRef = useRef<HTMLImageElement>(null)

  // 启动时抠掉白底，得到透明 PNG
  useEffect(() => {
    let alive = true
    cutoutWhiteBackground(petMascotRaw)
      .then((url) => {
        if (alive) setPetSrc(url)
      })
      .catch(() => {
        if (alive) setPetSrc(petMascotRaw)
      })
    return () => {
      alive = false
    }
  }, [])
  const idleRef = useRef(false)
  const lastActiveRef = useRef(Date.now())
  const bubbleTimer = useRef<ReturnType<typeof setTimeout>>()
  const jumpTimer = useRef<ReturnType<typeof setTimeout>>()
  const sparkId = useRef(0)

  const showBubble = useCallback((text: string, hold = 4200) => {
    setBubble({ show: true, text })
    clearTimeout(bubbleTimer.current)
    bubbleTimer.current = setTimeout(() => setBubble((b) => ({ ...b, show: false })), hold)
  }, [])

  const spawnSparkles = useCallback(() => {
    const batch: Spark[] = Array.from({ length: 4 }, (_, i) => ({
      id: ++sparkId.current,
      left: 26 + Math.random() * 62,
      top: 14 + Math.random() * 30,
      heart: i % 2 === 0,
      delay: Math.random() * 0.12,
    }))
    setSparks((s) => [...s, ...batch])
    const ids = new Set(batch.map((b) => b.id))
    setTimeout(() => setSparks((s) => s.filter((x) => !ids.has(x.id))), 1100)
  }, [])

  const pat = useCallback(() => {
    const wasIdle = idleRef.current
    lastActiveRef.current = Date.now()
    idleRef.current = false
    setIdle(false)
    spawnSparkles()

    // 跳一下：重启跳跃动画，连点可连跳
    const img = imgRef.current
    if (img) {
      img.classList.remove('jumping')
      void img.offsetWidth
      img.classList.add('jumping')
      clearTimeout(jumpTimer.current)
      jumpTimer.current = setTimeout(() => img.classList.remove('jumping'), 680)
    }

    showBubble(wasIdle ? pick(WAKE_LINES) : Math.random() < 0.55 ? pick(PAT_LINES) : pick(LINES))
  }, [showBubble, spawnSparkles])

  // 空闲打盹检测
  useEffect(() => {
    const wake = () => {
      lastActiveRef.current = Date.now()
    }
    window.addEventListener('mousemove', wake, { passive: true })
    window.addEventListener('keydown', wake, { passive: true })

    const timer = setInterval(() => {
      const isIdle = Date.now() - lastActiveRef.current > IDLE_MS
      if (isIdle !== idleRef.current) {
        idleRef.current = isIdle
        setIdle(isIdle)
      }
    }, 1000)

    const hello = setTimeout(() => showBubble('嗨～我是你的小助手！点我一下可以摸摸头，不理我我会偷偷打盹哦', 5600), 1200)

    return () => {
      clearInterval(timer)
      clearTimeout(hello)
      clearTimeout(bubbleTimer.current)
      clearTimeout(jumpTimer.current)
      window.removeEventListener('mousemove', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [showBubble])

  const rootClass = ['pet-dock', idle ? 'pet-idle' : ''].filter(Boolean).join(' ')

  return (
    <div id="desk-pet" className={rootClass}>
      <div
        id="pet-bubble"
        className={`glass-card ${bubble.show ? 'show' : ''}`}
      >
        <span>{bubble.text}</span>
      </div>

      <div className="pet-figure" title="点我摸摸头" onClick={pat}>
        <div className="pet-fx">
          {sparks.map((s) => (
            <span
              key={s.id}
              className="pet-spark"
              style={{
                left: s.left,
                top: s.top,
                color: s.heart ? 'var(--pet-pink)' : 'var(--accent)',
                animationDelay: `${s.delay}s`,
              }}
            >
              {s.heart ? HEART : STAR}
            </span>
          ))}
        </div>

        <div id="pet-zzz" aria-hidden="true">
          <span>z</span>
          <span>Z</span>
          <span>Z</span>
        </div>

        <img
          ref={imgRef}
          className="pet-img"
          src={petSrc || undefined}
          alt="桌宠小助手"
          draggable={false}
          style={{ opacity: petSrc ? 1 : 0 }}
        />
      </div>
    </div>
  )
}
