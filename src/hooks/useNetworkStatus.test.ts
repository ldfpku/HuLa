import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

const { handlers, getState, listen } = vi.hoisted(() => {
  const handlers: Array<(event: { payload: unknown }) => void> = []
  return {
    handlers,
    getState: vi.fn(async (): Promise<string | null> => null),
    listen: vi.fn(async (_name: string, handler: (event: { payload: unknown }) => void) => {
      handlers.push(handler)
      return () => {}
    })
  }
})

vi.mock('@tauri-apps/api/event', () => ({ listen }))
vi.mock('@/services/webSocketRust', () => ({
  default: { getState },
  ConnectionState: {
    DISCONNECTED: 'DISCONNECTED',
    CONNECTING: 'CONNECTING',
    CONNECTED: 'CONNECTED',
    RECONNECTING: 'RECONNECTING',
    ERROR: 'ERROR'
  }
}))

import { useNetworkStatus } from './useNetworkStatus'

const setState = async (state: string) => {
  for (const handler of handlers) handler({ payload: { type: 'connectionStateChanged', state } })
  await nextTick()
}

describe('useNetworkStatus 断线提示', () => {
  let scope: ReturnType<typeof effectScope>
  let status: ReturnType<typeof useNetworkStatus>

  beforeEach(async () => {
    vi.useFakeTimers()
    handlers.length = 0
    getState.mockReset().mockResolvedValue(null)
    ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
    scope = effectScope()
    status = scope.run(() => useNetworkStatus())!
    await vi.runAllTicks()
    await Promise.resolve()
  })

  afterEach(() => {
    scope.stop()
    vi.useRealTimers()
  })

  it('首次连接中不算重试，失败后算，连续约 1 分钟才补代理说明', async () => {
    await setState('CONNECTING')
    expect(status.wsRetrying.value).toBe(false)
    await setState('RECONNECTING')
    await setState('CONNECTING')
    expect(status.wsRetrying.value).toBe(true)
    vi.advanceTimersByTime(59_000)
    expect(status.wsOutageLong.value).toBe(false)
    await setState('RECONNECTING')
    vi.advanceTimersByTime(1_000)
    expect(status.wsOutageLong.value).toBe(true)
  })

  it('连上后全部清零', async () => {
    await setState('RECONNECTING')
    vi.advanceTimersByTime(60_000)
    await setState('CONNECTED')
    expect(status.wsRetrying.value).toBe(false)
    expect(status.wsOutageLong.value).toBe(false)
    await setState('RECONNECTING')
    vi.advanceTimersByTime(30_000)
    expect(status.wsOutageLong.value).toBe(false)
  })

  it('does not replace a newer live connection event with an older initial query', async () => {
    scope.stop()
    handlers.length = 0
    let resolve!: (state: string) => void
    getState.mockImplementationOnce(() => new Promise((done) => (resolve = done)))
    scope = effectScope()
    status = scope.run(() => useNetworkStatus())!
    await Promise.resolve()
    expect(getState).toHaveBeenCalledTimes(2)
    await setState('CONNECTED')
    resolve('DISCONNECTED')
    await Promise.resolve()
    expect(status.wsStatus.value).toBe('connected')
  })

  it('unregisters a listener that finishes registration after disposal', async () => {
    scope.stop()
    let finish!: (unlisten: () => void) => void
    const unlisten = vi.fn()
    listen.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    scope = effectScope()
    status = scope.run(() => useNetworkStatus())!
    scope.stop()
    finish(unlisten)
    await Promise.resolve()
    expect(unlisten).toHaveBeenCalledOnce()
  })

  it('retries a failed listener registration and resumes live updates', async () => {
    scope.stop()
    handlers.length = 0
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    listen.mockRejectedValueOnce(new Error('listener unavailable'))
    scope = effectScope()
    status = scope.run(() => useNetworkStatus())!
    await Promise.resolve()
    expect(warning).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(3000)
    await setState('CONNECTED')
    expect(status.wsStatus.value).toBe('connected')
    warning.mockRestore()
  })

  it('ignores an older initial query after a listener retry has refreshed the state', async () => {
    scope.stop()
    handlers.length = 0
    getState.mockReset()
    let finish!: (state: string) => void
    getState
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
      .mockResolvedValueOnce('CONNECTED')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    listen.mockRejectedValueOnce(new Error('listener unavailable'))
    scope = effectScope()
    status = scope.run(() => useNetworkStatus())!
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(3000)
    expect(status.wsStatus.value).toBe('connected')
    finish('DISCONNECTED')
    await Promise.resolve()
    expect(status.wsStatus.value).toBe('connected')
    warning.mockRestore()
  })
})
