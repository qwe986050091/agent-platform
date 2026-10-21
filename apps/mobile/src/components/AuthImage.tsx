import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { downloadAttachment } from '../api'

interface Props {
  attachmentId: number
  size?: number
  style?: StyleProp<ImageStyle>
}

/** 鉴权图片：先下载到本地缓存再渲染（RN 无法给 Image 直接带 Authorization 头） */
export default function AuthImage({ attachmentId, size = 160, style }: Props) {
  const [uri, setUri] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setUri(null)
    setFailed(false)
    downloadAttachment(attachmentId)
      .then((u) => {
        if (alive) setUri(u)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [attachmentId])

  if (uri) {
    return <Image source={{ uri }} style={[styles.img, { width: size, height: size }, style]} />
  }
  return (
    <View style={[styles.placeholder, { width: size, height: size }, style as StyleProp<ViewStyle>]}>
      {failed ? (
        <Text style={styles.fail}>图片加载失败</Text>
      ) : (
        <ActivityIndicator color="#4d86ff" />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  img: { borderRadius: 10, backgroundColor: '#eef2fb' },
  placeholder: {
    borderRadius: 10,
    backgroundColor: '#eef2fb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fail: { fontSize: 12, color: '#8590a6' },
})
