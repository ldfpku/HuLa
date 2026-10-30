/**
 * 网页版 WebSocket 客户端：对应 src-tauri/src/websocket/client.rs
 * 协议相同：心跳 {"type":"2"}，回包 {"type":"3"}，收到聊天消息回 ACK（type 15），
 * 业务消息按类型转成与 Rust 端同名的 ws-* 事件
 */
import { ImRequestError, refreshTokens, tokenStore, webConfig } from './imClient'

/**
 * 连接前用 token 换一张一次性 ticket（60 秒内有效，用一次即作废），
 * 地址里只带 ticket，不再带 token，代理和日志里留下的地址没有用处
 */
/** 服务端明确拒绝了这个 token（过期，或已被刷新轮换掉） */
export class TicketRefusedError extends Error {}

const requestSocketTicket = async (token: string): Promise<string> => {
  const response = await fetch(`${webConfig.baseUrl}/ws/ticket`, { method: 'POST', headers: { token } })
  const result = (await response.json()) as { code?: number; data?: { ticket?: string } }
  if (result?.code === 401 || result?.code === 406) throw new TicketRefusedError(`连接凭证被拒绝: ${result.code}`)
  if (result?.code !== 200 || !result.data?.ticket) throw new Error(`获取连接凭证失败: ${result?.code}`)
  return result.data.ticket
}

/**
 * 换不到 ticket 时重试一次；仍失败（例如服务端还没有 ticket 接口）返回 null，与桌面版一样退回 Token 参数。
 * token 被拒绝时不退回 Token 参数（同样会被拒），抛出 TicketRefusedError 让调用方先刷新 token
 */
export const fetchSocketTicket = async (
  token: string,
  request: (token: string) => Promise<string> = requestSocketTicket
): Promise<string | null> => {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await request(token)
    } catch (error) {
      if (error instanceof TicketRefusedError) throw error
      console.warn('[ws] 获取连接凭证失败', error)
    }
  }
  return null
}

type Emit = (event: string, payload?: unknown) => void

const HEARTBEAT_INTERVAL = 9900
const HEARTBEAT_TIMEOUT = 15000
const BACKGROUND_HEARTBEAT_TIMEOUT = 120000
const RECONNECT_DELAY = 1000
const MAX_RECONNECT_DELAY = 30000

const EVENT_BY_TYPE: Record<string, string> = {
  loginQrCode: 'ws-login-qr-code',
  waitingAuthorize: 'ws-waiting-authorize',
  loginSuccess: 'ws-login-success',
  receiveMessage: 'ws-receive-message',
  msgRecall: 'ws-msg-recall',
  msgFileDeleted: 'ws-msg-file-deleted',
  chatPurged: 'ws-chat-purged',
  meetingStatus: 'ws-meeting-status',
  mailNew: 'ws-mail-new',
  todoReminder: 'ws-todo-reminder',
  msgMarkItem: 'ws-msg-mark-item',
  online: 'ws-online',
  offline: 'ws-offline',
  presenceChanged: 'ws-presence-changed',
  userStateChange: 'ws-user-state-change',
  userProfileChange: 'ws-user-profile-change',
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
  /** 每次 open 加一，等 ticket 期间又发起了新连接或断开时，旧的那次作废 */
  private openSeq = 0
  /** 正在连接或已连上的那次所用的 token；没有进行中的连接时为 null */
  private activeToken: string | null = null

  constructor(private emit: Emit) {
    window.addEventListener('online', () => {
      if (this.state !== 'CONNECTED' && !this.manualClose) this.reconnectNow()
    })
    document.addEventListener('visibilitychange', () => this.sendVisibility())
  }

  getState() {
    return this.state
  }

  isConnected() {
    return this.state === 'CONNECTED'
  }

  async init(clientId: string) {
    // 页面加载时替身已经用同一登录连上（或正在连），登录流程再调一次时不必断开重连
    const token = tokenStore.get()?.token
    if (!this.manualClose && clientId === this.clientId && token && token === this.activeToken) return
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
    this.activeToken = null
    this.openSeq++
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
    // 先摘掉旧连接，它稍后触发的 onclose 不会再安排一次重连
    this.socket = null
    this.setState(isReconnection ? 'RECONNECTING' : 'CONNECTING', isReconnection)
    const seq = ++this.openSeq
    const token = tokenStore.get()?.token
    this.activeToken = token ?? null
    if (!token) {
      this.scheduleReconnect()
      return
    }
    void this.credential(token).then(
      ([param, value]) => {
        if (seq !== this.openSeq || this.manualClose) return
        this.connect(param, value, isReconnection)
      },
      (error) => {
        if (seq !== this.openSeq || this.manualClose) return
        console.warn('[ws] 连接凭证不可用', error)
        if (error instanceof ImRequestError && error.message.includes('请重新登录')) {
          // 登录已失效：退回登录页，不再重连
          this.emit('relogin')
          return
        }
        this.setState('RECONNECTING', true)
        this.scheduleReconnect()
      }
    )
  }

  /** 连接地址里带的鉴权参数：ticket，换不到时退回 Token；token 过期或已被轮换时先刷新再换一次 */
  private async credential(token: string): Promise<['ticket' | 'Token', string]> {
    try {
      const ticket = await fetchSocketTicket(token)
      return ticket ? ['ticket', ticket] : ['Token', token]
    } catch (error) {
      if (!(error instanceof TicketRefusedError)) throw error
    }
    // 别的请求已经刷新过就直接用新的
    const current = tokenStore.get()?.token
    const fresh = current && current !== token ? current : (await refreshTokens()).token
    const ticket = await fetchSocketTicket(fresh)
    return ticket ? ['ticket', ticket] : ['Token', fresh]
  }

  private connect(param: 'ticket' | 'Token', value: string, isReconnection: boolean) {
    const url = new URL(webConfig.wsUrl)
    url.searchParams.set('clientId', this.clientId)
    url.searchParams.set(param, value)
    const socket = new WebSocket(url.toString())
    this.socket = socket
    socket.onopen = () => {
      if (socket !== this.socket) return
      this.attempts = 0
      this.lastPong = Date.now()
      this.setState('CONNECTED', isReconnection)
      this.sendVisibility()
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

  private sendVisibility() {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    this.socket.send(JSON.stringify({ type: 'clientVisibility', background: document.visibilityState !== 'visible' }))
  }

  private scheduleReconnect() {
    const delay = Math.min(RECONNECT_DELAY * 2 ** this.attempts, MAX_RECONNECT_DELAY)
    this.attempts++
    this.reconnectTimer = window.setTimeout(() => this.open(true), delay)
  }

  private startHeartbeat(socket: WebSocket) {
    this.heartbeatTimer = window.setInterval(() => {
      const timeout = document.visibilityState === 'visible' ? HEARTBEAT_TIMEOUT : BACKGROUND_HEARTBEAT_TIMEOUT
      if (Date.now() - this.lastPong > timeout + HEARTBEAT_INTERVAL) {
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
