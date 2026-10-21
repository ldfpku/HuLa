import { defineStore } from 'pinia'
import { ImUrlEnum, StoresEnum } from '@/enums'
import { imRequestSilent } from '@/utils/ImRequestUtils'

/** 待开始、进行中可以加入；已结束、已取消不能 */
export type MeetingStatus = 'upcoming' | 'live' | 'ended' | 'cancelled'

/** 服务端算好的会议状态（mailflare meetingTiming），各端一致 */
export type MeetingStatusInfo = {
  id: string
  status: MeetingStatus
  startsAt: number
  endsAt: number
  /** 按时间最晚可加入的时刻（结束后还有 30 分钟宽限），已取消为 null */
  joinableUntil: number | null
  cancelledAt: number | null
  /** 状态下次可能变化的服务端时刻，到点再问一次；null 表示不会再变 */
  nextCheckAt: number | null
}

type MeetingStatusResponse = { serverNow: number; meetings: MeetingStatusInfo[] }

/** 一次最多问 50 个会议 */
const BATCH_SIZE = 50
/** 同一时刻渲染出来的卡片合成一次请求 */
const BATCH_DELAY = 50
/** 很久以后才开始的会议也隔几个小时再确认一次，免得漏掉取消推送 */
const MAX_RECHECK_DELAY = 6 * 60 * 60 * 1000
/** 请求失败后隔一会儿再试 */
const RETRY_DELAY = 60 * 1000
/** 窗口重新可见时，超过这么久没确认的会议重新确认 */
const STALE_AFTER = 60 * 1000

export const isMeetingClosed = (status?: MeetingStatus) => status === 'ended' || status === 'cancelled'

/**
 * 聊天里会议卡片的状态（待开始 / 进行中 / 已结束 / 已取消）。时间以服务端为准：
 * 卡片出现时批量查询，到服务端给的下一个变化时刻再查；发起人取消时服务端推送 meetingStatus，两端立即刷新。
 */
export const useMeetingStatusStore = defineStore(StoresEnum.MEETING_STATUS, () => {
  const statuses = reactive(new Map<string, MeetingStatusInfo>())
  /** 服务端时间减本机时间，用来把服务端时刻换成本机定时 */
  let clockOffset = 0
  const checkedAt = new Map<string, number>()
  const tracked = new Set<string>()
  const pending = new Set<string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  const statusOf = (id: string) => statuses.get(id)

  const schedule = (id: string, delay: number) => {
    const existing = timers.get(id)
    if (existing) clearTimeout(existing)
    timers.delete(id)
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id)
        queue(id)
      }, delay)
    )
  }

  /** 收到服务端的状态（查询结果或推送） */
  const apply = (info: MeetingStatusInfo) => {
    if (!info?.id || !info.status) return
    statuses.set(info.id, info)
    checkedAt.set(info.id, Date.now())
    if (info.nextCheckAt === null) {
      const existing = timers.get(info.id)
      if (existing) clearTimeout(existing)
      timers.delete(info.id)
      return
    }
    // 晚一秒再问，避开服务端恰好在边界上
    const delay = info.nextCheckAt - (Date.now() + clockOffset) + 1000
    schedule(info.id, Math.min(Math.max(delay, 1000), MAX_RECHECK_DELAY))
  }

  const flush = async () => {
    flushTimer = null
    const ids = [...pending]
    pending.clear()
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const chunk = ids.slice(i, i + BATCH_SIZE)
      const result = await imRequestSilent<MeetingStatusResponse>({
        url: ImUrlEnum.MEETING_STATUS,
        params: { ids: chunk.join(',') }
      })
      if (!result) {
        chunk.forEach((id) => schedule(id, RETRY_DELAY))
        continue
      }
      clockOffset = result.serverNow - Date.now()
      result.meetings.forEach(apply)
    }
  }

  const queue = (id: string) => {
    pending.add(id)
    if (!flushTimer) flushTimer = setTimeout(() => void flush(), BATCH_DELAY)
  }

  /** 会议卡片渲染时调用；同一个会议只查一次，之后靠定时和推送更新 */
  const track = (id: string) => {
    if (tracked.has(id)) return
    tracked.add(id)
    queue(id)
  }

  /** 入会被拒等情况下立刻重新确认 */
  const recheck = (id: string) => {
    tracked.add(id)
    queue(id)
  }

  /** 自己刚取消的会议不等推送，先显示已取消 */
  const markCancelled = (id: string) => {
    const now = Date.now() + clockOffset
    const known = statuses.get(id)
    apply({
      id,
      status: 'cancelled',
      startsAt: known?.startsAt ?? now,
      endsAt: known?.endsAt ?? now,
      joinableUntil: null,
      cancelledAt: now,
      nextCheckAt: null
    })
  }

  // 电脑睡眠或断网期间可能错过推送：窗口回到前台时，把还会变化的会议重新确认一遍
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      for (const id of tracked) {
        if (isMeetingClosed(statuses.get(id)?.status)) continue
        if (now - (checkedAt.get(id) ?? 0) > STALE_AFTER) queue(id)
      }
    })
  }

  return { statusOf, track, recheck, apply, markCancelled }
})
