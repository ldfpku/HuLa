/** 网页版“添加到主屏幕”提示里不依赖浏览器的部分，便于单独测试 */

export type MobileOs = 'ios' | 'android'

/** 手机或平板；iPadOS 13 起自称 Mac，带触屏的 Mac 按 iOS 算 */
export const detectMobileOs = (userAgent: string, maxTouchPoints = 0): MobileOs | null => {
  if (/Android/i.test(userAgent)) return 'android'
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios'
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'ios'
  return null
}

/** 微信、企业微信、钉钉、QQ 等 App 里的内置浏览器没有“添加到主屏幕” */
export const isInAppBrowser = (userAgent: string) =>
  /MicroMessenger|wxwork|DingTalk|\bQQ\/|AlipayClient|Weibo/i.test(userAgent)

export type InstallHintContext = {
  os: MobileOs | null
  /** 已经从主屏幕图标打开（display-mode: standalone 或 iOS 的 navigator.standalone） */
  standalone: boolean
  /** 用户关过提示，或已经装好 */
  dismissed: boolean
  /** 页内打开的窗口（iframe）不提示 */
  embedded: boolean
}

export const shouldShowInstallHint = (ctx: InstallHintContext) =>
  ctx.os !== null && !ctx.standalone && !ctx.dismissed && !ctx.embedded

/** 提示正文：按系统和能否直接安装给出一句操作说明 */
export const installHintText = (os: MobileOs, inAppBrowser: boolean, canPrompt: boolean) => {
  if (inAppBrowser) return '请先点右上角，选“在浏览器中打开”，再添加到主屏幕。'
  if (os === 'ios') return '点 Safari 的“分享”按钮（新版 iOS 先点“⋯”），选“添加到主屏幕”。'
  if (canPrompt) return '装到手机桌面后，点 SMJ 图标即可全屏打开。'
  return '点浏览器右上角“⋮”，选“安装应用”或“添加到主屏幕”。'
}

/** 说明页在邮箱的设置里，与网页版同一个域名 */
export const installGuideUrl = (origin: string) => `${origin.replace(/\/+$/, '')}/settings/mobile`
