/**
 * 网页版的 IM 请求客户端：对应 src-tauri/src/im_request_client.rs
 * token 存在 localStorage，406 时自动刷新 token 后重试，401 视为需要重新登录
 */
import { IM_URLS } from './imUrls'

const TOKEN_KEY = 'smj-web-im-tokens'

type Tokens = { uid: string; token: string; refreshToken: string }

export const webConfig = {
  baseUrl: `${location.origin}/api/im`,
  wsUrl: `${location.origin.replace(/^http/, 'ws')}/api/im/ws`
}

export const tokenStore = {
  get(): Tokens | null {
    try {
      const raw = localStorage.getItem(TOKEN_KEY)
      return raw ? (JSON.parse(raw) as Tokens) : null
    } catch {
      return null
    }
  },
  set(tokens: Tokens) {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens))
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY)
  }
}

export class ImRequestError extends Error {}

const buildUrl = (path: string, params?: Record<string, unknown> | null) => {
  const url = new URL(`${webConfig.baseUrl}/${path}`)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue
      if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, String(item)))
      else url.searchParams.append(key, String(value))
    }
  }
  return url.toString()
}

const send = async (method: string, path: string, body?: unknown, params?: Record<string, unknown> | null) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const tokens = tokenStore.get()
  if (tokens?.token) headers.token = tokens.token
  let response: Response
  try {
    response = await fetch(buildUrl(path, params), {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(body ?? {})
    })
  } catch (error) {
    throw new ImRequestError(`network_error: ${error}`)
  }
  try {
    return (await response.json()) as { code?: number; msg?: string; data?: unknown; success?: boolean }
  } catch (error) {
    throw new ImRequestError(`network_error: ${error}`)
  }
}

export const refreshTokens = async (): Promise<Tokens> => {
  const tokens = tokenStore.get()
  if (!tokens?.refreshToken) throw new ImRequestError('请重新登录')
  const result = await fetch(buildUrl(IM_URLS.refreshToken[1]), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: tokens.refreshToken })
  })
    .then((res) => res.json())
    .catch(() => null)
  const data = result?.data as { token?: string; refreshToken?: string } | undefined
  if (!result?.success || !data?.token) throw new ImRequestError('请重新登录')
  const next = { uid: tokens.uid, token: data.token, refreshToken: data.refreshToken || tokens.refreshToken }
  tokenStore.set(next)
  return next
}

export const requestPath = async <T = any>(
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, unknown> | null
): Promise<T> => {
  for (let attempt = 0; ; attempt++) {
    const result = await send(method, path, body, params)
    if (result.code === 406) {
      if (attempt >= 2) throw new ImRequestError('token过期，刷新token失败')
      await refreshTokens()
      continue
    }
    if (result.code === 401) throw new ImRequestError('请重新登录')
    if (result.code === 200) return result.data as T
    throw new ImRequestError(result.msg || '请求失败')
  }
}

/** 按 ImUrl 名称请求，与 im_request_command 的参数一致 */
export const imRequest = async <T = any>(name: string, body?: unknown, params?: Record<string, unknown> | null) => {
  const route = IM_URLS[name]
  if (!route) throw new ImRequestError(`未知接口: ${name}`)
  return requestPath<T>(route[0], route[1], body, params)
}

/** 退出聊天即退出邮件：两边共用登录，只退聊天的话下次打开又会用邮件的登录状态自动进来 */
export const signOutMail = () =>
  fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => null)
