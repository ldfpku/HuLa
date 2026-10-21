/**
 * SMJ 即时通讯网页版的 service worker（构建时由 vite.config.ts 输出为 /im/sw.js，作用域 /im/）。
 * 只缓存本站 /im/ 下的静态文件，让“添加到主屏幕”后打开更快、断网时还能显示界面：
 * - 带哈希的构建产物（/im/static/）缓存优先，文件名变了就是新文件
 * - 页面（导航请求）网络优先，断网时用上次的页面
 * - 其余静态文件（图标、表情、声音等）先用缓存，后台再更新
 * 不缓存接口（/api/ 不在作用域里），不接推送，不访问任何其他网站。
 */
const CACHE = 'smj-im-__SMJ_BUILD__'
const SCOPE = new URL(self.registration.scope).pathname
const PAGE_KEY = SCOPE

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(PAGE_KEY))
      .catch(() => {})
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith('smj-im-') && key !== CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  )
})

const isCacheable = (response) => response && response.ok && response.type === 'basic' && !response.redirected

const pageFromNetwork = async (request) => {
  try {
    const response = await fetch(request)
    if (isCacheable(response)) {
      const copy = response.clone()
      caches.open(CACHE).then((cache) => cache.put(PAGE_KEY, copy))
    }
    return response
  } catch (error) {
    const cached = await caches.match(PAGE_KEY)
    if (cached) return cached
    throw error
  }
}

const cacheFirst = async (request) => {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (isCacheable(response)) {
    const copy = response.clone()
    caches.open(CACHE).then((cache) => cache.put(request, copy))
  }
  return response
}

const staleWhileRevalidate = async (request) => {
  const cached = await caches.match(request)
  const network = fetch(request)
    .then((response) => {
      if (isCacheable(response)) {
        const copy = response.clone()
        caches.open(CACHE).then((cache) => cache.put(request, copy))
      }
      return response
    })
    .catch(() => cached)
  return cached || network
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return
  // 视频背景板的 wasm 很大，只在点开时下载；浏览器自己的 HTTP 缓存就够了，不占 service worker 的缓存
  if (url.pathname.startsWith(`${SCOPE}video-bg/wasm/`)) return
  if (request.mode === 'navigate') {
    event.respondWith(pageFromNetwork(request))
  } else if (url.pathname.startsWith(`${SCOPE}static/`)) {
    event.respondWith(cacheFirst(request))
  } else if (!url.search) {
    event.respondWith(staleWhileRevalidate(request))
  }
})
