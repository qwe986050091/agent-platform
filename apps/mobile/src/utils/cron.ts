/** 定时任务 cron 预设（Spring 6 段：秒 分 时 日 月 周） */
export const CRON_PRESETS = [
  { label: '每天 08:00', value: '0 0 8 * * *' },
  { label: '每周一 09:00', value: '0 0 9 * * 1' },
  { label: '每小时整点', value: '0 0 * * * *' },
]

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const isNum = (s: string) => /^\d+$/.test(s)
const pad = (s: string) => s.padStart(2, '0')

/**
 * 把 6 段 cron 翻译成人话（仅覆盖常见写法，其余原样返回）。
 * 与 PC 端 describeCron 行为一致：秒必须为 0，日/月必须为 *。
 */
export function describeCron(expr: string): string {
  const parts = (expr || '').trim().split(/\s+/)
  if (parts.length !== 6) return expr
  const [sec, min, hour, day, month, week] = parts
  if (sec !== '0' || day !== '*' || month !== '*') return expr

  if (week === '*') {
    if (hour === '*') return `每小时第 ${min} 分`
    if (min === '*' && hour.startsWith('*/')) return `每 ${hour.slice(2)} 小时`
    if (isNum(hour) && isNum(min)) return `每天 ${pad(hour)}:${pad(min)}`
    return expr
  }
  if (isNum(week) && isNum(hour) && isNum(min)) {
    const w = Number(week)
    return `每${WEEKDAY_CN[w === 7 ? 0 : w]} ${pad(hour)}:${pad(min)}`
  }
  return expr
}
