export function localTodoDay(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function millisecondsUntilNextLocalDay(date = new Date()): number {
  const next = new Date(date)
  next.setHours(24, 0, 0, 0)
  return Math.max(1, next.getTime() - date.getTime())
}

export function localTodoDateValue(day: string): number {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date).getTime()
}

export function localTodoTimeZone(): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (!timeZone) throw new Error('无法确定本地时区')
  return timeZone
}
