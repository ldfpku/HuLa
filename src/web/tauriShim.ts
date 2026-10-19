/**
 * 网页版的 Tauri 替身：在浏览器里提供 window.__TAURI_INTERNALS__，
 * 让业务代码里的 @tauri-apps/* 调用不改动就能运行。
 * - Rust 命令转到 ./commands（直接请求服务端）
 * - 事件（listen/emit）在页内分发
 * - 多窗口：主窗口在当前标签页跳转，其余窗口在新标签页打开
 * - 托盘、全局快捷键、自启动、更新等桌面能力为空操作
 */
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import { createCommands } from './commands'
import { WebSocketClient } from './wsClient'

const MAIN_WINDOWS = new Set(['login', 'home'])

const currentLabel = location.pathname.split('/').filter(Boolean)[0] || 'login'

const emit = (event: string, payload?: unknown) => {
  void (window as any).__TAURI_INTERNALS__.invoke('plugin:event|emit', { event, payload })
}

const ws = new WebSocketClient(emit)
const commands = createCommands(ws, emit)

const size = () => ({ width: window.innerWidth, height: window.innerHeight })

const openWindow = (args: any) => {
  const options = args?.options ?? {}
  const label: string = options.label ?? ''
  const url: string = options.url ?? `/${label}`
  if (label === currentLabel) return null
  if (MAIN_WINDOWS.has(label)) location.assign(url)
  else window.open(url, `smj-${label}`)
  return null
}

/** plugin:* 命令：只实现网页里有意义的，其余返回 null */
const pluginCommand = (cmd: string, args: any): unknown => {
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
      if (action === 'exists') return false
      if (action === 'read_dir') return []
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
    case 'opener':
      if (action === 'open_url') window.open(args?.url, '_blank', 'noopener')
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

mockWindows(currentLabel)
mockIPC(
  async (cmd, args) => {
    if (cmd.startsWith('plugin:')) return pluginCommand(cmd, args)
    const handler = commands[cmd]
    if (handler) return handler(args as Record<string, any>)
    console.warn(`[web] 未实现的命令: ${cmd}`, args)
    return null
  },
  { shouldMockEvents: true }
)

const internals = (window as any).__TAURI_INTERNALS__
internals.convertFileSrc = (filePath: string) => filePath
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

// 主窗口刷新后浏览器里的 WebSocket 已断开，有登录信息时重新连上
if (currentLabel === 'home') {
  const clientId = localStorage.getItem('clientId') ?? ''
  void ws.init(clientId)
}
