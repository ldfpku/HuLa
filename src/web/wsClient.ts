/**
 * 网页版 WebSocket 客户端：对应 src-tauri/src/websocket/client.rs
 * 协议相同：心跳 {"type":"2"}，回包 {"type":"3"}，收到聊天消息回 ACK（type 15），
 * 业务消息按类型转成与 Rust 端同名的 ws-* 事件
 */
import { refreshTokens, tokenStore, webConfig } from './imClient'

type Emit = (event: string, payload?: unknown) => void

const HEARTBEAT_INTERVAL = 9900
const HEARTBEAT_TIMEOUT = 15000
const RECONNECT_DELAY = 1000
const MAX_RECONNECT_DELAY = 30000

const EVENT_BY_TYPE: Record<string, string> = {
  loginQrCode: 'ws-login-qr-code',
  waitingAuthorize: 'ws-waiting-authorize',
  loginSuccess: 'ws-login-success',
  receiveMessage: 'ws-receive-message',
  msgRecall: 'ws-msg-recall',
  mailNew: 'ws-mail-new',
  msgMarkItem: 'ws-msg-mark-item',
  online: 'ws-online',
  offline: 'ws-offline',
  userStateChange: 'ws-user-state-change',
  notifyEvent: 'ws-request-notify-event',
  groupSetAdmin: 'ws-group-set-admin-success',
  newApply: 'ws-request-new-apply',
  requestApprovalFriend: 'ws-request-approval-friend',
  memberChange: 'ws-member-change',
  roomInfoChange: 'ws-room-info-change',
  myRoomInfoChange: 'ws-my-room-info-change',
  roomGroupNoticeMsg: 'ws-room-group-notice-msg',
  roomEditGroupNoticeMsg: 'ws-room-edit-group-notice-msg',
  roomDissolution: 'ws-room-dissolution',
  VideoCallRequest: 'ws-video-call-request',
  CallAccepted: 'ws-call-accepted',
  CallRejected: 'ws-call-rejected',
  RoomClosed: 'ws-room-closed',
  WEBRTC_SIGNAL: 'ws-webrtc-signal',
  JoinVideo: 'ws-join-video',
  LeaveVideo: 'ws-leave-video',
  DROPPED: 'ws-dropped',
  CANCEL: 'ws-cancel',
  TIMEOUT: 'ws-timeout',
  tokenExpired: 'ws-token-expired',
  invalidUser: 'ws-invalid-user',
  deleteFriend: 'ws-delete-friend',
  feedSendMsg: 'ws-feed-send-msg',
  feedNotify: 'ws-feed-notify'
}

export class WebSocketClient {
  private socket: WebSocket | null = null
  private state = 'DISCONNECTED'
  private clientId = ''
  private heartbeatTimer: number | undefined
  private reconnectTimer: number | undefined
  private lastPong = 0
  private attempts = 0
  private manualClose = false
  private pending: unknown[] = []

  constructor(private emit: Emit) {
    window.addEventListener('online', () => {
      if (this.state !== 'CONNECTED' && !this.manualClose) this.reconnectNow()
    })
  }

  getState() {
    return this.state
  }

  isConnected() {
    return this.state === 'CONNECTED'
  }

  async init(clientId: string) {
    this.clientId = clientId
    this.manualClose = false
    this.attempts = 0
    const previous = this.socket
    this.socket = null
    previous?.close()
    this.open(false)
  }

  disconnect() {
    this.manualClose = true
    this.clearTimers()
    this.socket?.close()
    this.socket = null
    this.setState('DISCONNECTED', false)
  }

  send(data: unknown) {
    if (this.socket && this.state === 'CONNECTED') this.socket.send(JSON.stringify(data))
    else this.pending.push(data)
  }

  reconnectNow() {
    this.manualClose = false
    this.attempts = 0
    this.socket?.close()
    this.open(true)
  }

  private setState(state: string, isReconnection: boolean) {
    this.state = state
    this.emit('websocket-event', { type: 'connectionStateChanged', state, isReconnection })
  }

  private clearTimers() {
    window.clearInterval(this.heartbeatTimer)
    window.clearTimeout(this.reconnectTimer)
  }

  private open(isReconnection: boolean) {
    this.clearTimers()
    const tokens = tokenStore.get()
    const url = new URL(webConfig.wsUrl)
    url.searchParams.set('clientId', this.clientId)
    if (tokens?.token) url.searchParams.set('Token', tokens.token)
    this.setState(isReconnection ? 'RECONNECTING' : 'CONNECTING', isReconnection)
    const socket = new WebSocket(url.toString())
    this.socket = socket
    socket.onopen = () => {
      if (socket !== this.socket) return
      this.attempts = 0
      this.lastPong = Date.now()
      this.setState('CONNECTED', isReconnection)
      for (const data of this.pending.splice(0)) socket.send(JSON.stringify(data))
      this.startHeartbeat(socket)
    }
    socket.onmessage = (event) => {
      if (socket !== this.socket) return
      this.handleMessage(String(event.data))
    }
    socket.onclose = () => {
      if (socket !== this.socket) return
      this.socket = null
      window.clearInterval(this.heartbeatTimer)
      if (this.manualClose) return
      this.setState('RECONNECTING', true)
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    const delay = Math.min(RECONNECT_DELAY * 2 ** this.attempts, MAX_RECONNECT_DELAY)
    this.attempts++
    this.reconnectTimer = window.setTimeout(() => this.open(true), delay)
  }

  private startHeartbeat(socket: WebSocket) {
    this.heartbeatTimer = window.setInterval(() => {
      if (Date.now() - this.lastPong > HEARTBEAT_TIMEOUT + HEARTBEAT_INTERVAL) {
        socket.close()
        return
      }
      socket.send(JSON.stringify({ type: '2' }))
    }, HEARTBEAT_INTERVAL)
  }

  private handleMessage(text: string) {
    let message: any
    try {
      message = JSON.parse(text)
    } catch {
      this.emit('websocket-event', { type: 'messageReceived', message: text })
      return
    }
    if (message?.type === '3') {
      this.lastPong = Date.now()
      this.emit('websocket-event', {
        type: 'heartbeatStatusChanged',
        health: { isHealthy: true, lastPongTime: this.lastPong, consecutiveFailures: 0 }
      })
      return
    }
    const type = String(message?.type ?? '')
    const data = message?.data
    if (type === 'receiveMessage' && data?.message?.id) {
      this.send({ type: '15', data: { msgId: data.message.id, timestamp: Date.now() } })
    }
    if (type === 'tokenExpired') {
      // 与桌面版不同，网页版自己刷新 token 后重连
      refreshTokens()
        .then(() => this.reconnectNow())
        .catch(() => this.emit('ws-token-expired', data))
    } else {
      this.emit(EVENT_BY_TYPE[type] ?? 'ws-unknown-message', EVENT_BY_TYPE[type] ? data : message)
    }
    this.emit('websocket-event', { type: 'messageReceived', message })
  }
}
