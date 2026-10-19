import { listen } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { error, info } from '@tauri-apps/plugin-log'
import { useI18n } from 'vue-i18n'
import { getRtcIceServers } from '@/utils/MeetingRequestUtils'
import { applyVideoTier, cameraConstraints, nextTier, readSendStats, type VideoTier } from '@/utils/RtcQualityUtils'
import { CallTypeEnum, RTCCallStatus } from '@/enums'
import rustWebSocketClient from '@/services/webSocketRust'
import { useUserStore } from '@/stores/user'
import { WsRequestMsgType, WsResponseMessageType } from '../services/wsType'
import { isMobile } from '../utils/PlatformConstants'
import { type BackgroundEffect, VideoBackgroundProcessor } from '../utils/videoBackground/VideoBackgroundProcessor'
import { type DeviceKind, useDevicePermission } from './useDevicePermission'
import { useMitt } from './useMitt'
import { useTauriListener } from './useTauriListener'

interface RtcMsgVO {
  roomId: string
  callType: CallTypeEnum
  callerId: string
  [key: string]: any
}

// 信令类型枚举
export enum SignalTypeEnum {
  JOIN = 'join',
  OFFER = 'offer',
  ANSWER = 'answer',
  CANDIDATE = 'candidate',
  LEAVE = 'leave'
}

export interface WSRtcCallMsg {
  // 房间ID
  roomId: string
  // 通话ID
  callerId: string
  // 信令类型
  signalType: SignalTypeEnum
  // 信令
  signal: string
  // 接收者ID列表
  receiverIds: string[]
  // 发送者ID
  senderId?: string
  // 通话状态
  status: RTCCallStatus
  // 是否是视频通话
  video: boolean
  // 目标uid
  targetUid: string
}

const MAX_TIME_OUT_SECONDS = 30

/**
 * 屏幕共享不靠重新协商：主叫在建连时就多开一路视频和一路音频收发器（初始不带轨道），
 * 共享时用 replaceTrack 把屏幕画面和系统声音放进去，停止时换回 null。
 * 这两路的 mid 随 offer/answer 的 smjScreen 字段告诉对方，旧版客户端会忽略这个字段。
 * 共享状态和以后的控制消息走一条双方预先约定 id 的数据通道（negotiated），不经过服务端。
 */
export const SMJ_CONTROL_CHANNEL_LABEL = 'smj-ctrl'
export const SMJ_CONTROL_CHANNEL_ID = 100
/** 远程控制的鼠标移动走另一条无序、不重传的通道，丢一帧不影响，也不会被前面的消息堵住 */
export const SMJ_INPUT_CHANNEL_LABEL = 'smj-input'
export const SMJ_INPUT_CHANNEL_ID = 101

interface ScreenMids {
  video?: string
  audio?: string
}

/** 控制通道里的消息，type 区分用途；remote-control 等后续功能复用同一通道 */
export interface SmjControlMessage {
  type: string
  [key: string]: unknown
}

type SignalWithScreen = RTCSessionDescriptionInit & { smjScreen?: ScreenMids | true }
// 服务端没配置 TURN 时的兜底：Cloudflare 公共 STUN，同一网络或普通 NAT 下可以直连
let configuration: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
  iceTransportPolicy: 'all'
}

// 每次通话向服务端要 Cloudflare Realtime TURN 的临时凭证，密钥只在服务端
const loadIceServers = async () => {
  try {
    const { iceServers } = await getRtcIceServers()
    if (Array.isArray(iceServers) && iceServers.length > 0) {
      configuration = { iceServers, iceTransportPolicy: 'all' }
      info(`ICE 配置已加载，共 ${iceServers.length} 组`)
    } else {
      info('ICE 配置为空，使用内置默认配置')
    }
  } catch (e) {
    error(`加载 ICE 配置失败: ${String(e)}`)
  }
}

// const settings = await getSettings()
// configuration.iceServers?.push(settings.ice_server)
// const isSupportScreenSharing = !!navigator?.mediaDevices?.getDisplayMedia
// TODO 改成动态配置
const rtcCallBellUrl = '/sound/hula_bell.mp3'

/**
 * webrtc 相关
 * @returns rtc 相关的状态和方法
 */
export const useWebRtc = (roomId: string, remoteUserId: string, callType: CallTypeEnum, isReceiver: boolean) => {
  const { addListener } = useTauriListener()

  const router = useRouter()

  info(`useWebRtc, roomId: ${roomId}, remoteUserId: ${remoteUserId}, callType: ${callType}, isReceiver: ${isReceiver}`)
  const rtcMsg = ref<Partial<RtcMsgVO>>({
    roomId: undefined,
    callType: undefined,
    callerId: undefined
  })
  const userStore = useUserStore()
  const { t } = useI18n()
  const { isPermissionDenied, resolveDeniedDeviceKind, openSystemSettings } = useDevicePermission()

  // 设备相关状态
  const audioDevices = ref<MediaDeviceInfo[]>([])
  const videoDevices = ref<MediaDeviceInfo[]>([])
  const selectedAudioDevice = ref<string | null | undefined>(null)
  const selectedVideoDevice = ref<string | null | undefined>(null)

  // 状态
  const connectionStatus = ref<RTCCallStatus | undefined>(undefined)
  const isDeviceLoad = ref(false)
  const deviceAccessError = ref<'permission' | 'unavailable' | undefined>(undefined)
  const isLinker = ref(false) // 判断是否是 webrtc 连接的参与者

  // rtc状态
  const rtcStatus = ref<RTCPeerConnectionState | undefined>(undefined)
  // const isRtcConnecting = computed(() => rtcStatus.value === 'connecting')
  // 流相关状态
  const localStream = ref<MediaStream | null>(null)
  const remoteStream = ref<MediaStream | null>(null)
  // WebRTC 连接对象
  const peerConnection = ref<RTCPeerConnection | null>(null)
  const channel = ref<RTCDataChannel | null>(null)
  const channelStatus = ref<RTCDataChannelState | undefined>(undefined)
  // 待发送ice列表
  const pendingCandidates = ref<RTCIceCandidate[]>([])
  // 添加铃声相关状态
  const bellAudio = ref<HTMLAudioElement | null>(null)

  // 添加计时器引用
  const callTimer = ref<NodeJS.Timeout | null>(null)

  // 添加计时相关的变量
  const callDuration = ref(0)
  const animationFrameId = ref<number | null>(null)
  const startTime = ref<number>(0)

  // 屏幕共享相关状态
  const isScreenSharing = ref(false)
  // 本地正在共享的屏幕流（预览用）
  const localScreenStream = ref<MediaStream | null>(null)
  // 对方共享过来的屏幕画面和系统声音
  const remoteScreenStream = ref<MediaStream | null>(null)
  const isRemoteScreenSharing = ref(false)
  // 对方客户端是否支持接收屏幕共享（预留了共享轨道）
  const peerSupportsScreen = ref(false)
  const isScreenShareSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia
  let screenMids: ScreenMids = {}
  let screenSenders: { video?: RTCRtpSender; audio?: RTCRtpSender } = {}

  // 摄像头画质：默认 720p，带宽够时升到 1080p（见 RtcQualityUtils）
  let videoTier: VideoTier = 'hd'
  let videoQualityTimer: ReturnType<typeof setInterval> | null = null
  const cameraSender = () =>
    peerConnection.value
      ?.getSenders()
      .find((sender) => sender.track?.kind === 'video' && sender !== screenSenders.video)
  const applyCameraTier = async () => {
    const sender = cameraSender()
    if (!sender) return
    try {
      await applyVideoTier(sender, videoTier)
    } catch (e) {
      info(`设置视频编码参数失败: ${String(e)}`)
    }
  }
  const startVideoQuality = () => {
    stopVideoQuality()
    videoTier = 'hd'
    void applyCameraTier()
    let totals: { sent: number; lost: number } | undefined
    videoQualityTimer = setInterval(async () => {
      const sender = cameraSender()
      if (!sender) return
      const stats = readSendStats(await sender.getStats(), totals)
      totals = stats.totals
      const next = nextTier(videoTier, stats.availableBps, stats.lossRate)
      if (next === videoTier) return
      info(
        `视频画质切换: ${videoTier} -> ${next}（可用带宽 ${stats.availableBps ?? '未知'}，丢包 ${stats.lossRate.toFixed(3)}）`
      )
      videoTier = next
      await applyCameraTier()
    }, 4000)
  }
  const stopVideoQuality = () => {
    if (videoQualityTimer) clearInterval(videoQualityTimer)
    videoQualityTimer = null
  }
  // 对方是旧版客户端时退回到替换摄像头画面，停止共享时要换回来
  let replacedCameraTrack: MediaStreamTrack | null = null
  // 视频背景板：启用时 localStream 里是处理后的轨道，原始摄像头轨道留在 rawCameraTrack
  let backgroundProcessor: VideoBackgroundProcessor | null = null
  let rawCameraTrack: MediaStreamTrack | null = null
  let backgroundRequest = 0
  const isBackgroundLoading = ref(false)
  const controlChannel = ref<RTCDataChannel | null>(null)
  const isControlChannelOpen = ref(false)
  const inputChannel = ref<RTCDataChannel | null>(null)
  const controlHandlers = new Map<string, Set<(message: SmjControlMessage) => void>>()
  const offer = ref<SignalWithScreen>()

  // 接通后确保窗口聚焦显示
  const focusCurrentWindow = async () => {
    try {
      const currentWindow = getCurrentWebviewWindow()
      const visible = await currentWindow.isVisible()
      if (!visible) {
        await currentWindow.show()
      }
      const minimized = await currentWindow.isMinimized()
      if (minimized) {
        await currentWindow.unminimize()
      }
      await currentWindow.setFocus()
    } catch (e) {
      console.warn('设置窗口聚焦失败:', e)
    }
  }

  // 开始计时
  const startCallTimer = () => {
    // 获取高精度时间戳
    startTime.value = performance.now()
    const animate = (currentTime: number) => {
      // 计算已经过去的秒数
      const elapsed = Math.floor((currentTime - startTime.value) / 1000)
      callDuration.value = elapsed
      // 递归调用，形成动画循环
      animationFrameId.value = requestAnimationFrame(animate)
    }
    animationFrameId.value = requestAnimationFrame(animate) // 启动动画循环
  }

  // 停止计时
  const stopCallTimer = () => {
    if (animationFrameId.value) {
      cancelAnimationFrame(animationFrameId.value)
      animationFrameId.value = null
    }
    callDuration.value = 0
    startTime.value = 0
  }

  /**
   * 打开铃声
   */
  const startBell = () => {
    if (!rtcCallBellUrl) {
      console.log('rtc通话已经静音')
      bellAudio.value = null
      return
    }
    bellAudio.value = new Audio(rtcCallBellUrl)
    bellAudio.value!.loop = true
    bellAudio.value?.play?.()
  }

  /**
   * 发送通话请求
   */
  const sendCall = async () => {
    try {
      await rustWebSocketClient.sendMessage({
        type: WsRequestMsgType.VIDEO_CALL_REQUEST,
        data: {
          roomId: roomId,
          targetUid: remoteUserId,
          isVideo: callType === CallTypeEnum.VIDEO
        }
      })
    } catch (error) {
      console.error('发送通话请求失败:', error)
    }
  }

  /**
   * 关闭铃声
   */
  const stopBell = () => {
    bellAudio.value?.pause?.()
    bellAudio.value = null
  }

  const pauseBell = () => {
    bellAudio.value?.pause?.()
  }

  const playBell = () => {
    bellAudio.value?.play?.()
  }

  /**
   * 接听电话响应事件
   */
  const handleCallResponse = async (status: number) => {
    try {
      info('[收到通知] 接听电话响应事件')
      // 发送挂断消息
      sendRtcCall2VideoCallResponse(status)
      await endCall()
    } finally {
      clear()
    }
  }

  /**
   * 结束通话
   */
  const endCall = async () => {
    try {
      info('[收到通知] 结束通话')
      // 移动端router 回退
      if (!isMobile()) {
        await getCurrentWebviewWindow().close()
      } else {
        router.back()
      }
    } finally {
      clear()
    }
  }

  // 发送 ws 请求，通知双方通话状态
  // -1 = 超时 0 = 拒绝 1 = 接通 2 = 挂断
  const sendRtcCall2VideoCallResponse = async (status: number) => {
    try {
      info(`发送 ws 请求，通知双方通话状态 ${status}`)
      await rustWebSocketClient.sendMessage({
        type: WsRequestMsgType.VIDEO_CALL_RESPONSE,
        data: {
          callerUid: remoteUserId,
          roomId: roomId,
          accepted: status
        }
      })
    } catch (error) {
      console.error('发送通话响应失败:', error)
    }
  }

  /**
   * 权限被拒绝时给用户友好提示，并提供“打开系统设置”入口
   * @param kind 设备类型，决定提示文案与跳转的设置页
   * @param err 原始错误，用于判定是否为权限拒绝
   */
  const getRequiredDeviceKinds = (type: CallTypeEnum): DeviceKind[] => {
    return type === CallTypeEnum.VIDEO ? ['microphone', 'camera'] : ['microphone']
  }

  const getDeviceProbeConstraints = (type: CallTypeEnum): MediaStreamConstraints => {
    return {
      audio: true,
      video: type === CallTypeEnum.VIDEO
    }
  }

  const showDeviceUnavailableMessage = (kind: DeviceKind) => {
    const key = kind === 'camera' ? 'message.permission.camera.unavailable' : 'message.permission.mic.unavailable'
    window.$message.error(t(key))
  }

  const showPermissionDeniedMessage = (kind: DeviceKind, err?: unknown, onHangup?: () => void | Promise<void>) => {
    const titleKey = kind === 'camera' ? 'message.permission.camera.title' : 'message.permission.mic.title'
    const key = kind === 'camera' ? 'message.permission.camera.denied' : 'message.permission.mic.denied'
    window.$dialog.warning({
      title: t(titleKey),
      content: t(key),
      positiveText: t('message.permission.open_settings'),
      negativeText: t('message.permission.hangup'),
      onPositiveClick: () => {
        void openSystemSettings(kind)
        return false
      },
      onNegativeClick: () => {
        void onHangup?.()
      }
    })
    error(`设备权限被拒绝(${kind}): ${String(err ?? '')}`)
  }

  // 获取设备列表
  const getDevices = async (type: CallTypeEnum = callType, onPermissionHangup?: () => void | Promise<void>) => {
    try {
      info('start getDevices')
      isDeviceLoad.value = true
      deviceAccessError.value = undefined

      // 先请求权限以获取完整的设备信息
      try {
        const stream = await navigator.mediaDevices.getUserMedia(getDeviceProbeConstraints(type))
        stream.getTracks().forEach((track) => track.stop()) // 立即停止流
      } catch (permissionError) {
        // 权限被拒绝：提示用户并中止获取设备，避免在无权限情况下继续通话
        if (isPermissionDenied(permissionError)) {
          const kind = await resolveDeniedDeviceKind(getRequiredDeviceKinds(type))
          showPermissionDeniedMessage(kind, permissionError, onPermissionHangup)
          deviceAccessError.value = 'permission'
          isDeviceLoad.value = false
          return false
        }
        // 非权限问题（如设备暂不可用）：记录后继续用 enumerateDevices 兜底
        info(`getUserMedia 探针失败，将尝试获取受限设备信息: ${String(permissionError)}`)
      }

      const devices = (await navigator.mediaDevices.enumerateDevices()) || []
      info(`getDevices, devices: ${JSON.stringify(devices)}`)
      if (devices.length === 0) {
        deviceAccessError.value = 'unavailable'
        return false
      }
      audioDevices.value = devices.filter((device) => device.kind === 'audioinput')
      videoDevices.value = devices.filter((device) => device.kind === 'videoinput')
      if (audioDevices.value.length === 0) {
        showDeviceUnavailableMessage('microphone')
        deviceAccessError.value = 'unavailable'
        isDeviceLoad.value = false
        return false
      }
      if (type === CallTypeEnum.VIDEO && videoDevices.value.length === 0) {
        showDeviceUnavailableMessage('camera')
        deviceAccessError.value = 'unavailable'
        isDeviceLoad.value = false
        return false
      }
      // 默认选择 “default” | "第一个" 设备
      selectedAudioDevice.value =
        audioDevices.value.find((device) => device.deviceId === 'default')?.deviceId ||
        audioDevices.value?.[0]?.deviceId
      selectedVideoDevice.value =
        videoDevices.value.find((device) => device.deviceId === 'default')?.deviceId ||
        videoDevices.value?.[0]?.deviceId
      isDeviceLoad.value = false
      return true
    } catch (err) {
      if (deviceAccessError.value !== 'permission') {
        window.$message.error('获取设备失败!')
      }
      error(`获取设备失败: ${err}`)
      // 默认没有设备
      selectedAudioDevice.value = selectedAudioDevice.value || null
      selectedVideoDevice.value = selectedVideoDevice.value || null
      isDeviceLoad.value = false
      return false
    }
  }

  // 获取本地媒体流
  const getLocalStream = async (type: CallTypeEnum, onPermissionHangup?: () => void | Promise<void>) => {
    try {
      info('获取本地媒体流')
      const constraints = {
        audio: audioDevices.value.length > 0 ? { deviceId: selectedAudioDevice.value || undefined } : false,
        video:
          type === CallTypeEnum.VIDEO && videoDevices.value.length > 0
            ? cameraConstraints(selectedVideoDevice.value || undefined)
            : false
      }
      if (!constraints.audio && !constraints.video) {
        window.$message.error('没有可用的设备!')
        // 没有可用设备时自动挂断并关闭窗口
        setTimeout(async () => {
          if (isReceiver) {
            // 接听方：发送拒绝响应
            await handleCallResponse(0)
          } else {
            // 发起方：直接结束通话
            await handleCallResponse(2)
          }
        }, 1000)
        return false
      }
      localStream.value = await navigator.mediaDevices.getUserMedia(constraints)
      // 打印 localStream 的信息（不能直接序列号 stream，不然会返回null）
      info(`get localStream success`)
      info(`localStream.id: ${localStream.value?.id}`)
      info(`localStream.active: ${localStream.value?.active}`)
      info(`localStream.getTracks().length: ${localStream.value?.getTracks()?.length}`)
      // 打印每个轨道的信息
      localStream.value?.getTracks()?.forEach((track, index) => {
        info(`Track ${index}: kind=${track.kind}, label=${track.label}, enabled=${track.enabled}`)
      })

      const audioTrack = localStream.value.getAudioTracks()[0]
      if (audioTrack) {
        // 检查音频轨道是否真的在工作
        info(`Audio track enabled: ${audioTrack.enabled}`)
        info(`Audio track muted: ${audioTrack.muted}`)
        info(`Audio track readyState: ${audioTrack.readyState}`)

        // 强制启用音频轨道
        audioTrack.enabled = true
      }

      return true
    } catch (err) {
      console.error('获取本地流失败:', err)
      if (isPermissionDenied(err)) {
        // 权限拒绝：根据通话类型提示对应权限被拒
        const kind = await resolveDeniedDeviceKind(getRequiredDeviceKinds(type))
        showPermissionDeniedMessage(kind, err, onPermissionHangup)
        deviceAccessError.value = 'permission'
      } else {
        window.$message.error('获取本地媒体流失败，请检查设备!')
        error(`获取本地媒体流失败，请检查设备! ${err}`)
        await sendRtcCall2VideoCallResponse(2)
      }
      return false
    }
  }

  // 对方的屏幕轨道收进同一个流，每次换新对象让界面重新绑定
  const addRemoteScreenTrack = (track: MediaStreamTrack) => {
    const tracks = (remoteScreenStream.value?.getTracks() ?? []).filter((t) => t.kind !== track.kind)
    remoteScreenStream.value = new MediaStream([...tracks, track])
  }

  const dispatchControlMessage = (event: MessageEvent) => {
    let message: SmjControlMessage
    try {
      message = JSON.parse(String(event.data))
    } catch {
      return
    }
    if (!message || typeof message.type !== 'string') return
    if (message.type === 'screen') {
      isRemoteScreenSharing.value = message.sharing === true
    }
    controlHandlers.get(message.type)?.forEach((handler) => {
      try {
        handler(message)
      } catch (e) {
        console.error('控制消息处理失败:', e)
      }
    })
  }

  const setupControlChannel = (pc: RTCPeerConnection) => {
    const dc = pc.createDataChannel(SMJ_CONTROL_CHANNEL_LABEL, { negotiated: true, id: SMJ_CONTROL_CHANNEL_ID })
    dc.onopen = () => {
      isControlChannelOpen.value = true
      // 通道晚于共享建立（如接通瞬间就开始共享）时补发一次状态
      if (isScreenSharing.value) sendScreenState()
    }
    dc.onclose = () => {
      isControlChannelOpen.value = false
    }
    dc.onmessage = dispatchControlMessage
    dc.onerror = (event) => console.warn('控制通道出错:', event)
    controlChannel.value = dc

    const input = pc.createDataChannel(SMJ_INPUT_CHANNEL_LABEL, {
      negotiated: true,
      id: SMJ_INPUT_CHANNEL_ID,
      ordered: false,
      maxRetransmits: 0
    })
    input.onmessage = dispatchControlMessage
    inputChannel.value = input
  }

  /** 通过控制通道发消息给对方；通道未打开时返回 false */
  const sendControlMessage = (message: SmjControlMessage) => {
    const dc = controlChannel.value
    if (!dc || dc.readyState !== 'open') return false
    dc.send(JSON.stringify(message))
    return true
  }

  /** 发高频、可丢的消息（远程控制的鼠标移动）；输入通道没开时退回控制通道 */
  const sendInputMessage = (message: SmjControlMessage) => {
    const dc = inputChannel.value
    if (!dc || dc.readyState !== 'open') return sendControlMessage(message)
    dc.send(JSON.stringify(message))
    return true
  }

  /** 订阅对方发来的某类控制消息，返回取消订阅函数 */
  const onControlMessage = (type: string, handler: (message: SmjControlMessage) => void) => {
    if (!controlHandlers.has(type)) controlHandlers.set(type, new Set())
    controlHandlers.get(type)!.add(handler)
    return () => controlHandlers.get(type)?.delete(handler)
  }

  const sendScreenState = () => {
    const sharing = isScreenSharing.value
    sendControlMessage({
      type: 'screen',
      sharing,
      audio: sharing && !!localScreenStream.value?.getAudioTracks().length
    })
  }

  // 记下主叫预留的两路屏幕收发器的 mid（setLocalDescription 之后才有）
  const readLocalScreenMids = (pc: RTCPeerConnection): ScreenMids => {
    const mids: ScreenMids = {}
    for (const transceiver of pc.getTransceivers()) {
      if (transceiver.sender === screenSenders.video && transceiver.mid) mids.video = transceiver.mid
      if (transceiver.sender === screenSenders.audio && transceiver.mid) mids.audio = transceiver.mid
    }
    return mids
  }

  // 被叫：按 offer 里的 mid 找到屏幕收发器，改成双向，这样自己也能共享
  const claimScreenTransceivers = (pc: RTCPeerConnection) => {
    for (const transceiver of pc.getTransceivers()) {
      if (!transceiver.mid) continue
      if (transceiver.mid === screenMids.video || transceiver.mid === screenMids.audio) {
        transceiver.direction = 'sendrecv'
        if (transceiver.mid === screenMids.video) screenSenders.video = transceiver.sender
        else screenSenders.audio = transceiver.sender
      }
    }
  }

  // 创建 RTCPeerConnection
  const createPeerConnection = (roomId: string, isOfferer: boolean) => {
    try {
      const pc = new RTCPeerConnection(configuration)

      // 监听远程流
      pc.ontrack = (event) => {
        info('pc 监听到 ontrack 事件')
        const mid = event.transceiver?.mid
        if (mid && (mid === screenMids.video || mid === screenMids.audio)) {
          addRemoteScreenTrack(event.track)
          return
        }
        // 自己组装对方的音视频流：屏幕轨道和摄像头轨道在旧版客户端那里同属一个流，这里要分开
        const tracks = (remoteStream.value?.getTracks() ?? []).filter((t) => t.id !== event.track.id)
        remoteStream.value = new MediaStream([...tracks, event.track])
      }

      // 添加本地流
      info('添加本地流到 PC')
      if (localStream.value) {
        localStream.value.getTracks().forEach((track) => {
          localStream.value && pc.addTrack(track, localStream.value)
        })
      } else {
        console.warn('localStream 为 null，无法添加本地流到 PeerConnection')
      }

      // 主叫预留屏幕共享的收发器；被叫在收到 offer 后按 mid 认领对应的收发器
      if (isOfferer) {
        // 放进本地流：旧版被叫把收到的轨道都当作同一个流，不会因此丢掉通话声音
        const streams = localStream.value ? [localStream.value] : []
        const videoTransceiver = pc.addTransceiver('video', { direction: 'sendrecv', streams })
        const audioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv', streams })
        screenSenders = { video: videoTransceiver.sender, audio: audioTransceiver.sender }
      }
      setupControlChannel(pc)

      // 连接状态变化 "closed" | "connected" | "connecting" | "disconnected" | "failed" | "new";
      pc.onconnectionstatechange = (e) => {
        info(`RTC 连接状态变化: ${pc.connectionState}`)
        switch (pc.connectionState) {
          case 'new':
            info('RTC 连接新建')
            break
          case 'connecting':
            info('RTC 连接中')
            connectionStatus.value = RTCCallStatus.CALLING
            break
          case 'connected':
            info('RTC 连接成功')
            connectionStatus.value = RTCCallStatus.ACCEPT
            startCallTimer() // 开始计时
            startVideoQuality()
            // 接通后将窗口置顶展示并聚焦
            void focusCurrentWindow()
            break
          case 'disconnected':
            info('RTC 连接断开')
            connectionStatus.value = RTCCallStatus.END
            window.$message.error('RTC通讯连接失败!')
            setTimeout(async () => {
              await endCall()
            }, 500)
            break
          case 'closed':
            info('RTC 连接关闭')
            connectionStatus.value = RTCCallStatus.END
            setTimeout(async () => {
              await endCall()
            }, 500)
            break
          case 'failed':
            connectionStatus.value = RTCCallStatus.ERROR
            info('RTC 连接失败')
            window.$message.error('RTC通讯连接失败!')
            setTimeout(async () => {
              await endCall()
            }, 500)
            break
          default:
            info('RTC 连接状态变化: ', pc.connectionState)
            break
        }
        // @ts-expect-error
        rtcStatus.value = (e?.currentTarget?.connectionState || pc.connectionState) as RTCPeerConnectionState
      }
      // 创建信道
      channel.value = pc.createDataChannel('chat')
      channel.value.onopen = () => {
        // console.log("信道已打开");
      }
      channel.value.onmessage = (_event) => {
        // console.log("收到消息:", event.data);
      }
      channel.value.onerror = (event) => {
        console.warn('信道出错:', event)
      }
      channel.value.onclose = () => {
        // console.log("信道已关闭");
      }
      pc.onicecandidate = async (event) => {
        info('pc 监听到 onicecandidate 事件')
        if (event.candidate && roomId) {
          try {
            pendingCandidates.value.push(event.candidate)
          } catch (err) {
            console.error('发送ICE候选者出错:', err)
          }
        }
      }
      peerConnection.value = pc
    } catch (err) {
      console.error('创建 PeerConnection 失败:', err)
      connectionStatus.value = RTCCallStatus.ERROR
      throw err
    }
  }

  // 发起通话
  const startCall = async (roomId: string, type: CallTypeEnum, uidList?: string[]) => {
    try {
      if (!roomId) {
        return false
      }
      clear() // 清理资源
      if (!(await getDevices(type, endCall))) {
        if (deviceAccessError.value === 'permission') {
          return false
        }
        window.$message.error('获取设备失败!')
        // 获取设备失败时自动关闭窗口
        setTimeout(async () => {
          await handleCallResponse(0)
        }, 1000)
        return
      }
      // 保存通话信息
      rtcMsg.value = {
        roomId,
        callType: type,
        callerId: userStore.userInfo!.uid,
        uidList: uidList || []
      }
      isLinker.value = true // 标记是会话人
      // 设置30秒超时定时器
      callTimer.value = setTimeout(() => {
        if (connectionStatus.value === RTCCallStatus.CALLING) {
          window.$message.warning('通话无人接听，自动挂断')
          endCall()
        }
      }, MAX_TIME_OUT_SECONDS * 1000)

      if (!(await getLocalStream(type, endCall))) {
        if (deviceAccessError.value === 'permission') {
          return false
        }
        clear()
        // 获取本地媒体流失败时自动关闭窗口
        setTimeout(async () => {
          await endCall()
        }, 1000)
        return false
      }

      // 1. 创建 RTCPeerConnection
      createPeerConnection(roomId, true)
      // 创建并发送 offer
      const rtcOffer = await peerConnection.value!.createOffer()
      await peerConnection.value!.setLocalDescription(rtcOffer)
      screenMids = readLocalScreenMids(peerConnection.value!)
      offer.value = { type: rtcOffer.type, sdp: rtcOffer.sdp, smjScreen: screenMids }
      // 发起通话请求
      await sendCall()
      // 播放铃声
      startBell()

      // 开始通话
      connectionStatus.value = RTCCallStatus.CALLING
      rtcStatus.value = 'new'
    } catch (err) {
      console.error('开始通话失败:', err)
      window.$message.error('RTC通讯连接失败!')
      clear()
      return false
    }
  }

  // 发送SDP offer
  const sendOffer = async (offer: RTCSessionDescriptionInit) => {
    try {
      const signalData = {
        callerUid: userStore.userInfo!.uid,
        roomId: roomId,
        signal: JSON.stringify(offer),
        signalType: 'offer',
        targetUid: remoteUserId,
        video: callType === CallTypeEnum.VIDEO
      }

      info('ws发送 offer')
      await rustWebSocketClient.sendMessage({
        type: WsRequestMsgType.WEBRTC_SIGNAL,
        data: signalData
      })
    } catch (error) {
      console.error('Failed to send SDP offer:', error)
    }
  }

  const clear = () => {
    try {
      // 停止铃声并重置
      stopBell()
      // 清除超时定时器
      if (callTimer.value) {
        clearTimeout(callTimer.value)
        callTimer.value = null
      }
      // 停止计时器
      stopCallTimer()
      stopVideoQuality()
      // 关闭信道
      channel.value?.close?.()
      // 关闭连接
      peerConnection.value?.close?.()
      // 关闭媒体流
      localStream.value?.getTracks().forEach((track) => track.stop())
      remoteStream.value?.getTracks().forEach((track) => track.stop())
      localScreenStream.value?.getTracks().forEach((track) => track.stop())
      replacedCameraTrack?.stop()
      backgroundRequest++
      backgroundProcessor?.stop()
      backgroundProcessor = null
      rawCameraTrack?.stop()
      rawCameraTrack = null
      controlChannel.value?.close?.()
      inputChannel.value?.close?.()
    } catch (error) {
      window.$message.error('部分资源清理失败!')
      console.error('清理资源失败:', error)
    } finally {
      // 重置状态
      rtcMsg.value = {
        roomId: undefined,
        callType: undefined,
        senderId: undefined
      }
      pendingCandidates.value = []
      audioDevices.value = []
      videoDevices.value = []
      deviceAccessError.value = undefined
      selectedAudioDevice.value = null
      selectedVideoDevice.value = null
      localStream.value = null
      remoteStream.value = null
      connectionStatus.value = undefined
      rtcStatus.value = undefined
      isScreenSharing.value = false
      localScreenStream.value = null
      remoteScreenStream.value = null
      isRemoteScreenSharing.value = false
      peerSupportsScreen.value = false
      screenMids = {}
      screenSenders = {}
      replacedCameraTrack = null
      controlChannel.value = null
      inputChannel.value = null
      isControlChannelOpen.value = false
      isLinker.value = false
      // 关闭连接
      peerConnection.value = null
      channel.value = null
      channelStatus.value = undefined
    }
  }

  // 发送ICE候选者
  const sendIceCandidate = async (candidate: RTCIceCandidate) => {
    try {
      info('发送ICE候选者')
      const signalData = {
        roomId: roomId,
        signal: JSON.stringify(candidate),
        signalType: 'candidate',
        targetUid: remoteUserId,
        mediaType: callType === CallTypeEnum.VIDEO ? 'VideoSignal' : 'AudioSignal'
      }

      await rustWebSocketClient.sendMessage({
        type: WsRequestMsgType.WEBRTC_SIGNAL,
        data: signalData
      })
    } catch (error) {
      console.error('Failed to send ICE candidate:', error)
    }
  }

  // 处理收到的 offer - 接听者
  const handleOffer = async (signal: RTCSessionDescriptionInit, video: boolean, roomId: string) => {
    try {
      console.log('处理 offer')
      connectionStatus.value = RTCCallStatus.CALLING
      await nextTick()

      if (!(await getDevices(video ? CallTypeEnum.VIDEO : CallTypeEnum.AUDIO, handleCallResponse.bind(null, 0)))) {
        if (deviceAccessError.value === 'permission') {
          return false
        }
        await handleCallResponse(0)
        return false
      }
      const hasLocalStream = await getLocalStream(
        video ? CallTypeEnum.VIDEO : CallTypeEnum.AUDIO,
        handleCallResponse.bind(null, 0)
      )

      // 停止铃声
      stopBell()

      // 检查本地媒体流是否获取成功
      if (!hasLocalStream || !localStream.value) {
        if (deviceAccessError.value === 'permission') {
          return false
        }
        // 睡眠 3s
        await new Promise((resolve) => setTimeout(resolve, 3000))
        await handleCallResponse(0)
        return false
      }

      // 2. 创建 RTCPeerConnection
      await nextTick() // 等待一帧
      const offerScreen = (signal as SignalWithScreen).smjScreen
      screenMids = offerScreen && offerScreen !== true ? offerScreen : {}
      peerSupportsScreen.value = !!screenMids.video
      createPeerConnection(roomId, false)
      rtcStatus.value = 'new'

      // 3. 设置远程描述
      info('设置远程描述')
      await peerConnection.value!.setRemoteDescription({ type: signal.type, sdp: signal.sdp })
      claimScreenTransceivers(peerConnection.value!)

      // 4. 创建并发送 answer
      const rtcAnswer = await peerConnection.value!.createAnswer()
      await peerConnection.value!.setLocalDescription(rtcAnswer)
      const answer: SignalWithScreen = { type: rtcAnswer.type, sdp: rtcAnswer.sdp, smjScreen: true }

      if (!roomId) {
        window.$message.error('房间号不存在，请重新连接！')
        return false
      }

      isLinker.value = true // 标记是会话人
      // 6. 发送 answer 信令到远端
      await sendAnswer(answer)
      connectionStatus.value = RTCCallStatus.ACCEPT
      info('处理 offer 结束')
    } catch (e) {
      error(`处理 offer 失败: ${e}`)
      await endCall()
    }
  }

  // 发送SDP answer
  const sendAnswer = async (answer: RTCSessionDescriptionInit) => {
    try {
      const signalData = {
        callerUid: userStore.userInfo!.uid,
        roomId: roomId,
        signal: JSON.stringify(answer),
        signalType: SignalTypeEnum.ANSWER,
        targetUid: remoteUserId,
        video: callType === CallTypeEnum.VIDEO
      }

      console.log('发送SDP answer', signalData)
      await rustWebSocketClient.sendMessage({
        type: WsRequestMsgType.WEBRTC_SIGNAL,
        data: signalData
      })

      console.log('SDP answer sent via WebSocket:', answer)
    } catch (error) {
      console.error('Failed to send SDP answer:', error)
    }
  }

  const handleAnswer = async (answer: RTCSessionDescriptionInit, roomId: string) => {
    try {
      info('处理 answer 消息')
      if (peerConnection.value) {
        // 清除超时定时器
        if (callTimer.value) {
          clearTimeout(callTimer.value)
          callTimer.value = null
        }

        // 2. 停止铃声
        stopBell()

        // 3. 通知服务器通话已建立
        if (!isReceiver) {
          if (!roomId) {
            window.$message.error('房间号不存在，请重新连接！')
            await endCall()
            return
          }
          // 4. 发起者 - 设置远程描述
          console.log('发起者 - 设置远程描述', answer)
          peerSupportsScreen.value = (answer as SignalWithScreen).smjScreen === true
          await peerConnection.value.setRemoteDescription({ type: answer.type, sdp: answer.sdp })
        }
      }
    } catch (error) {
      console.error('处理 answer 失败:', error)
      connectionStatus.value = RTCCallStatus.ERROR
      await endCall()
    }
  }

  // 处理 ICE candidate
  const handleCandidate = async (signal: RTCIceCandidateInit) => {
    try {
      if (peerConnection.value && peerConnection.value.remoteDescription) {
        info('添加 candidate')
        await peerConnection.value!.addIceCandidate(signal)
      }
    } catch (error) {
      console.error('处理 candidate 失败:', error)
    }
  }

  // 视频轨道状态
  const isVideoEnabled = ref(callType === CallTypeEnum.VIDEO)

  // 切换静音
  const toggleMute = () => {
    if (localStream.value) {
      const audioTrack = localStream.value.getAudioTracks()[0]
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled
      }
    }
  }

  // 切换视频
  const toggleVideo = async () => {
    if (localStream.value) {
      const videoTrack = localStream.value.getVideoTracks()[0]
      if (videoTrack) {
        // 切换视频轨道的启用状态
        videoTrack.enabled = !videoTrack.enabled
        isVideoEnabled.value = videoTrack.enabled

        console.log(`视频轨道${videoTrack.enabled ? '开启' : '关闭'}`)

        // 如果是关闭视频，通知对方
        if (!videoTrack.enabled) {
          console.log('本地视频已关闭，对方将看不到视频')
        } else {
          console.log('本地视频已开启，对方可以看到视频')
        }
      } else if (callType === CallTypeEnum.VIDEO) {
        // 如果没有视频轨道但是视频通话，尝试重新获取
        try {
          const constraints = {
            audio: false,
            video: cameraConstraints(selectedVideoDevice.value || undefined)
          }

          const newStream = await navigator.mediaDevices.getUserMedia(constraints)
          const newVideoTrack = newStream.getVideoTracks()[0]

          if (newVideoTrack && peerConnection.value) {
            // 添加新的视频轨道
            peerConnection.value.addTrack(newVideoTrack, localStream.value!)
            localStream.value!.addTrack(newVideoTrack)
            isVideoEnabled.value = true

            console.log('重新获取视频轨道成功')
          }
        } catch (error) {
          console.error('重新获取视频轨道失败:', error)
          window.$message.error('无法开启摄像头')
        }
      }
    }
  }

  // 切换音频设备
  const switchAudioDevice = async (deviceId: string) => {
    try {
      selectedAudioDevice.value = deviceId
      if (localStream.value) {
        const newStream = await navigator?.mediaDevices?.getUserMedia({
          audio: { deviceId: { exact: deviceId } },
          video:
            rtcMsg.value.callType === CallTypeEnum.VIDEO
              ? selectedVideoDevice.value
                ? { deviceId: { exact: selectedVideoDevice.value || undefined } }
                : false
              : false
        })
        // 替换现有轨道
        const newAudioTrack = newStream.getAudioTracks()[0]
        const oldAudioTrack = localStream.value.getAudioTracks()[0]

        if (newAudioTrack) {
          if (!oldAudioTrack) {
            localStream.value.addTrack(newAudioTrack)
            peerConnection.value?.addTrack(newAudioTrack, localStream.value)
            return
          }
          peerConnection.value?.getSenders().forEach((sender) => {
            if (sender.track && sender.track.kind === 'audio') {
              sender?.replaceTrack?.(newAudioTrack)
            }
          })
          oldAudioTrack && localStream.value.removeTrack(oldAudioTrack)
          localStream.value.addTrack(newAudioTrack)
        } else {
          window.$message.error('切换设备不存在或不支持，请重新选择！')
        }
      }
    } catch (error) {
      window.$message.error('切换音频设备失败！')
      console.error('切换音频设备失败:', error)
    }
  }

  // 获取前置和后置摄像头设备
  const getFrontAndBackCameras = () => {
    const frontCamera = videoDevices.value.find(
      (device) =>
        device.label.toLowerCase().includes('front') ||
        device.label.toLowerCase().includes('前置') ||
        device.label.toLowerCase().includes('user')
    )

    const backCamera = videoDevices.value.find(
      (device) =>
        device.label.toLowerCase().includes('back') ||
        device.label.toLowerCase().includes('后置') ||
        device.label.toLowerCase().includes('environment') ||
        device.label.toLowerCase().includes('rear')
    )

    return { frontCamera, backCamera }
  }

  // 切换前置/后置摄像头（移动端专用）
  const switchCameraFacing = async () => {
    if (!isMobile) {
      console.warn('摄像头翻转功能仅在移动端可用')
      return
    }

    try {
      const { frontCamera, backCamera } = getFrontAndBackCameras()

      if (!frontCamera || !backCamera) {
        // 认不出前后摄像头（设备名不含 front/back）时，轮换到下一个摄像头
        const devices = videoDevices.value
        if (devices.length < 2) {
          window.$message.warning('没有可切换的摄像头')
          return
        }
        const index = devices.findIndex((device) => device.deviceId === selectedVideoDevice.value)
        await switchVideoDevice(devices[(index + 1) % devices.length].deviceId)
        return
      }

      // 如果能识别前置和后置摄像头，直接切换
      const currentDevice = selectedVideoDevice.value
      const targetDevice = currentDevice === frontCamera.deviceId ? backCamera : frontCamera
      await switchVideoDevice(targetDevice.deviceId)
    } catch (error) {
      window.$message.error('摄像头翻转失败！')
      console.error('摄像头翻转失败:', error)
    }
  }

  // 切换视频设备
  const switchVideoDevice = async (deviceId: string) => {
    try {
      // 前置校验
      selectedVideoDevice.value = deviceId
      if (localStream.value && localStream.value.getVideoTracks().length > 0) {
        const newStream = await navigator.mediaDevices.getUserMedia({
          audio: selectedAudioDevice.value ? { deviceId: { exact: selectedAudioDevice.value || undefined } } : false,
          video: cameraConstraints(deviceId, true)
        })

        // 替换现有轨道
        const newVideoTrack = newStream.getVideoTracks()[0]
        const oldVideoTrack = localStream.value.getVideoTracks()[0]
        // console.log(oldVideoTrack, newVideoTrack);

        // 背景板开着：只换处理器的输入，发出去的轨道不变
        if (newVideoTrack && backgroundProcessor && rawCameraTrack) {
          await backgroundProcessor.setSource(newVideoTrack)
          rawCameraTrack.stop()
          rawCameraTrack = newVideoTrack
          return
        }

        if (newVideoTrack) {
          if (!oldVideoTrack) {
            localStream.value.addTrack(newVideoTrack)
            peerConnection.value?.addTrack(newVideoTrack, localStream.value)
            return
          }
          peerConnection.value?.getSenders().forEach((sender) => {
            if (sender.track && sender.track.kind === 'video' && sender !== screenSenders.video) {
              void sender.replaceTrack(newVideoTrack).then(applyCameraTier)
            }
          })
          oldVideoTrack && localStream.value.removeTrack(oldVideoTrack)
          localStream.value.addTrack(newVideoTrack)
        } else {
          window.$message.error('切换设备不存在或不支持，请重新选择！')
        }
      }
    } catch (error) {
      window.$message.error('切换视频设备失败！')
      console.error('切换视频设备失败:', error)
    }
  }

  // 把本地视频轨道换成 next：对方那边用 replaceTrack，不用重新协商；本地预览换一个新的 MediaStream 触发刷新
  const swapLocalVideoTrack = async (next: MediaStreamTrack) => {
    const stream = localStream.value
    const current = stream?.getVideoTracks()[0]
    if (!stream || !current || current === next) return
    next.enabled = current.enabled
    if (replacedCameraTrack === current) {
      // 正在给旧版对方共享屏幕，摄像头发送通道被占用，停止共享时会换回这里
      replacedCameraTrack = next
    } else {
      const sender = peerConnection.value?.getSenders().find((s) => s.track === current)
      await sender?.replaceTrack(next)
    }
    localStream.value = new MediaStream([...stream.getAudioTracks(), next])
  }

  /**
   * 设置视频背景板。效果为 none 时换回原始摄像头画面并停掉处理器；
   * 第一次启用时要加载人像分割模型，期间 isBackgroundLoading 为 true。
   * 返回 false 表示没有视频轨道或请求已被后来的设置取代。
   */
  const applyVideoBackground = async (
    effect: BackgroundEffect,
    handlers?: { onDegrade?: () => void; onOverload?: () => void }
  ) => {
    const request = ++backgroundRequest
    if (effect.type === 'none') {
      isBackgroundLoading.value = false
      const processor = backgroundProcessor
      if (!processor) return true
      backgroundProcessor = null
      if (rawCameraTrack) await swapLocalVideoTrack(rawCameraTrack)
      rawCameraTrack = null
      processor.stop()
      return true
    }
    if (backgroundProcessor) {
      await backgroundProcessor.setEffect(effect)
      return true
    }
    const camera = localStream.value?.getVideoTracks()[0]
    if (!camera) return false
    const processor = new VideoBackgroundProcessor({
      assetsBase: `${import.meta.env.BASE_URL}video-bg/`,
      onDegrade: handlers?.onDegrade,
      onOverload: handlers?.onOverload
    })
    isBackgroundLoading.value = true
    try {
      await processor.setEffect(effect)
      const output = await processor.start(camera)
      if (!output) throw new Error('背景处理没有输出视频轨道')
      if (request !== backgroundRequest || localStream.value?.getVideoTracks()[0] !== camera) {
        processor.stop()
        return false
      }
      backgroundProcessor = processor
      rawCameraTrack = camera
      await swapLocalVideoTrack(output)
      info(`视频背景板已启用: ${effect.type}`)
      return true
    } catch (e) {
      processor.stop()
      error(`启用视频背景板失败: ${String(e)}`)
      throw e
    } finally {
      if (request === backgroundRequest) isBackgroundLoading.value = false
    }
  }

  // 停止屏幕共享：清空共享轨道，旧版对方则换回摄像头画面
  const stopScreenShare = async () => {
    if (!isScreenSharing.value) return false
    isScreenSharing.value = false
    const screen = localScreenStream.value
    localScreenStream.value = null
    try {
      if (replacedCameraTrack) {
        const sender = peerConnection.value?.getSenders().find((s) => s.track?.kind === 'video')
        await sender?.replaceTrack(replacedCameraTrack)
        replacedCameraTrack = null
      } else {
        await screenSenders.video?.replaceTrack(null)
        await screenSenders.audio?.replaceTrack(null)
      }
    } catch (e) {
      console.error('停止屏幕共享失败:', e)
    } finally {
      screen?.getTracks().forEach((track) => track.stop())
      sendScreenState()
    }
    return true
  }

  // 开始屏幕共享：浏览器弹出选择窗口，用户可选整个屏幕、窗口或标签页，并可勾选共享声音
  // monitorOnly：远程控制要求共享整个屏幕，选了窗口或标签页时放弃并返回 false
  const startScreenShare = async (options?: { monitorOnly?: boolean }) => {
    if (isScreenSharing.value) return true
    if (!isScreenShareSupported) {
      window.$message.warning(t('message.call_window.share_unsupported'))
      return false
    }
    const pc = peerConnection.value
    if (!pc || connectionStatus.value !== RTCCallStatus.ACCEPT) {
      window.$message.warning(t('message.call_window.share_after_connected'))
      return false
    }
    const cameraSender = pc.getSenders().find((s) => s.track?.kind === 'video')
    const canUseScreenTrack = peerSupportsScreen.value && !!screenSenders.video
    if (!canUseScreenTrack && !cameraSender) {
      window.$message.warning(t('message.call_window.share_peer_unsupported'))
      return false
    }
    const monitorOnly = options?.monitorOnly === true
    let screenStream: MediaStream
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 }, ...(monitorOnly ? { displaySurface: 'monitor' } : {}) },
        audio: true,
        // Chromium 系浏览器的扩展选项：允许共享系统声音、可在共享中切换标签页，不列出本页面自己
        systemAudio: 'include',
        surfaceSwitching: 'include',
        selfBrowserSurface: 'exclude'
      } as DisplayMediaStreamOptions)
    } catch (e: any) {
      if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') {
        window.$message.info(t('message.call_window.share_cancelled'))
      } else {
        error(`获取屏幕画面失败: ${String(e)}`)
        window.$message.error(t('message.call_window.share_failed'))
      }
      return false
    }
    const videoTrack = screenStream.getVideoTracks()[0]
    if (!videoTrack) {
      screenStream.getTracks().forEach((track) => track.stop())
      window.$message.error(t('message.call_window.share_failed'))
      return false
    }
    const surface = (videoTrack.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface
    if (monitorOnly && surface && surface !== 'monitor') {
      screenStream.getTracks().forEach((track) => track.stop())
      window.$message.warning(t('message.call_window.rc_need_monitor'))
      return false
    }
    // 文字和界面优先保清晰
    videoTrack.contentHint = 'detail'
    const audioTrack = screenStream.getAudioTracks()[0]
    try {
      if (canUseScreenTrack) {
        await screenSenders.video!.replaceTrack(videoTrack)
        if (audioTrack) await screenSenders.audio?.replaceTrack(audioTrack)
      } else {
        // 对方是旧版客户端：用屏幕画面替换摄像头画面，系统声音无法单独传
        replacedCameraTrack = cameraSender!.track
        await cameraSender!.replaceTrack(videoTrack)
      }
    } catch (e) {
      screenStream.getTracks().forEach((track) => track.stop())
      replacedCameraTrack = null
      error(`发送屏幕画面失败: ${String(e)}`)
      window.$message.error(t('message.call_window.share_failed'))
      return false
    }
    // 用户点浏览器自带的“停止共享”时
    videoTrack.onended = () => {
      if (isScreenSharing.value) {
        void stopScreenShare()
        window.$message.info(t('message.call_window.share_ended'))
      }
    }
    localScreenStream.value = screenStream
    isScreenSharing.value = true
    sendScreenState()
    return true
  }

  const lisendCandidate = async () => {
    if (!peerConnection.value) {
      return
    }

    info('第一次交换 ICE candidates...')
    if (pendingCandidates.value.length > 0) {
      pendingCandidates.value.forEach(async (candidate) => {
        await sendIceCandidate(candidate)
      })
    }

    pendingCandidates.value = []

    peerConnection.value.onicecandidate = async (event) => {
      if (event.candidate) {
        info('第二次交换 ICE candidates...')
        await sendIceCandidate(event.candidate)
      }
    }
  }

  // 处理接收到的信令消息
  const handleSignalMessage = async (data: WSRtcCallMsg) => {
    try {
      info('处理信令消息')
      const signal = JSON.parse(data.signal)

      switch (data.signalType) {
        case SignalTypeEnum.OFFER:
          await handleOffer(signal, true, roomId)
          await lisendCandidate()
          break

        case SignalTypeEnum.ANSWER:
          await handleAnswer(signal, roomId)
          // offer 发送 candidate
          await lisendCandidate()
          break

        case SignalTypeEnum.CANDIDATE:
          if (signal.candidate) {
            info('收到 candidate 信令')
            await handleCandidate(signal)
          }
          break

        default:
          console.log('未知信令类型:', data.signalType)
      }
    } catch (error) {
      console.error('处理信令消息错误:', error)
    }
  }

  // 监听 WebRTC 信令消息（注册并保存卸载函数）
  // useMitt.on(WsResponseMessageType.WEBRTC_SIGNAL, handleSignalMessage)
  void (async () => {
    await addListener(
      listen('ws-webrtc-signal', (event: any) => {
        info(`收到信令消息: ${JSON.stringify(event.payload)}`)
        handleSignalMessage(event.payload)
      }),
      `${roomId}-ws-webrtc-signal`
    )
    await addListener(
      listen('ws-call-accepted', (event: any) => {
        info(`通话被接受: ${JSON.stringify(event.payload)}`)
        // // 接受方，发送是否接受
        // info(`收到 CallAccepted'消息 ${isReceiver}`)
        if (!isReceiver) {
          sendOffer(offer.value!)
          // 对方接通后，主叫方窗口前置并聚焦
          void focusCurrentWindow()
        }
      }),
      `${roomId}-ws-call-accepted`
    )
    await addListener(
      listen('ws-room-closed', (event: any) => {
        info(`房间已关闭: ${JSON.stringify(event.payload)}`)
        endCall()
      }),
      `${roomId}-ws-room-closed`
    )
    await addListener(
      listen('ws-dropped', (_: any) => {
        endCall()
      }),
      `${roomId}-ws-dropped`
    )
    await addListener(
      listen('ws-call-rejected', (event: any) => {
        info(`通话被拒绝: ${JSON.stringify(event.payload)}`)
        endCall()
      }),
      `${roomId}-ws-call-rejected`
    )
    await addListener(
      listen('ws-cancel', (event: any) => {
        info(`已取消通话: ${JSON.stringify(event.payload)}`)
        endCall()
      }),
      `${roomId}-ws-cancel`
    )
    await addListener(
      listen('ws-timeout', (event: any) => {
        info(`已取消通话: ${JSON.stringify(event.payload)}`)
        endCall()
      }),
      `${roomId}-ws-timeout`
    )
  })()

  onMounted(async () => {
    await loadIceServers()
    if (!isReceiver) {
      console.log(`调用方发送${callType === CallTypeEnum.VIDEO ? '视频' : '语音'}通话请求`)
      await startCall(roomId, callType, [remoteUserId])
    }
  })

  onUnmounted(() => {
    // 移除 WebRTC 信令消息监听器
    useMitt.off(WsResponseMessageType.WEBRTC_SIGNAL, handleSignalMessage)
  })

  return {
    startCallTimer,
    stopScreenShare,
    startScreenShare,
    isScreenShareSupported,
    localScreenStream,
    remoteScreenStream,
    isRemoteScreenSharing,
    peerSupportsScreen,
    sendControlMessage,
    sendInputMessage,
    onControlMessage,
    isControlChannelOpen,
    applyVideoBackground,
    isBackgroundLoading,
    toggleVideo,
    switchVideoDevice,
    switchCameraFacing,
    switchAudioDevice,
    isScreenSharing,
    selectedVideoDevice,
    selectedAudioDevice,
    localStream,
    remoteStream,
    peerConnection,
    getLocalStream,
    startCall,
    handleCallResponse,
    callDuration,
    connectionStatus,
    toggleMute,
    sendRtcCall2VideoCallResponse,
    isVideoEnabled,
    stopBell,
    startBell,
    pauseBell,
    playBell
  }
}
