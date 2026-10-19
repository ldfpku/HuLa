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
