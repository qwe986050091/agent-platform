/** 千分位数字格式化（手写实现，避免依赖 Hermes 的 Intl） */
export function numberFmt(v?: number | null): string {
  const n = Math.round(Number(v || 0))
  const sign = n < 0 ? '-' : ''
  return sign + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 金额格式：¥ + 4 位小数（与后端 costYuan 精度一致） */
export function moneyFmt(v?: number | null): string {
  return `¥${Number(v || 0).toFixed(4)}`
}

/** 时间格式：YYYY-MM-DD HH:mm；空/非法返回 — */
export function formatTime(v?: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 日期格式：YYYY-MM-DD（用量统计 from/to 查询参数） */
export function formatDateParam(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
