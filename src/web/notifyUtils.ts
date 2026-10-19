/** 网页版通知与未读角标里不依赖浏览器的部分，便于单独测试 */

/** 角标上显示的数字：超过 99 显示 99+，没有未读返回空串 */
export const badgeText = (count: number) => {
  if (!Number.isFinite(count) || count <= 0) return ''
  return count > 99 ? '99+' : String(Math.floor(count))
}

const TITLE_PREFIX = /^\(\d+\+?\)\s/

/** 去掉标题前面的未读数，得到应用自己设置的标题 */
export const baseTitle = (title: string) => title.replace(TITLE_PREFIX, '')

/** 在标题前加上未读数，如 “(3) SMJ” */
export const titleWithUnread = (title: string, count: number) => {
  const base = baseTitle(title)
  const text = badgeText(count)
  return text ? `(${text}) ${base}` : base
}

/** 页面是否正被用户看着：标签页在前台且窗口有焦点 */
export const isPageActive = (doc: Pick<Document, 'visibilityState' | 'hasFocus'>) =>
  doc.visibilityState === 'visible' && doc.hasFocus()

/** 网页部署在子路径下（如 /im/），把站内绝对路径补上前缀 */
export const withBasePath = (base: string, url: string) => {
  const prefix = base.replace(/\/$/, '')
  if (!url.startsWith('/') || url.startsWith('//') || !prefix || url.startsWith(`${prefix}/`)) return url
  return `${prefix}${url}`
}
