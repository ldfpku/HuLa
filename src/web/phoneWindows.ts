/**
 * 手机上不开新标签页：设置、邮件、通话等“窗口”在当前页面里全屏打开（iframe，标签页名照旧是 smj-<窗口名>，
 * 里面的应用按同样的窗口名启动）。原因：
 * - 手机浏览器的新标签页来回切换不方便，“添加到主屏幕”后更是会跳出应用
 * - 打开邮件要先请求一次性登录链接，请求回来时点击已经过去，iOS Safari 会把 window.open 当弹窗拦掉
 * 窗口自己关闭（通话挂断、设置里点关闭）时由 tauriShim 发 smj-close-window 消息过来。
 */

import { PHONE_LAYOUT_QUERY } from '@/utils/PlatformConstants'

/** 手机（单栏）布局时窗口在页内打开 */
export const isPhoneScreen = () => window.matchMedia(PHONE_LAYOUT_QUERY).matches

/** 通话页自己铺满屏幕、有挂断按钮，不加标题栏（直接移除 iframe 会断掉通话而不通知对方） */
const BARE_LABELS = new Set(['rtcCall'])

const CLOSE_MESSAGE = 'smj-close-window'

const frames = new Map<string, HTMLElement>()

export const closePhoneWindow = (label: string) => {
  frames.get(label)?.remove()
  frames.delete(label)
}

window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.data?.type !== CLOSE_MESSAGE) return
  closePhoneWindow(String(event.data.label ?? ''))
})

/** 页内打开一个窗口；同名窗口已打开时换成新地址并放到最上面 */
export const openPhoneWindow = (label: string, url: string, title = '') => {
  // 页内窗口里再开窗口（如设置里的“关于”），交给最外层页面打开，不要一层套一层
  const top = window.top as (Window & { __smjOpenPhoneWindow?: typeof openPhoneWindow }) | null
  if (top && top !== window && top.__smjOpenPhoneWindow) {
    top.__smjOpenPhoneWindow(label, new URL(url, location.href).href, title)
    return
  }
  const existing = frames.get(label)
  if (existing) {
    const frame = existing.querySelector('iframe')
    if (frame && frame.src !== new URL(url, location.href).href) frame.src = url
    document.body.appendChild(existing)
    return
  }
  const bare = BARE_LABELS.has(label)
  const box = document.createElement('div')
  box.className = `smj-phone-window${bare ? ' smj-phone-window--bare' : ''}`
  box.dataset.label = label
  if (!bare) {
    const bar = document.createElement('div')
    bar.className = 'smj-phone-window__bar'
    const back = document.createElement('button')
    back.type = 'button'
    back.className = 'smj-phone-window__back'
    back.setAttribute('aria-label', '返回')
    back.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>'
    back.addEventListener('click', () => closePhoneWindow(label))
    const name = document.createElement('div')
    name.className = 'smj-phone-window__title'
    name.textContent = title
    bar.append(back, name)
    box.appendChild(bar)
  }
  const frame = document.createElement('iframe')
  frame.className = 'smj-phone-window__frame'
  frame.name = `smj-${label}`
  frame.allow = 'camera; microphone; autoplay; fullscreen; clipboard-write; display-capture'
  frame.src = url
  // 页面里的标题（如邮件主题）比打开时给的更准
  frame.addEventListener('load', () => {
    const name = box.querySelector('.smj-phone-window__title')
    try {
      const inner = frame.contentDocument?.title
      if (name && inner && !title) name.textContent = inner
    } catch {
      // 跨源页面读不到标题，保留原来的
    }
  })
  box.appendChild(frame)
  document.body.appendChild(box)
  frames.set(label, box)
}

;(window as Window & { __smjOpenPhoneWindow?: typeof openPhoneWindow }).__smjOpenPhoneWindow = openPhoneWindow

/** 在 iframe 里的窗口要关闭自己时调用；不在 iframe 里返回 false，照常 window.close() */
export const closeSelfInParent = (label: string) => {
  if (window.parent === window) return false
  window.parent.postMessage({ type: CLOSE_MESSAGE, label }, location.origin)
  return true
}
