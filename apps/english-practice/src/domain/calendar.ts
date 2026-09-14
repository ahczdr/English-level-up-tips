export function studyDayFor(date: Date, timeZone = 'Asia/Shanghai'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function addDays(day: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) throw new Error(`Invalid calendar day: ${day}`)
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days))
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid calendar day: ${day}`)
  return date.toISOString().slice(0, 10)
}

// 计划文本使用的别名（与 addDays 同一实现）
export const addCalendarDays = addDays
