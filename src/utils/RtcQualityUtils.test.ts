import { describe, expect, it } from 'vitest'
import { cameraConstraints, nextTier, readSendStats, scaleFor } from './RtcQualityUtils'

describe('cameraConstraints', () => {
  it('按 1080p/30fps 采集，指定设备时可要求精确匹配', () => {
    expect(cameraConstraints()).toMatchObject({
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 }
    })
    expect(cameraConstraints('cam').deviceId).toBe('cam')
    expect(cameraConstraints('cam', true).deviceId).toEqual({ exact: 'cam' })
  })
})

describe('scaleFor', () => {
  it('720p 档把 1080p 采集缩到 720p，采集不高于 720p 时不缩', () => {
    expect(scaleFor('hd', 1080)).toBe(1.5)
    expect(scaleFor('hd', 720)).toBe(1)
    expect(scaleFor('hd', 480)).toBe(1)
    expect(scaleFor('fhd', 1080)).toBe(1)
  })
})

describe('nextTier', () => {
  it('带宽够且不丢包升 1080p，变差退回 720p，中间不动', () => {
    expect(nextTier('hd', 3_000_000, 0)).toBe('fhd')
    expect(nextTier('hd', 1_000_000, 0)).toBe('hd')
    expect(nextTier('fhd', 2_200_000, 0)).toBe('fhd')
    expect(nextTier('fhd', 1_500_000, 0)).toBe('hd')
    expect(nextTier('fhd', 9_000_000, 0.05)).toBe('hd')
    expect(nextTier('fhd', undefined, 0)).toBe('fhd')
  })
})

describe('readSendStats', () => {
  it('取选中候选对的可用带宽，丢包率按两次之间的增量算', () => {
    const report = (sent: number, lost: number) =>
      new Map<string, any>([
        ['p', { type: 'candidate-pair', nominated: true, availableOutgoingBitrate: 2_600_000 }],
        ['o', { type: 'outbound-rtp', kind: 'video', packetsSent: sent }],
        ['r', { type: 'remote-inbound-rtp', kind: 'video', packetsLost: lost }]
      ]) as unknown as RTCStatsReport
    const first = readSendStats(report(1000, 10))
    expect(first.availableBps).toBe(2_600_000)
    const second = readSendStats(report(2000, 60), first.totals)
    expect(second.lossRate).toBeCloseTo(0.05)
  })
})
