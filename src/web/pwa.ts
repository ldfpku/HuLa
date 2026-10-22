/**
 * “添加到主屏幕”（PWA）：注册只缓存本站静态文件的 service worker（./sw.js，构建为 /im/sw.js）。
 * manifest 和 <head> 里的主题色、图标由 vite.config.ts 的网页构建插件写入。
 * 不做 Web Push：推送服务由浏览器厂商运营，违反“只用 Cloudflare”的约定。
 */
export const registerServiceWorker = () => {
  if (import.meta.env.DEV || !('serviceWorker' in navigator) || !window.isSecureContext) return
  // 页内打开的窗口（iframe）不用再注册
  if (window.parent !== window) return
  const base = import.meta.env.BASE_URL
  const register = () =>
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch((error) => {
      console.warn('[web] service worker 注册失败', error)
    })
  if (document.readyState === 'complete') void register()
  else window.addEventListener('load', () => void register(), { once: true })
}
