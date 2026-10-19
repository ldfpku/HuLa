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
 * 被控方的同意由 Rust 弹出的系统确认框决定，Rust 侧没有同意过的会话时拒绝注入。
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

const REQUEST_TIMEOUT = 60 * 1000

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
  let handlingRequest = false
  /** 被控方：已在确认框同意，等本人点“开始共享” */
  const awaitingShare = ref(false)
  let pendingGrant: { granted: boolean; width: number; height: number } | null = null
  /** 被控方：这路屏幕共享是为远程控制开的，控制结束时一起停掉；本人事先已在共享的不动 */
  let shareStartedForControl = false
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

  /** 停掉为远程控制开启的屏幕共享 */
  const stopControlShare = async () => {
    if (!shareStartedForControl) return
    shareStartedForControl = false
    await rtc.stopScreenShare()
  }

  const handleRequest = async () => {
    if (!canBeControlled) {
      deny('web')
      return
    }
    if (isBeingControlled.value || awaitingShare.value || handlingRequest || controlRole.value !== 'idle') {
      deny('busy')
      return
    }
    handlingRequest = true
    try {
      let grant: { granted: boolean; width: number; height: number }
      try {
        grant = await invoke('remote_control_request', { peerName: peerName() })
      } catch (e) {
        warn(`远程控制确认失败: ${String(e)}`)
        window.$message.error(String(e))
        deny('error', String(e))
        return
      }
      if (!grant?.granted) {
        deny('rejected')
        return
      }
      // 对方可能在确认框弹出期间挂断或取消了
      if (rtc.connectionStatus.value !== RTCCallStatus.ACCEPT) {
        await invoke('remote_control_stop').catch(() => {})
        return
      }
      // 控制要看到整个屏幕：正在共享窗口或标签页时先停掉，再请本人选整个屏幕
      const currentSurface = (
        rtc.localScreenStream.value?.getVideoTracks()[0]?.getSettings() as
          | (MediaTrackSettings & { displaySurface?: string })
          | undefined
      )?.displaySurface
      if (rtc.isScreenSharing.value && currentSurface && currentSurface !== 'monitor') {
        await rtc.stopScreenShare()
      }
      // 换成的整屏共享是为控制开的，控制结束时停掉
      shareStartedForControl = !rtc.isScreenSharing.value
      pendingGrant = grant
      if (rtc.isScreenSharing.value || navigator.userActivation?.isActive) {
        await shareAndGrant()
      } else {
        // 浏览器内核要求共享屏幕由本人点击触发：确认框之后再请本人点一下“开始共享”
        awaitingShare.value = true
        send({ type: 'rc-pending' })
      }
    } finally {
      handlingRequest = false
    }
  }

  /** 已经同意：共享整个屏幕（需要时由本人点击触发），核对是主屏后开始接受控制 */
  const shareAndGrant = async () => {
    const grant = pendingGrant
    awaitingShare.value = false
    pendingGrant = null
    if (!grant) return
    const shared = rtc.isScreenSharing.value || (await rtc.startScreenShare({ monitorOnly: true }))
    if (!shared) {
      shareStartedForControl = false
      await invoke('remote_control_stop').catch(() => {})
      deny('monitor')
      return
    }
    const settings = rtc.localScreenStream.value?.getVideoTracks()[0]?.getSettings()
    const sharedSize = { width: settings?.width ?? 0, height: settings?.height ?? 0 }
    if (!sameAspect(sharedSize, grant)) {
      // 宽高比和主屏不同，说明共享的是另一块屏幕，点击位置会错，只支持主屏
      await invoke('remote_control_stop').catch(() => {})
      await stopControlShare()
      window.$message.warning(t('message.call_window.rc_need_primary'))
      deny('not-primary', `${sharedSize.width}x${sharedSize.height} / ${grant.width}x${grant.height}`)
      return
    }
    isBeingControlled.value = true
    send({ type: 'rc-grant', width: sharedSize.width, height: sharedSize.height })
    info(`远程控制开始：共享画面 ${sharedSize.width}x${sharedSize.height}，主屏 ${grant.width}x${grant.height}`)
  }

  /** 被控方在“开始共享”提示上点了取消 */
  const cancelPendingShare = async (notifyPeer = true) => {
    if (!awaitingShare.value) return
    awaitingShare.value = false
    pendingGrant = null
    shareStartedForControl = false
    await invoke('remote_control_stop').catch(() => {})
    if (notifyPeer) deny('rejected')
  }

  /** 被控方结束：本机停止注入、通知对方，停掉为控制开启的共享 */
  const stopBeingControlled = async (notifyPeer = true) => {
    if (!isBeingControlled.value) return
    isBeingControlled.value = false
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
    rtc.onControlMessage('rc-request', () => void handleRequest()),
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
    listen('remote-control-stopped', () => {
      if (isBeingControlled.value) void stopBeingControlled()
      else void cancelPendingShare()
    })
      .then((unlisten) => cleanups.push(unlisten))
      .catch(() => {})
  }

  onUnmounted(() => {
    clearRequestTimer()
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
    shareAndGrant,
    cancelPendingShare,
    peerCaps,
    requestControl,
    stopControlling,
    stopBeingControlled,
    sendInput
  }
}
