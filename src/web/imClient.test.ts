import { afterEach, describe, expect, it, vi } from 'vitest'
import { imRequest, refreshTokens, requestPath, tokenStore } from './imClient'
import { createCommands } from './commands'
import { WebSocketClient } from './wsClient'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('web IM request timeout', () => {
  it('aborts a stalled write without retrying it', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    })

    vi.stubGlobal('fetch', fetchMock)
    const request = requestPath('POST', 'im/user/avatar', { avatar: '001' })
    const result = expect(request).rejects.toThrow('请求超时')
    await vi.advanceTimersByTimeAsync(30_000)
    await result
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true)
  })

  it('aborts a response body that never finishes', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve({ json: () => new Promise(() => {}) } as Response)
    )
    vi.stubGlobal('fetch', fetchMock)
    const request = requestPath('POST', 'im/user/avatar', { avatar: '001' })
    const result = expect(request).rejects.toThrow('请求超时')
    await vi.advanceTimersByTimeAsync(30_000)
    await result
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true)
  })
})

describe('web IM request behavior', () => {
  it('sends a status change in the JSON body and preserves a saved-but-pending response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 503, msg: '状态已保存，但同步失败，系统将自动重试' })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(imRequest('changeUserState', { id: '2' })).rejects.toThrow('状态已保存')
    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.pathname).toBe('/api/im/im/user/state/changeState')
    expect(url.searchParams.has('id')).toBe(false)
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ id: '2' })
  })

  it('sends the to-do page cursor unchanged through the web route', async () => {
    const cursor = '[1,"all",123,"todo_2"]'
    const page = { items: [], hasMore: false, nextCursor: null }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 200, data: page })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(imRequest('todoPage', undefined, { status: 'all', pageSize: 50, cursor })).resolves.toEqual(page)
    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.pathname).toBe('/api/im/im/todo/page')
    expect(url.searchParams.get('cursor')).toBe(cursor)
    expect(url.searchParams.get('status')).toBe('all')
    expect(fetchMock.mock.calls[0][1].method).toBe('GET')
  })

  it('still retries failed read-only fetches', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network failure'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: ['ok'] })))
    vi.stubGlobal('fetch', fetchMock)
    const request = requestPath('GET', 'im/chat/contact/list')
    await vi.advanceTimersByTimeAsync(500)
    await expect(request).resolves.toEqual(['ok'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refreshes an expired token and retries the original request', async () => {
    tokenStore.set({ uid: 'user', token: 'old-token', refreshToken: 'old-refresh' })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 406 })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { token: 'new-token', refreshToken: 'new-refresh' } }))
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: 'ok' })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(requestPath('GET', 'im/chat/contact/list')).resolves.toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(tokenStore.get()).toEqual({ uid: 'user', token: 'new-token', refreshToken: 'new-refresh' })
    expect(fetchMock.mock.calls[2][1].headers.token).toBe('new-token')
  })

  it('does not retry a malformed response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('not json'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(requestPath('GET', 'im/chat/contact/list')).rejects.toThrow('network_error')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('preserves a refresh timeout instead of reporting invalid credentials', async () => {
    vi.useFakeTimers()
    tokenStore.set({ uid: 'user', token: 'token', refreshToken: 'refresh' })
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
      })
    )
    const commands = createCommands(new WebSocketClient(() => {}), () => {})
    const request = commands.login_command({ data: { isAutoLogin: true, uid: 'user' } })
    const result = expect(request).rejects.toThrow('请求超时')
    await vi.advanceTimersByTimeAsync(30_000)
    await result
    expect(tokenStore.get()?.uid).toBe('user')
  })

  it.each([
    ['HTTP 502', new Response('', { status: 502 })],
    ['HTTP 429', new Response('', { status: 429 })],
    ['API 503', new Response(JSON.stringify({ success: false, code: 503 }))],
    ['missing token', new Response(JSON.stringify({ success: true, data: {} }))],
    ['non-string token', new Response(JSON.stringify({ success: true, data: { token: 123 } }))],
    ['invalid response', new Response(JSON.stringify({}))]
  ])('preserves credentials when refresh returns %s', async (_description, response) => {
    const tokens = { uid: 'user', token: 'token', refreshToken: 'refresh' }
    tokenStore.set(tokens)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    await expect(refreshTokens()).rejects.toThrow('network_error')
    expect(tokenStore.get()).toEqual(tokens)
  })

  it.each([
    ['HTTP 401', new Response('', { status: 401 })],
    ['HTTP 403', new Response('', { status: 403 })],
    ['rejected refresh token', new Response(JSON.stringify({ success: false, code: 401 }))]
  ])('requires login when refresh returns %s', async (_description, response) => {
    tokenStore.set({ uid: 'user', token: 'token', refreshToken: 'refresh' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    await expect(refreshTokens()).rejects.toThrow('请重新登录')
  })

  it('reports the HTTP status for an unavailable service', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 502 })))

    await expect(requestPath('GET', 'im/chat/contact/list')).rejects.toThrow('服务暂不可用 (502)')
  })
})
