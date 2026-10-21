/**
 * 手机浏览器里打开网页版时，提示“添加到主屏幕”（PWA，见 ./pwa.ts）：
 * - 只在主窗口（home，已登录）显示，从主屏幕图标打开（standalone）或关过后不再显示
 * - 安卓 Chrome 给出 beforeinstallprompt 时直接“安装”，否则带到邮箱设置里的“手机端”说明页
 */
import './installHint.scss'
import {
  detectMobileOs,
  installGuideUrl,
  installHintText,
  isInAppBrowser,
  shouldShowInstallHint
} from './installHintUtils'

const DISMISSED_KEY = 'smj-install-hint-dismissed'
const SHOW_DELAY_MS = 3000

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let installPrompt: InstallPromptEvent | null = null
let card: HTMLElement | null = null

const readDismissed = () => {
  try {
    return localStorage.getItem(DISMISSED_KEY) !== null
  } catch {
    return false
  }
}

const remember = () => {
  try {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()))
  } catch {
    // 无痕模式写不进去时，本次关掉即可
  }
}

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.matchMedia('(display-mode: fullscreen)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

const close = (persist: boolean) => {
  if (persist) remember()
  card?.remove()
  card = null
}

// IconPark 风格的线性图标（48 网格、4px 圆角描边），不引用外部资源
const PHONE_ICON =
  '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="11" y="4" width="26" height="40" rx="3"/><path d="M21 37h6"/><path d="M24 14v12M18 20h12"/></svg>'
const CLOSE_ICON =
  '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" aria-hidden="true"><path d="M14 14l20 20M34 14L14 34"/></svg>'

const render = () => {
  const os = detectMobileOs(navigator.userAgent, navigator.maxTouchPoints)
  if (!os || card) return
  const inApp = isInAppBrowser(navigator.userAgent)
  const canPrompt = !inApp && installPrompt !== null

  card = document.createElement('div')
  card.className = 'smj-install-hint'
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-label', '添加到主屏幕')

  const icon = document.createElement('span')
  icon.className = 'smj-install-hint__icon'
  icon.innerHTML = PHONE_ICON

  const text = document.createElement('div')
  text.className = 'smj-install-hint__text'
  const title = document.createElement('strong')
  title.textContent = '添加到主屏幕使用更方便'
  const body = document.createElement('span')
  body.textContent = installHintText(os, inApp, canPrompt)
  text.append(title, body)

  const action = document.createElement(canPrompt ? 'button' : 'a')
  action.className = 'smj-install-hint__action'
  if (canPrompt) {
    action.textContent = '安装'
    ;(action as HTMLButtonElement).type = 'button'
    action.addEventListener('click', () => {
      const event = installPrompt
      installPrompt = null
      if (!event) return
      void event.prompt().catch(() => undefined)
      void event.userChoice.then((choice) => close(choice.outcome === 'accepted')).catch(() => close(false))
    })
  } else {
    const link = action as HTMLAnchorElement
    link.textContent = '查看方法'
    link.href = installGuideUrl(window.location.origin)
    link.target = '_blank'
    link.rel = 'noopener'
  }

  const dismiss = document.createElement('button')
  dismiss.type = 'button'
  dismiss.className = 'smj-install-hint__close'
  dismiss.setAttribute('aria-label', '关闭，不再提示')
  dismiss.innerHTML = CLOSE_ICON
  dismiss.addEventListener('click', () => close(true))

  card.append(icon, text, action, dismiss)
  document.body.append(card)
}

/** 尽早调用：beforeinstallprompt 可能在应用加载完之前就触发 */
export const captureInstallPrompt = () => {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    installPrompt = event as InstallPromptEvent
  })
  window.addEventListener('appinstalled', () => close(true))
}

export const startInstallHint = (label: string) => {
  if (label !== 'home') return
  const visible = () =>
    shouldShowInstallHint({
      os: detectMobileOs(navigator.userAgent, navigator.maxTouchPoints),
      standalone: isStandalone(),
      dismissed: readDismissed(),
      embedded: window.parent !== window
    })
  if (!visible()) return
  window.setTimeout(() => {
    if (visible()) render()
  }, SHOW_DELAY_MS)
}
