/**
 * 一对一视频通话的画质：摄像头按 1080p/30fps 采集，默认发 720p，
 * 网络带宽够时升到 1080p，变差时退回 720p；再差由浏览器自己降帧降分辨率。
 */

/** 摄像头采集约束；设备不支持时浏览器按最接近的取，不会失败 */
export const cameraConstraints = (deviceId?: string, exact = false): MediaTrackConstraints => ({
  ...(deviceId ? { deviceId: exact ? { exact: deviceId } : deviceId } : {}),
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  frameRate: { ideal: 30, max: 30 },
  aspectRatio: { ideal: 16 / 9 }
})

export type VideoTier = 'hd' | 'fhd'

/** 720p 与 1080p 的发送码率上限（bps） */
const TIER_BITRATE: Record<VideoTier, number> = { hd: 2_500_000, fhd: 4_500_000 }
/** 浏览器估出的上行带宽接近 720p 上限（没被网络卡住）就升 1080p，明显低于就退回；留出回差免得来回跳 */
const UPGRADE_BPS = 2_400_000
const DOWNGRADE_BPS = 2_000_000
/** 丢包率超过它就退回 720p */
const MAX_LOSS = 0.03

/** 按采集高度算出发 720p 要缩小多少倍；采集本来不高于 720p 时不缩 */
export const scaleFor = (tier: VideoTier, captureHeight: number): number =>
  tier === 'fhd' || !captureHeight || captureHeight <= 720 ? 1 : captureHeight / 720

/** 根据可用带宽和丢包率决定下一档 */
export const nextTier = (current: VideoTier, availableBps: number | undefined, lossRate: number): VideoTier => {
  if (lossRate > MAX_LOSS) return 'hd'
  if (availableBps === undefined) return current
  if (current === 'hd' && availableBps >= UPGRADE_BPS) return 'fhd'
  if (current === 'fhd' && availableBps < DOWNGRADE_BPS) return 'hd'
  return current
}

/** 把某一档的码率、缩放和降级策略写进摄像头的发送器 */
export const applyVideoTier = async (sender: RTCRtpSender, tier: VideoTier): Promise<void> => {
  const params = sender.getParameters()
  if (!params.encodings?.length) params.encodings = [{}]
  const height = sender.track?.getSettings().height ?? 0
  for (const encoding of params.encodings) {
    encoding.maxBitrate = TIER_BITRATE[tier]
    encoding.maxFramerate = 30
    encoding.scaleResolutionDownBy = scaleFor(tier, height)
    // 网络差时浏览器同时降帧率和分辨率，而不是只把画面糊掉
    ;(encoding as RTCRtpEncodingParameters & { priority?: RTCPriorityType }).priority = 'high'
  }
  ;(params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = 'balanced'
  await sender.setParameters(params)
}

/** 从摄像头发送器的 getStats 结果里取可用上行带宽和这段时间的丢包率 */
export const readSendStats = (
  report: RTCStatsReport,
  previous?: { sent: number; lost: number }
): { availableBps?: number; lossRate: number; totals: { sent: number; lost: number } } => {
  let availableBps: number | undefined
  let sent = 0
  let lost = 0
  report.forEach((stat: any) => {
    if (stat.type === 'candidate-pair' && stat.nominated && typeof stat.availableOutgoingBitrate === 'number') {
      availableBps = stat.availableOutgoingBitrate
    }
    if (stat.type === 'outbound-rtp' && stat.kind === 'video') sent += stat.packetsSent ?? 0
    if (stat.type === 'remote-inbound-rtp' && stat.kind === 'video') lost += stat.packetsLost ?? 0
  })
  const sentDelta = sent - (previous?.sent ?? 0)
  const lostDelta = lost - (previous?.lost ?? 0)
  const lossRate = sentDelta > 0 ? Math.max(0, lostDelta) / sentDelta : 0
  return { availableBps, lossRate, totals: { sent, lost } }
}

/**
 * 屏幕共享画质：按原生分辨率采集（超过 2560×1600 的屏幕缩到这个范围），最高 30 帧；
 * 发送时保分辨率（网络差先降帧率，字不糊），码率上限 8 Mbps。
 * 不设码率时浏览器对屏幕共享默认最高 2.5 Mbps，2K 屏上的文字会明显发糊。
 */
export const SCREEN_MAX_BITRATE = 8_000_000
export const screenVideoConstraints = (): MediaTrackConstraints => ({
  width: { max: 2560 },
  height: { max: 1600 },
  frameRate: { ideal: 30, max: 30 }
})

/** 把屏幕共享的码率、帧率和保分辨率策略写进发送器 */
export const applyScreenSendParams = async (sender: RTCRtpSender): Promise<void> => {
  const params = sender.getParameters()
  if (!params.encodings?.length) params.encodings = [{}]
  for (const encoding of params.encodings) {
    encoding.maxBitrate = SCREEN_MAX_BITRATE
    encoding.maxFramerate = 30
    encoding.scaleResolutionDownBy = 1
    ;(encoding as RTCRtpEncodingParameters & { priority?: RTCPriorityType }).priority = 'high'
  }
  ;(params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = 'maintain-resolution'
  await sender.setParameters(params)
}

/** 屏幕画面优先用的编码：VP9 对文字和界面比 VP8 清楚得多，同码率下差距明显；对方不支持时自动退回后面的 */
export const SCREEN_CODEC_ORDER = ['video/VP9', 'video/VP8', 'video/H264']

/**
 * 按 order 重排可用编码，没列出的（AV1、rtx、red 等）保持原顺序排在后面；
 * 返回 null 表示不需要调整（拿不到能力表或首选编码都不支持）
 */
export const orderCodecs = <T extends { mimeType: string }>(codecs: T[], order: string[]): T[] | null => {
  if (!codecs.length) return null
  const rank = (codec: T) => {
    const index = order.findIndex((mime) => mime.toLowerCase() === codec.mimeType.toLowerCase())
    return index === -1 ? order.length : index
  }
  if (!codecs.some((codec) => rank(codec) === 0)) return null
  return codecs
    .map((codec, index) => ({ codec, index }))
    .sort((a, b) => rank(a.codec) - rank(b.codec) || a.index - b.index)
    .map(({ codec }) => codec)
}

/** 让屏幕共享收发器优先协商 VP9；浏览器不支持 setCodecPreferences 时什么也不做 */
export const preferScreenCodecs = (transceiver: RTCRtpTransceiver): boolean => {
  if (typeof transceiver.setCodecPreferences !== 'function' || typeof RTCRtpReceiver?.getCapabilities !== 'function') {
    return false
  }
  const codecs = orderCodecs(RTCRtpReceiver.getCapabilities('video')?.codecs ?? [], SCREEN_CODEC_ORDER)
  if (!codecs) return false
  try {
    transceiver.setCodecPreferences(codecs)
    return true
  } catch {
    return false
  }
}

export type VideoStreamStats = {
  width?: number
  height?: number
  fps?: number
  kbps?: number
  codec?: string
  limitation?: string
}

/**
 * 从 getStats 结果里取一路视频（按 mid 选，发送用 outbound-rtp，接收用 inbound-rtp）的分辨率、帧率、码率、编码和受限原因，
 * 以及当前连接走的是直连还是 TURN 中继。previousBytes 是上一次的字节数，间隔 seconds 秒。
 */
export const readVideoStreamStats = (
  report: RTCStatsReport,
  direction: 'outbound' | 'inbound',
  mid: string | null | undefined,
  previousBytes: number | undefined,
  seconds: number
): { stats: VideoStreamStats; bytes: number; route?: string } => {
  const byId = new Map<string, any>()
  report.forEach((stat: any) => byId.set(stat.id, stat))
  let bytes = 0
  const stats: VideoStreamStats = {}
  let route: string | undefined
  report.forEach((stat: any) => {
    if (stat.type === `${direction}-rtp` && stat.kind === 'video' && (!mid || stat.mid === mid)) {
      bytes += (direction === 'outbound' ? stat.bytesSent : stat.bytesReceived) ?? 0
      if ((stat.frameWidth ?? 0) >= (stats.width ?? 0)) {
        stats.width = stat.frameWidth
        stats.height = stat.frameHeight
        stats.fps = stat.framesPerSecond
      }
      if (stat.qualityLimitationReason) stats.limitation = stat.qualityLimitationReason
      const codec = stat.codecId ? byId.get(stat.codecId) : undefined
      if (codec?.mimeType) stats.codec = String(codec.mimeType).replace(/^video\//i, '')
    }
    if (stat.type === 'candidate-pair' && stat.nominated && stat.state === 'succeeded') {
      const local = byId.get(stat.localCandidateId)
      const remote = byId.get(stat.remoteCandidateId)
      const relayed = local?.candidateType === 'relay' || remote?.candidateType === 'relay'
      route = `${relayed ? 'TURN 中继' : '直连'}/${local?.relayProtocol ?? local?.protocol ?? '?'}`
    }
  })
  if (previousBytes !== undefined && seconds > 0 && bytes >= previousBytes) {
    stats.kbps = Math.round(((bytes - previousBytes) * 8) / seconds / 1000)
  }
  return { stats, bytes, route }
}

/** 一路视频的统计写成一行日志 */
export const formatVideoStreamStats = (label: string, stats: VideoStreamStats): string => {
  if (!stats.width) return `${label} 无画面`
  const parts = [`${stats.width}×${stats.height}`, `${Math.round(stats.fps ?? 0)}fps`]
  if (stats.kbps !== undefined) parts.push(`${stats.kbps}kbps`)
  if (stats.codec) parts.push(stats.codec)
  if (stats.limitation && stats.limitation !== 'none') parts.push(`受限:${stats.limitation}`)
  return `${label} ${parts.join(' ')}`
}
