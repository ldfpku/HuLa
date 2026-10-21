import { describe, expect, it } from 'vitest'
import {
  cameraConstraints,
  formatVideoStreamStats,
  nextTier,
  orderCodecs,
  readSendStats,
  readVideoStreamStats,
  SCREEN_CODEC_ORDER,
  scaleFor,
  screenVideoConstraints
} from './RtcQualityUtils'

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

describe('screenVideoConstraints', () => {
  it('屏幕共享最高 2560×1600、30 帧', () => {
    expect(screenVideoConstraints()).toEqual({
      width: { max: 2560 },
      height: { max: 1600 },
      frameRate: { ideal: 30, max: 30 }
    })
  })
})

describe('orderCodecs', () => {
  const codecs = [
    { mimeType: 'video/VP8' },
    { mimeType: 'video/rtx' },
    { mimeType: 'video/H264' },
    { mimeType: 'video/VP9' },
    { mimeType: 'video/AV1' }
  ]
  it('VP9 排第一，其余保持相对顺序', () => {
    expect(orderCodecs(codecs, SCREEN_CODEC_ORDER)?.map((c) => c.mimeType)).toEqual([
      'video/VP9',
      'video/VP8',
      'video/H264',
      'video/rtx',
      'video/AV1'
    ])
  })
  it('不支持 VP9 或没有能力表时不调整', () => {
    expect(orderCodecs([{ mimeType: 'video/VP8' }], SCREEN_CODEC_ORDER)).toBeNull()
    expect(orderCodecs([], SCREEN_CODEC_ORDER)).toBeNull()
  })
})

describe('readVideoStreamStats', () => {
  const makeReport = (bytes: number) =>
    new Map<string, any>([
      ['c1', { id: 'c1', type: 'codec', mimeType: 'video/VP9' }],
      [
        'o1',
        {
          id: 'o1',
          type: 'outbound-rtp',
          kind: 'video',
          mid: '2',
          frameWidth: 2560,
          frameHeight: 1600,
          framesPerSecond: 24,
          bytesSent: bytes,
          codecId: 'c1',
          qualityLimitationReason: 'bandwidth'
        }
      ],
      ['o2', { id: 'o2', type: 'outbound-rtp', kind: 'video', mid: '1', frameWidth: 1280, bytesSent: 999 }],
      ['l', { id: 'l', type: 'local-candidate', candidateType: 'relay', relayProtocol: 'udp' }],
      ['r', { id: 'r', type: 'remote-candidate', candidateType: 'srflx' }],
      [
        'p',
        {
          id: 'p',
          type: 'candidate-pair',
          nominated: true,
          state: 'succeeded',
          localCandidateId: 'l',
          remoteCandidateId: 'r'
        }
      ]
    ]) as unknown as RTCStatsReport

  it('按 mid 取分辨率、帧率、编码、受限原因、码率和连接方式', () => {
    const first = readVideoStreamStats(makeReport(1_000_000), 'outbound', '2', undefined, 0)
    expect(first.stats.kbps).toBeUndefined()
    const second = readVideoStreamStats(makeReport(6_000_000), 'outbound', '2', first.bytes, 10)
    expect(second.stats).toEqual({
      width: 2560,
      height: 1600,
      fps: 24,
      kbps: 4000,
      codec: 'VP9',
      limitation: 'bandwidth'
    })
    expect(second.route).toBe('TURN 中继/udp')
    expect(formatVideoStreamStats('发屏幕', second.stats)).toBe('发屏幕 2560×1600 24fps 4000kbps VP9 受限:bandwidth')
  })
})
