import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { info, warn } from '@tauri-apps/plugin-log'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RTCCallStatus } from '@/enums'
import type { SmjControlMessage } from '@/hooks/useWebRtc'
import { isDesktop, isWeb } from '@/utils/PlatformConstants'
import { type RemoteInput, sameAspect } from '@/utils/RemoteControlUtils'

/**
 * 一对一通话里的远程控制。消息都走通话的数据通道（点对点，DTLS 加密，不经服务器）：
 * - caps：通道打开时互相告知能否被控制（桌面版 controllable，网页版 controller）
 * - rc-request：控制方请求；rc-grant / rc-deny：被控方答复；rc-stop：任意一方结束
 * - rc-input：控制方的鼠标键盘输入，只有被控方同意后的会话里才会注入
 * 被控方在通话窗口的确认卡片上点“同意并共享屏幕”，这一下点击直接弹出屏幕选择；共享了整个主屏后
 * 才请 Rust 开始会话（remote_control_request，显示红色提示条），核对是主屏再调用 remote_control_activate
 * 放行输入。Rust 侧没有已放行的会话时拒绝注入，所以同意之前对方无法操作本机。
 * 会话期间每 2 秒给 Rust 发心跳，通话窗口卡住时 Rust 会自己结束会话。
 */
export type RemoteControlRole = 'idle' | 'requesting' | 'controlling'

export interface RemoteControlRtc {
  connectionStatus: Ref<RTCCallStatus | undefined>
  isControlChannelOpen: Ref<boolean>
  isScreenSharing: Ref<boolean>
  isRemoteScreenSharing: Ref<boolean>
  localScreenStream: Ref<MediaStream | null>
  startScreenShare: (options?: { monitorOnly?: boolean }) => Promise<boolean | undefined>
  stopScreenShare: () => Promise<boolean>
  sendControlMessage: (message: SmjControlMessage) => boolean
  sendInputMessage: (message: SmjControlMessage) => boolean
  onControlMessage: (type: string, handler: (message: SmjControlMessage) => void) => () => void
}

type PeerCaps = 'controllable' | 'controller'
type DenyReason = 'rejected' | 'web' | 'busy' | 'monitor' | 'not-primary' | 'error'

/** 被控方等本人同意并选好屏幕的时限，超时由被控方取消并通知控制方 */
const CONSENT_TIMEOUT = 60 * 1000
/** 控制方的兜底时限：比被控方多留 15 秒，正常情况下总是被控方先超时、两边提示一致 */
const REQUEST_TIMEOUT = CONSENT_TIMEOUT + 15 * 1000
const HEARTBEAT_INTERVAL = 2000

// 只给自动化测试用：带 VITE_SMJ_RC_E2E=1 构建时，网页可以假装成被控端（Rust 命令由测试脚本替身），正式构建里这段会被去掉
const isE2eControllable = () => {
  if (import.meta.env.VITE_SMJ_RC_E2E !== '1') return false
  try {
    return localStorage.getItem('smj-rc-e2e') === 'controllable'
  } catch {
    return false
  }
}

export const useRemoteControl = (rtc: RemoteControlRtc, peerName: () => string) => {
  const { t } = useI18n()
  // 本机能不能被控制：只有桌面版能向系统注入鼠标键盘
  const canBeControlled = (isDesktop() && !isWeb()) || isE2eControllable()

  /** 控制方状态 */
  const controlRole = ref<RemoteControlRole>('idle')
  /** 被控方：是否正在被对方控制 */
  const isBeingControlled = ref(false)
  /** 对方的能力，undefined 表示对方客户端没有远程控制（旧版） */
  const peerCaps = ref<PeerCaps>()
  let requestTimer: ReturnType<typeof setTimeout> | null = null
  /** 被控方：对方请求了控制，通话窗口显示确认卡片，等本人同意并共享屏幕 */
  const awaitingShare = ref(false)
  /** 被控方：正在弹屏幕选择、开始会话 */
  const sharing = ref(false)
  /** 确认卡片上的提示（没选整个屏幕、不是主屏），本人可重选 */
  const shareError = ref('')
  let consentTimer: ReturnType<typeof setTimeout> | null = null
  /** 被控方：这路屏幕共享是为远程控制开的，控制结束时一起停掉；本人事先已在共享的不动 */
  let shareStartedForControl = false
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  const cleanups: Array<() => void> = []

  const send = (message: SmjControlMessage) => rtc.sendControlMessage(message)

  const clearRequestTimer = () => {
    if (requestTimer) clearTimeout(requestTimer)
    requestTimer = null
  }

  // ---------- 控制方 ----------

  const requestControl = () => {
    if (controlRole.value !== 'idle') return
    if (rtc.connectionStatus.value !== RTCCallStatus.ACCEPT || !rtc.isControlChannelOpen.value) {
      window.$message.warning(t('message.call_window.rc_after_connected'))
      return
    }
    if (isBeingControlled.value) {
      window.$message.warning(t('message.call_window.rc_busy_self'))
      return
    }
    if (!peerCaps.value) {
      window.$message.warning(t('message.call_window.rc_peer_old'))
      return
    }
    if (peerCaps.value !== 'controllable') {
      window.$message.warning(t('message.call_window.rc_peer_web'))
      return
    }
    if (!send({ type: 'rc-request' })) {
      window.$message.warning(t('message.call_window.rc_after_connected'))
      return
    }
    controlRole.value = 'requesting'
    window.$message.info(t('message.call_window.rc_waiting'))
    requestTimer = setTimeout(() => {
      if (controlRole.value !== 'requesting') return
      controlRole.value = 'idle'
      send({ type: 'rc-stop' })
      window.$message.warning(t('message.call_window.rc_timeout'))
    }, REQUEST_TIMEOUT)
  }

  /** 控制方结束控制或取消请求 */
  const stopControlling = (notifyPeer = true) => {
    clearRequestTimer()
    if (controlRole.value === 'idle') return
    controlRole.value = 'idle'
    if (notifyPeer) send({ type: 'rc-stop' })
  }

  const sendInput = (input: RemoteInput) => {
    if (controlRole.value !== 'controlling') return false
    const message = { type: 'rc-input', input }
    // 鼠标移动可以丢，走无序通道；按键、点击必须到达且有序
    return input.kind === 'move' ? rtc.sendInputMessage(message) : rtc.sendControlMessage(message)
  }

  const denyText = (reason: DenyReason | undefined, detail?: string) => {
    switch (reason) {
      case 'web':
        return t('message.call_window.rc_peer_web')
      case 'busy':
        return t('message.call_window.rc_peer_busy')
      case 'monitor':
        return t('message.call_window.rc_peer_monitor')
      case 'not-primary':
        return t('message.call_window.rc_peer_not_primary', { detail: detail || '' })
      case 'error':
        return t('message.call_window.rc_peer_error', { detail: detail || '' })
      default:
        return t('message.call_window.rc_rejected')
    }
  }

  // ---------- 被控方 ----------

  const deny = (reason: DenyReason, detail?: string) => send({ type: 'rc-deny', reason, detail })

  const stopHeartbeat = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }

  /** 会话期间给 Rust 发心跳；Rust 那边会话已不在（超时、紧急退出）时本地也结束 */
  const startHeartbeat = () => {
    stopHeartbeat()
    heartbeatTimer = setInterval(() => {
      invoke<boolean>('remote_control_heartbeat')
        .then((alive) => {
          if (alive) return
          stopHeartbeat()
          if (isBeingControlled.value) void stopBeingControlled()
          else void cancelPendingShare()
        })
        .catch(() => {})
    }, HEARTBEAT_INTERVAL)
  }

  /** 停掉为远程控制开启的屏幕共享 */
  const stopControlShare = async () => {
    if (!shareStartedForControl) return
    shareStartedForControl = false
    await rtc.stopScreenShare()
  }

  const clearConsentTimer = () => {
    if (consentTimer) clearTimeout(consentTimer)
    consentTimer = null
  }

  /** 对方请求控制：在通话窗口里显示确认卡片，由本人点“同意并共享屏幕” */
  const handleRequest = () => {
    if (!canBeControlled) {
      deny('web')
      return
    }
    if (isBeingControlled.value || awaitingShare.value || controlRole.value !== 'idle') {
      deny('busy')
      return
    }
    // 通话没接通（或已结束）不显示确认
    if (rtc.connectionStatus.value !== RTCCallStatus.ACCEPT) {
      deny('error', t('message.call_window.rc_after_connected'))
      return
    }
    info('远程控制：收到请求，等本人在通话窗口同意并共享屏幕')
    shareError.value = ''
    awaitingShare.value = true
    send({ type: 'rc-pending' })
    // 等待同意期间本机按 Esc 即拒绝：Rust 监听全局按键（窗口没有焦点也有效），通话窗口里的按键另见下方
    invoke('remote_control_prepare').catch((e) => warn(`远程控制 Esc 监听启动失败: ${String(e)}`))
    clearConsentTimer()
    consentTimer = setTimeout(() => {
      info('远程控制：本人一直没有同意，取消请求')
      void cancelPendingShare()
    }, CONSENT_TIMEOUT)
  }

  /** 卡片上选的不是整个主屏：停掉为控制开的共享，留在卡片上请本人重选 */
  const askAgain = async (message: string) => {
    await stopControlShare()
    shareError.value = message
    sharing.value = false
  }

  /**
   * 本人在确认卡片上点“同意并共享屏幕”：这一下点击本身就是页面里的用户操作，直接弹出屏幕选择；
   * 共享了整个主屏后才请 Rust 开始会话（显示红色提示条）并放行输入
   */
  const shareAndGrant = async (event?: Event) => {
    if (!awaitingShare.value || sharing.value) return
    // 只认本人真实的点击（对方在同意前无法向本机注入任何输入）
    if (event && !event.isTrusted) return
    if (rtc.connectionStatus.value !== RTCCallStatus.ACCEPT) {
      void cancelPendingShare(false)
      return
    }
    sharing.value = true
    shareError.value = ''
    info('远程控制：本人同意，开始选择要共享的屏幕')
    // 控制要看到整个屏幕：正在共享窗口或标签页时先停掉，再请本人选整个屏幕
    const currentSurface = (
      rtc.localScreenStream.value?.getVideoTracks()[0]?.getSettings() as
        | (MediaTrackSettings & { displaySurface?: string })
        | undefined
    )?.displaySurface
    if (rtc.isScreenSharing.value && currentSurface && currentSurface !== 'monitor') {
      await rtc.stopScreenShare()
    }
    if (!rtc.isScreenSharing.value) {
      const shared = await rtc.startScreenShare({ monitorOnly: true })
      if (!shared) {
        info('远程控制：没有共享整个屏幕，请本人重选')
        await askAgain(t('message.call_window.rc_share_retry'))
        return
      }
      // 这路共享是为控制开的，控制结束时停掉
      shareStartedForControl = true
    }
    // 选择屏幕期间对方可能已挂断或取消
    if (!awaitingShare.value || rtc.connectionStatus.value !== RTCCallStatus.ACCEPT) {
      sharing.value = false
      await stopControlShare()
      return
    }
    let grant: { granted: boolean; width: number; height: number }
    try {
      grant = await invoke('remote_control_request', { peerName: peerName() })
    } catch (e) {
      warn(`远程控制开始失败: ${String(e)}`)
      sharing.value = false
      awaitingShare.value = false
      clearConsentTimer()
      await stopControlShare()
      window.$message.error(String(e))
      deny('error', String(e))
      return
    }
    startHeartbeat()
    const settings = rtc.localScreenStream.value?.getVideoTracks()[0]?.getSettings()
    const sharedSize = { width: settings?.width ?? 0, height: settings?.height ?? 0 }
    if (!sameAspect(sharedSize, grant)) {
      // 宽高比和主屏不同，说明共享的是另一块屏幕，点击位置会错，只支持主屏
      info(`远程控制：共享的不是主屏 ${sharedSize.width}x${sharedSize.height} / ${grant.width}x${grant.height}`)
      stopHeartbeat()
      await invoke('remote_control_stop').catch(() => {})
      await askAgain(t('message.call_window.rc_share_not_primary'))
      return
    }
    // 共享就绪：请 Rust 放行输入
    try {
      await invoke('remote_control_activate')
    } catch (e) {
      warn(`远程控制放行失败: ${String(e)}`)
      stopHeartbeat()
      sharing.value = false
      awaitingShare.value = false
      clearConsentTimer()
      await stopControlShare()
      deny('error', String(e))
      return
    }
    sharing.value = false
    awaitingShare.value = false
    clearConsentTimer()
    isBeingControlled.value = true
    send({ type: 'rc-grant', width: sharedSize.width, height: sharedSize.height })
    info(`远程控制开始：共享画面 ${sharedSize.width}x${sharedSize.height}，主屏 ${grant.width}x${grant.height}`)
  }

  /** 本人在确认卡片上点了拒绝，或一直没同意 */
  const cancelPendingShare = async (notifyPeer = true) => {
    if (!awaitingShare.value) return
    awaitingShare.value = false
    sharing.value = false
    shareError.value = ''
    clearConsentTimer()
    stopHeartbeat()
    await invoke('remote_control_stop').catch(() => {})
    await stopControlShare()
    if (notifyPeer) deny('rejected')
  }

  /** 被控方结束：本机停止注入、通知对方，停掉为控制开启的共享 */
  const stopBeingControlled = async (notifyPeer = true) => {
    if (!isBeingControlled.value) return
    isBeingControlled.value = false
    stopHeartbeat()
    if (notifyPeer) send({ type: 'rc-stop' })
    await invoke('remote_control_stop').catch(() => {})
    await stopControlShare()
    window.$message.info(t('message.call_window.rc_ended'))
  }

  const handleInput = (message: SmjControlMessage) => {
    if (!isBeingControlled.value || !message.input) return
    invoke('remote_control_input', { input: message.input }).catch((e) => {
      // Rust 侧会话已结束（例如本人在提示条上点了停止）
      if (String(e).includes('未授权') || String(e).includes('已结束')) void stopBeingControlled()
    })
  }

  // ---------- 消息 ----------

  const sendCaps = () => send({ type: 'caps', remoteControl: canBeControlled ? 'controllable' : 'controller' })

  cleanups.push(
    rtc.onControlMessage('caps', (message) => {
      peerCaps.value = message.remoteControl === 'controllable' ? 'controllable' : 'controller'
    }),
    rtc.onControlMessage('rc-request', handleRequest),
    rtc.onControlMessage('rc-grant', () => {
      if (controlRole.value !== 'requesting') {
        // 已经取消了请求：让对方也结束
        send({ type: 'rc-stop' })
        return
      }
      clearRequestTimer()
      controlRole.value = 'controlling'
      window.$message.success(t('message.call_window.rc_granted'))
    }),
    rtc.onControlMessage('rc-pending', () => {
      if (controlRole.value !== 'requesting') return
      // 对方已同意、正在选择共享的屏幕，重新计时
      clearRequestTimer()
      requestTimer = setTimeout(() => {
        if (controlRole.value !== 'requesting') return
        controlRole.value = 'idle'
        send({ type: 'rc-stop' })
        window.$message.warning(t('message.call_window.rc_timeout'))
      }, REQUEST_TIMEOUT)
      window.$message.info(t('message.call_window.rc_pending'))
    }),
    rtc.onControlMessage('rc-deny', (message) => {
      if (controlRole.value !== 'requesting') return
      clearRequestTimer()
      controlRole.value = 'idle'
      window.$message.warning(denyText(message.reason as DenyReason, message.detail as string | undefined))
    }),
    rtc.onControlMessage('rc-stop', () => {
      if (controlRole.value !== 'idle') {
        const wasControlling = controlRole.value === 'controlling'
        stopControlling(false)
        if (wasControlling) window.$message.info(t('message.call_window.rc_ended'))
      }
      void cancelPendingShare(false)
      void stopBeingControlled(false)
    }),
    rtc.onControlMessage('rc-input', handleInput)
  )

  watch(
    rtc.isControlChannelOpen,
    (open) => {
      if (open) sendCaps()
      else peerCaps.value = undefined
    },
    { immediate: true }
  )

  // 被控方停止共享屏幕、通话断开，都结束控制
  watch(rtc.isScreenSharing, (sharing) => {
    if (!sharing) void stopBeingControlled()
  })
  watch(rtc.isRemoteScreenSharing, (sharing) => {
    if (!sharing && controlRole.value === 'controlling') {
      stopControlling(false)
      window.$message.info(t('message.call_window.rc_ended'))
    }
  })
  watch(rtc.connectionStatus, (status) => {
    if (status === RTCCallStatus.ACCEPT) return
    stopControlling(false)
    void cancelPendingShare(false)
    void stopBeingControlled(false)
  })

  // 本人在屏幕顶部提示条上点了“停止控制”，或通话窗口关闭时 Rust 结束了会话
  if (canBeControlled) {
    listen<string>('remote-control-stopped', (event) => {
      info(`远程控制已在本机结束: ${event.payload}`)
      if (event.payload === 'escape' && awaitingShare.value) {
        // 还在确认卡片阶段：按 Esc 就是拒绝
        void cancelPendingShare()
        return
      }
      // 本机按住 Esc 紧急退出：本人事先开的共享也一起停
      if (event.payload === 'escape') shareStartedForControl = true
      if (isBeingControlled.value) void stopBeingControlled()
      else if (!awaitingShare.value) void stopControlShare()
    })
      .then((unlisten) => cleanups.push(unlisten))
      .catch(() => {})
    // 确认卡片阶段通话窗口有焦点时，按 Esc 直接拒绝（不等全局监听）
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !event.isTrusted || !awaitingShare.value) return
      info('远程控制：确认卡片阶段本机按 Esc，拒绝请求')
      void cancelPendingShare()
    }
    window.addEventListener('keydown', onKeydown)
    cleanups.push(() => window.removeEventListener('keydown', onKeydown))
  }

  onUnmounted(() => {
    clearRequestTimer()
    clearConsentTimer()
    stopHeartbeat()
    if (isBeingControlled.value || awaitingShare.value) {
      isBeingControlled.value = false
      awaitingShare.value = false
      void invoke('remote_control_stop').catch(() => {})
      void stopControlShare()
    }
    cleanups.splice(0).forEach((fn) => fn())
  })

  return {
    canBeControlled,
    controlRole,
    isBeingControlled,
    awaitingShare,
    sharing,
    shareError,
    shareAndGrant,
    cancelPendingShare,
    peerCaps,
    requestControl,
    stopControlling,
    stopBeingControlled,
    sendInput
  }
}
