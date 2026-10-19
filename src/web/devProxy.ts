/**
 * 仅开发时使用：本地页面在 localhost，服务端返回的上传/下载地址是线上域名的绝对地址，
 * 浏览器会按跨域拦下。这里把指向线上 /api/ 的请求改成本地相对地址，由 Vite 代理转发。
 * 正式部署时页面和接口同域名，不需要这一步。
 */
const target = (import.meta.env.VITE_WEB_PROXY_TARGET || 'https://mail.smjtools.com').replace(/\/$/, '')

const rewrite = (url: string) => (url.startsWith(`${target}/api/`) ? url.slice(target.length) : url)

if (import.meta.env.DEV) {
  const originalFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' || input instanceof URL) return originalFetch(rewrite(String(input)), init)
    return originalFetch(input, init)
  }

  const originalOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: any[]) {
    return (originalOpen as any).call(this, method, rewrite(String(url)), ...rest)
  }
}
