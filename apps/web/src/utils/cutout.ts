/**
 * 把贴纸图「外层连通的白色背景」抠成透明，返回 PNG dataURL。
 * 采用从画布四边泛洪填充：只清除与边缘连通的近白/低饱和像素，
 * 被轮廓包住的内部白色（白云、白衬衫、白翅膀、描边）不会被误删。
 */
export function cutoutWhiteBackground(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const w = img.naturalWidth
      const h = img.naturalHeight
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('canvas 2d unavailable'))
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      const { data } = ctx.getImageData(0, 0, w, h)

      const total = w * h
      const visited = new Uint8Array(total)
      const stack: number[] = []

      const isBg = (i: number): boolean => {
        const r = data[i * 4]
        const g = data[i * 4 + 1]
        const b = data[i * 4 + 2]
        const mn = Math.min(r, g, b)
        const mx = Math.max(r, g, b)
        // 近白且低饱和（中性白），阈值兼顾 JPEG 浅色晕边
        return mn >= 232 && mx - mn <= 28
      }

      // 从四条边播种
      for (let x = 0; x < w; x++) {
        stack.push(x, (h - 1) * w + x)
      }
      for (let y = 0; y < h; y++) {
        stack.push(y * w, y * w + (w - 1))
      }

      while (stack.length) {
        const p = stack.pop() as number
        if (p < 0 || p >= total || visited[p]) continue
        visited[p] = 1
        if (!isBg(p)) continue
        data[p * 4 + 3] = 0
        const x = p % w
        if (x > 0) stack.push(p - 1)
        if (x < w - 1) stack.push(p + 1)
        if (p >= w) stack.push(p - w)
        if (p < total - w) stack.push(p + w)
      }

      ctx.putImageData(new ImageData(data, w, h), 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = reject
    img.src = src
  })
}
