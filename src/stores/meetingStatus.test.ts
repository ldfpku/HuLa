import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { imRequestSilent } = vi.hoisted(() => ({ imRequestSilent: vi.fn() }))
vi.mock('@/utils/ImRequestUtils', () => ({ imRequestSilent }))

import { ImUrlEnum } from '@/enums'
import { useMeetingStatusStore } from './meetingStatus'

const NOW = Date.parse('2026-10-20T10:50:00Z')
const info = (id: string, status: string, nextCheckAt: number | null) => ({
  id,
  status,
  startsAt: NOW - 600_000,
  endsAt: NOW + 3_000_000,
  joinableUntil: status === 'cancelled' ? null : NOW + 4_800_000,
  cancelledAt: status === 'cancelled' ? NOW : null,
  nextCheckAt
})

describe('会议卡片状态', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    setActivePinia(createPinia())
    imRequestSilent.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('同时出现的卡片合成一次查询，同一会议只查一次', async () => {
    imRequestSilent.mockResolvedValue({ serverNow: NOW, meetings: [info('a', 'live', null), info('b', 'ended', null)] })
    const store = useMeetingStatusStore()
    store.track('a')
    store.track('b')
    store.track('a')
    await vi.advanceTimersByTimeAsync(60)
    expect(imRequestSilent).toHaveBeenCalledTimes(1)
    expect(imRequestSilent).toHaveBeenCalledWith({ url: ImUrlEnum.MEETING_STATUS, params: { ids: 'a,b' } })
    expect(store.statusOf('a')?.status).toBe('live')
    expect(store.statusOf('b')?.status).toBe('ended')
    store.track('a')
    await vi.advanceTimersByTimeAsync(60)
    expect(imRequestSilent).toHaveBeenCalledTimes(1)
  })

  it('到服务端给的下一个变化时刻再查，按服务端时间换算', async () => {
    // 服务端比本机快 5 分钟：服务端 11:00 开始，本机 10:55 就该再查
    const skew = 300_000
    imRequestSilent.mockResolvedValueOnce({
      serverNow: NOW + skew,
      meetings: [info('a', 'upcoming', NOW + skew + 600_000)]
    })
    const store = useMeetingStatusStore()
    store.track('a')
    await vi.advanceTimersByTimeAsync(60)
    imRequestSilent.mockResolvedValueOnce({ serverNow: NOW + 600_000 + skew, meetings: [info('a', 'live', null)] })
    await vi.advanceTimersByTimeAsync(598_000)
    expect(imRequestSilent).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3_100)
    expect(imRequestSilent).toHaveBeenCalledTimes(2)
    expect(store.statusOf('a')?.status).toBe('live')
  })

  it('推送和自己取消立即生效，之后不再定时查询', async () => {
    imRequestSilent.mockResolvedValue({ serverNow: NOW, meetings: [info('a', 'upcoming', NOW + 600_000)] })
    const store = useMeetingStatusStore()
    store.track('a')
    await vi.advanceTimersByTimeAsync(60)
    store.apply(info('a', 'cancelled', null) as never)
    expect(store.statusOf('a')?.status).toBe('cancelled')
    await vi.advanceTimersByTimeAsync(700_000)
    expect(imRequestSilent).toHaveBeenCalledTimes(1)

    store.markCancelled('b')
    expect(store.statusOf('b')?.status).toBe('cancelled')
  })

  it('查询失败一分钟后重试', async () => {
    imRequestSilent.mockResolvedValueOnce(null)
    const store = useMeetingStatusStore()
    store.track('a')
    await vi.advanceTimersByTimeAsync(60)
    imRequestSilent.mockResolvedValueOnce({ serverNow: NOW, meetings: [info('a', 'live', null)] })
    await vi.advanceTimersByTimeAsync(60_100)
    expect(imRequestSilent).toHaveBeenCalledTimes(2)
    expect(store.statusOf('a')?.status).toBe('live')
  })
})
