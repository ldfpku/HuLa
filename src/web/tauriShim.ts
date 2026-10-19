/**
 * 网页版的 Tauri 替身：在浏览器里提供 window.__TAURI_INTERNALS__，
 * 让业务代码里的 @tauri-apps/* 调用不改动就能运行。
 * - Rust 命令转到 ./commands（直接请求服务端）
 * - 事件（listen/emit）在页内分发，并经 ./bridge 广播到其他标签页
 * - 多窗口：主窗口在当前标签页跳转，其余窗口在新标签页打开（标签页名 smj-<窗口名>）
 * - 托盘、全局快捷键、自启动、更新等桌面能力为空操作
 */
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import { broadcastEvent, callHome, startBridge } from './bridge'
import { createCommands } from './commands'
import { closeIncomingCall, showIncomingCall } from './incomingCall'
import { downloadFile, downloadIfSaved, messageDialog, openFileDialog, saveFileDialog } from './dialog'
import { startRecording, stopRecording } from './micRecorder'
import { uploadFilePut, virtualFs } from './virtualFs'
import { WebSocketClient } from './wsClient'

const MAIN_WINDOWS = new Set(['login', 'home'])

/** 网页版部署在子路径下（如 /im/），窗口地址都要带上它 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

// 打开 /im/ 时没有窗口名，按登录页处理，让路由能匹配到
if (!location.pathname.slice(BASE.length).replace(/\//g, '')) {
  history.replaceState(history.state, '', `${BASE}/login${location.search}`)
}

/**
 * 窗口名：新标签页打开的窗口带着标签页名 smj-<窗口名>（刷新后仍在）；
 * 其余都是主窗口，登录页是 login，主页及其下的各个页面（/message 等）都是 home
 */
const tabLabel = window.name.startsWith('smj-') ? window.name.slice(4) : ''
const pathLabel = location.pathname.slice(BASE.length).split('/').filter(Boolean)[0] || 'login'
export const currentLabel =
  tabLabel && !MAIN_WINDOWS.has(tabLabel) ? tabLabel : pathLabel === 'login' ? 'login' : 'home'

const withBase = (url: string) => (/^[a-z]+:/i.test(url) || !url.startsWith('/') ? url : `${BASE}${url}`)

/** 通话结束类事件：来电横幅还开着时一并关掉 */
const CALL_END_EVENTS = new Set(['ws-cancel', 'ws-timeout', 'ws-dropped', 'ws-call-rejected', 'ws-room-closed'])

const emit = (event: string, payload?: unknown) => {
  if (CALL_END_EVENTS.has(event)) closeIncomingCall()
  void (window as any).__TAURI_INTERNALS__.invoke('plugin:event|emit', { event, payload })
}

const ws = new WebSocketClient(emit)
const commands = createCommands(ws, emit)

const size = () => ({ width: window.innerWidth, height: window.innerHeight })

const openWindow = (args: any) => {
  const options = args?.options ?? {}
  const label: string = options.label ?? ''
  const url = withBase(options.url ?? `/${label}`)
  if (label === currentLabel) return null
  if (MAIN_WINDOWS.has(label)) {
    window.name = ''
    location.assign(url)
  } else if (label === 'rtcCall' && url.includes('isIncoming=true')) {
    showIncomingCallFor(url)
  } else {
    window.open(url, `smj-${label}`)
  }
  return null
}

/** 来电：服务端推送触发，没有用户点击，直接开标签页会被拦，先在页内提示 */
const showIncomingCallFor = (url: string) => {
  const query = new URL(url, location.origin).searchParams
  showIncomingCall({
    isVideo: query.get('callType') === '2',
    onAccept: () => window.open(`${url}&autoAccept=1`, 'smj-rtcCall'),
    onReject: () =>
      ws.send({
        // 6 = VIDEO_CALL_RESPONSE，accepted 0 = 拒绝（见 useWebRtc 的 sendRtcCall2VideoCallResponse）
        type: 6,
        data: { callerUid: query.get('remoteUserId'), roomId: query.get('roomId'), accepted: 0 }
      })
  })
}

/** plugin:* 命令：只实现网页里有意义的，其余返回 null */
const pluginCommand = (cmd: string, args: any, options?: any): unknown => {
  const [plugin, action] = cmd.slice('plugin:'.length).split('|')
  switch (plugin) {
    case 'log':
      if (action === 'log') console.log(`[log] ${args?.message ?? ''}`)
      return null
    case 'webview':
      if (action === 'create_webview_window') return openWindow(args)
      if (action === 'get_all_webviews') return [{ windowLabel: currentLabel, label: currentLabel }]
      return null
    case 'window':
      switch (action) {
        case 'get_all_windows':
          return [currentLabel]
        case 'inner_size':
        case 'outer_size':
          return size()
        case 'inner_position':
        case 'outer_position':
          return { x: 0, y: 0 }
        case 'scale_factor':
          return window.devicePixelRatio || 1
        case 'is_visible':
        case 'is_focused':
        case 'is_enabled':
          return true
        case 'is_maximized':
        case 'is_minimized':
        case 'is_fullscreen':
        case 'is_decorated':
        case 'is_always_on_top':
          return false
        case 'title':
          return document.title
        case 'set_title':
          document.title = args?.value ?? document.title
          return null
        case 'close':
        case 'destroy':
          if ((args?.label ?? currentLabel) === currentLabel && !MAIN_WINDOWS.has(currentLabel)) window.close()
          return null
        default:
          return null
      }
    case 'app':
      if (action === 'version') return import.meta.env.VITE_APP_VERSION ?? 'web'
      if (action === 'name') return 'SMJ'
      if (action === 'tauri_version') return '2'
      return null
    case 'path':
      if (action === 'join') return (args?.paths ?? []).join('/')
      if (action === 'basename')
        return String(args?.path ?? '')
          .split('/')
          .pop()
      if (action === 'dirname')
        return String(args?.path ?? '')
          .split('/')
          .slice(0, -1)
          .join('/')
      if (action === 'extname')
        return String(args?.path ?? '')
          .split('.')
          .pop()
      if (action === 'normalize' || action === 'resolve') return args?.path ?? (args?.paths ?? []).join('/')
      return '/web'
    case 'fs':
      switch (action) {
        case 'write_file':
        case 'write_text_file': {
          // 二进制内容作为请求体传入，路径在请求头里（与 plugin-fs 的 writeFile 一致）
          const path = decodeURIComponent(options?.headers?.path ?? '')
          virtualFs.writeFile(path, args)
          downloadIfSaved(path)
          return null
        }
        case 'copy_file':
          // 只复制分块引用，不重复占用内存
          virtualFs.copy(args?.fromPath, args?.toPath)
          downloadIfSaved(args?.toPath ?? '')
          return null
        case 'open':
        case 'create':
          return virtualFs.open(args?.path, action === 'create' ? { create: true } : args?.options)
        case 'write':
          return virtualFs.write(args?.rid, args?.data)
        case 'stat':
        case 'lstat':
          return virtualFs.stat(args?.path)
        case 'read_file':
          return virtualFs.read(args?.path)
        case 'exists':
          return virtualFs.has(args?.path)
        case 'remove':
          virtualFs.remove(args?.path)
          return null
        case 'read_dir':
          return []
        default:
          return null
      }
    case 'resources':
      if (action === 'close') downloadIfSaved(virtualFs.close(args?.rid) ?? '')
      return null
    case 'dialog':
      if (action === 'open') return openFileDialog(args?.options)
      if (action === 'save') return saveFileDialog(args?.options)
      if (action === 'message') return messageDialog(args)
      return null
    case 'notification':
      if (action === 'is_permission_granted') return 'Notification' in window && Notification.permission === 'granted'
      if (action === 'request_permission') return 'Notification' in window ? Notification.requestPermission() : 'denied'
      if (action === 'notify') {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(args?.options?.title ?? 'SMJ', { body: args?.options?.body })
        }
        return null
      }
      return null
    case 'mic-recorder':
      if (action === 'start_recording') return startRecording()
      if (action === 'stop_recording') return stopRecording()
      return null
    case 'opener':
      if (action === 'open_url') window.open(args?.url, '_blank', 'noopener')
      // 打开本机文件（如会议的 .ics）：网页里改为下载，由浏览器交给系统日历等程序
      if (action === 'open_path' && virtualFs.has(args?.path)) downloadFile(args.path)
      return null
    case 'clipboard-manager':
      if (action === 'write_text')
        return navigator.clipboard?.writeText(args?.text ?? args?.data?.plainText?.text ?? '')
      if (action === 'read_text') return navigator.clipboard?.readText()
      return null
    case 'global-shortcut':
      if (action === 'is_registered') return false
      return null
    case 'autostart':
      if (action === 'is_enabled') return false
      return null
    case 'updater':
      return null
    default:
      return null
  }
}

/** 只有主窗口连着 WebSocket，其他标签页发消息、查状态都交给主窗口 */
const HOME_WS_COMMANDS = new Set(['ws_send_message', 'ws_get_state', 'ws_is_connected', 'ws_get_health'])

const handle = async (cmd: string, args: any, options?: any) => {
  if (cmd.startsWith('plugin:')) return pluginCommand(cmd, args, options)
  if (cmd.startsWith('ws_') && currentLabel !== 'home') {
    return HOME_WS_COMMANDS.has(cmd) ? callHome(cmd, args) : null
  }
  if (cmd === 'upload_file_put') return uploadFilePut(args)
  const handler = commands[cmd]
  if (handler) return handler(args as Record<string, any>)
  console.warn(`[web] 未实现的命令: ${cmd}`, args)
  return null
}

mockWindows(currentLabel)
mockIPC(handle, { shouldMockEvents: true })

const internals = (window as any).__TAURI_INTERNALS__
// mockIPC 不转发 invoke 的第三个参数（请求头），文件写入要靠它带路径，所以除事件外都直接交给 handle
const mockedInvoke = internals.invoke
internals.invoke = (cmd: string, args: any, options?: any) => {
  if (cmd === 'plugin:event|emit') broadcastEvent(currentLabel, args?.event, args?.payload)
  if (cmd === 'plugin:event|emit_to') {
    const target = args?.target
    broadcastEvent(currentLabel, args?.event, args?.payload, typeof target === 'string' ? target : target?.label)
  }
  return cmd.startsWith('plugin:event|') ? mockedInvoke(cmd, args, options) : handle(cmd, args, options)
}
startBridge({
  label: currentLabel,
  dispatch: (event, payload) => {
    if (CALL_END_EVENTS.has(event)) closeIncomingCall()
    void mockedInvoke('plugin:event|emit', { event, payload })
  },
  execute: (cmd, args) => handle(cmd, args)
})
internals.convertFileSrc = (filePath: string) => virtualFs.objectUrl(filePath) ?? filePath
internals.plugins = internals.plugins ?? {}
;(window as any).__TAURI_OS_PLUGIN_INTERNALS__ = {
  eol: '\n',
  platform: 'linux',
  version: '',
  family: 'unix',
  os_type: 'linux',
  arch: 'x86_64',
  exe_extension: ''
}
;(window as any).__SMJ_WEB__ = true

// 业务代码会直接 fetch 本机文件路径（如刚录的语音 cache/.../x.mp3、asset://...）；网页里这些文件在内存文件系统里
const LOCAL_PATH = /^asset:|^(?![a-z][a-z0-9+.-]*:)(?!\/(?!web\/))/i
const originalFetch = window.fetch.bind(window)
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const path = typeof input === 'string' ? input : ''
  // 相对路径、asset:// 或替身返回的 /web/ 目录下的路径；网址和站内绝对路径照常请求
  const blob = path && LOCAL_PATH.test(path) ? virtualFs.blob(path) : null
  return blob ? Promise.resolve(new Response(blob)) : originalFetch(input, init)
}

// 主窗口刷新后浏览器里的 WebSocket 已断开，有登录信息时重新连上
if (currentLabel === 'home') {
  const clientId = localStorage.getItem('clientId') ?? ''
  void ws.init(clientId)
}
