/**
 * 网页版的跨标签页通道：桌面版的窗口共用 Rust 里的一条 WebSocket，事件全局广播；
 * 网页版每个“窗口”是一个标签页，只有主窗口（home）连着 WebSocket。
 * - 事件（emit / emit_to）广播到同源的其他标签页
 * - 其他标签页的 ws_send_message 等命令转给主窗口执行
 */

type Message =
  | { kind: 'event'; from: string; fromLabel: string; event: string; payload: unknown; target?: string }
  | { kind: 'call'; from: string; id: string; cmd: string; args: unknown }
  | { kind: 'result'; to: string; id: string; result?: unknown; error?: string }

const tabId = Math.random().toString(36).slice(2)
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('smj-web-bridge')
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>()
let nextId = 0
/** 同一浏览器里开了两个主窗口时，只由持有锁的那个替别的标签页执行命令，避免消息发两遍 */
let isLeader = false

type Options = {
  label: string
  /** 在本标签页里派发事件（不再广播） */
  dispatch: (event: string, payload: unknown) => void
  /** 在本标签页里执行命令（主窗口用） */
  execute: (cmd: string, args: unknown) => Promise<unknown> | unknown
}

export const startBridge = ({ label, dispatch, execute }: Options) => {
  if (!channel) return
  if (label === 'home') {
    const locks = (navigator as any).locks
    if (locks?.request) void locks.request('smj-web-home', () => new Promise(() => (isLeader = true)))
    else isLeader = true
  }
  channel.onmessage = async ({ data }: MessageEvent<Message>) => {
    if (data.kind === 'event') {
      // 两个主窗口各连一条 WebSocket，各自收消息，互相转发会重复
      if (label === 'home' && data.fromLabel === 'home') return
      if (data.target && data.target !== label) return
      dispatch(data.event, data.payload)
    } else if (data.kind === 'call') {
      if (label !== 'home' || !isLeader) return
      try {
        channel.postMessage({ kind: 'result', to: data.from, id: data.id, result: await execute(data.cmd, data.args) })
      } catch (error) {
        channel.postMessage({ kind: 'result', to: data.from, id: data.id, error: String(error) })
      }
    } else if (data.kind === 'result' && data.to === tabId) {
      const call = pending.get(data.id)
      pending.delete(data.id)
      if (data.error === undefined) call?.resolve(data.result)
      else call?.reject(data.error)
    }
  }
}

export const broadcastEvent = (fromLabel: string, event: string, payload: unknown, target?: string) => {
  channel?.postMessage({ kind: 'event', from: tabId, fromLabel, event, payload, target })
}

/** 让主窗口执行命令；主窗口没打开时 10 秒后失败 */
export const callHome = (cmd: string, args: unknown) =>
  new Promise((resolve, reject) => {
    if (!channel) {
      reject('当前浏览器不支持跨标签页通信')
      return
    }
    const id = `${tabId}-${++nextId}`
    pending.set(id, { resolve, reject })
    channel.postMessage({ kind: 'call', from: tabId, id, cmd, args })
    setTimeout(() => {
      if (!pending.delete(id)) return
      reject('主窗口未打开，请先打开聊天主页')
    }, 10_000)
  })
