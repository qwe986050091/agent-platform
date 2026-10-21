import { useEffect, useState } from 'react'
import { Image as AntImage } from 'antd'
import { fetchAuthBlob } from '../api'

/**
 * 需要登录鉴权的图片（P1-8 对话附件）。
 *
 * <img src> 无法携带 Authorization 头，因此先 fetch 成 Blob 再用本地 objectURL 展示；
 * 卸载/换图时回收 objectURL。接口 401 由 fetchAuthBlob 统一处理跳登录。
 */
export default function AuthImage({
  attachmentId,
  maxWidth = 240,
}: {
  attachmentId: number
  maxWidth?: number
}) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    let revoked = false
    let created = ''
    fetchAuthBlob(`/api/chat/attachments/${attachmentId}`)
      .then((blob) => {
        if (revoked) return
        created = URL.createObjectURL(blob)
        setUrl(created)
      })
      .catch(() => {
        // 图片拉取失败不阻断页面（气泡仍正常显示文字）
      })
    return () => {
      revoked = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [attachmentId])

  if (!url) {
    return (
      <div
        style={{ width: maxWidth, height: 120, background: '#f5f5f5', borderRadius: 8 }}
        aria-label="图片加载中"
      />
    )
  }
  return (
    <AntImage
      src={url}
      style={{ maxWidth, borderRadius: 8, objectFit: 'cover' }}
      alt="对话图片"
    />
  )
}
