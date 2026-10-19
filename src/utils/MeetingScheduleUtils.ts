import type { MeetingAvailabilityParticipant, MeetingBusyBlock, MeetingBusySource } from '@/utils/MeetingRequestUtils'

/** 日程助手时间轴显示的范围（当天 7:00 到 21:00） */
export const TIMELINE_START_MINUTE = 7 * 60
export const TIMELINE_END_MINUTE = 21 * 60
/** 在时间轴上点选开始时间时对齐到半小时 */
export const PICK_STEP_MINUTES = 30

export const BUSY_SOURCE_LABEL: Record<MeetingBusySource, string> = {
  meeting: '会议',
  calendar: '日程',
  mail: '邮件邀请'
}

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

/** 本地时间当天零点 */
export const startOfLocalDay = (at: number): number => {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && b.start < a.end

/** 与所选时段冲突的参会人 uid */
export const conflictingUids = (participants: MeetingAvailabilityParticipant[], start: number, end: number): string[] =>
  participants.filter((p) => p.busy.some((block) => overlaps(block, { start, end }))).map((p) => p.uid)

/** 落在某一天时间轴范围内的忙碌块，以及它在轴上的位置（百分比） */
export const layoutDay = (busy: MeetingBusyBlock[], day: number) => {
  const axisStart = day + TIMELINE_START_MINUTE * MINUTE
  const axisEnd = day + TIMELINE_END_MINUTE * MINUTE
  const span = axisEnd - axisStart
  return busy
    .filter((block) => block.end > axisStart && block.start < axisEnd)
    .map((block) => {
      const start = Math.max(block.start, axisStart)
      const end = Math.min(block.end, axisEnd)
      return { block, left: ((start - axisStart) / span) * 100, width: Math.max(((end - start) / span) * 100, 0.4) }
    })
}

/** 一个时段在时间轴上的位置（百分比），不在当天时间轴内时返回 null */
export const axisPosition = (day: number, start: number, end: number) => {
  const axisStart = day + TIMELINE_START_MINUTE * MINUTE
  const axisEnd = day + TIMELINE_END_MINUTE * MINUTE
  if (end <= axisStart || start >= axisEnd) return null
  const span = axisEnd - axisStart
  const from = Math.max(start, axisStart)
  const to = Math.min(end, axisEnd)
  return { left: ((from - axisStart) / span) * 100, width: ((to - from) / span) * 100 }
}

/** 时间轴上点击的位置（0 到 1）换算成对齐到半小时的开始时间 */
export const pickTime = (day: number, ratio: number): number => {
  const minute = TIMELINE_START_MINUTE + Math.min(Math.max(ratio, 0), 1) * (TIMELINE_END_MINUTE - TIMELINE_START_MINUTE)
  const snapped = Math.floor(minute / PICK_STEP_MINUTES) * PICK_STEP_MINUTES
  return day + snapped * MINUTE
}

/** 保持时分不变，换到另一天 */
export const moveToDay = (at: number, day: number): number => {
  const source = new Date(at)
  const target = new Date(day)
  target.setHours(source.getHours(), source.getMinutes(), 0, 0)
  return target.getTime()
}

const pad = (value: number) => String(value).padStart(2, '0')

export const formatClock = (at: number) => {
  const date = new Date(at)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 如“10月20日 周二” */
export const formatDay = (at: number) => {
  const date = new Date(at)
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`
}

/** 推荐时段的按钮文字，今天、明天用简称 */
export const formatSuggestion = (start: number, end: number, now = Date.now()) => {
  const days = Math.round((startOfLocalDay(start) - startOfLocalDay(now)) / DAY)
  const day = days === 0 ? '今天' : days === 1 ? '明天' : formatDay(start)
  return `${day} ${formatClock(start)}–${formatClock(end)}`
}

/** 鼠标悬停在忙碌块上时的说明 */
export const describeBusy = (block: MeetingBusyBlock) => {
  const time = `${formatClock(block.start)}–${formatClock(block.end)}`
  return block.title
    ? `${BUSY_SOURCE_LABEL[block.source]} ${time}：${block.title}`
    : `${BUSY_SOURCE_LABEL[block.source]} ${time}（忙碌）`
}
