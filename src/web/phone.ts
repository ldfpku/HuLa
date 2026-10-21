/**
 * 网页版在手机浏览器里的适配：
 * - 窄屏时给 <html> 加 smj-phone，配合 ./phone.scss 和 usePhoneLayout 的单栏布局
 * - 页面高度跟着可见区域（visualViewport）走：软键盘弹出时整页缩到键盘上方，输入框不会被挡住；
 *   iOS 的 100vh 还包含地址栏后面的部分，也靠它纠正
 */
import { PHONE_LAYOUT_QUERY } from '@/utils/PlatformConstants'
import './phone.scss'

const root = document.documentElement

const syncHeight = () => {
  const viewport = window.visualViewport
  const height = viewport ? viewport.height : window.innerHeight
  root.style.setProperty('--smj-app-height', `${Math.round(height)}px`)
  // iOS 键盘弹出时会把整页往上推，高度已经按可见区域算了，推上去的部分是空白
  if (root.classList.contains('smj-phone') && window.scrollY !== 0) window.scrollTo(0, 0)
}

export const startPhoneSupport = () => {
  root.classList.add('smj-web')
  const media = window.matchMedia(PHONE_LAYOUT_QUERY)
  const syncClass = () => root.classList.toggle('smj-phone', media.matches)
  syncClass()
  media.addEventListener('change', syncClass)

  syncHeight()
  window.visualViewport?.addEventListener('resize', syncHeight)
  window.visualViewport?.addEventListener('scroll', syncHeight)
  window.addEventListener('resize', syncHeight)
  window.addEventListener('orientationchange', () => setTimeout(syncHeight, 300))

  // 聚焦输入框时，等键盘弹完再把它滚进可见区域
  document.addEventListener('focusin', (event) => {
    const target = event.target as HTMLElement | null
    if (!root.classList.contains('smj-phone') || !target?.matches('input, textarea, [contenteditable="true"]')) return
    setTimeout(() => target.scrollIntoView({ block: 'nearest' }), 300)
  })
}
