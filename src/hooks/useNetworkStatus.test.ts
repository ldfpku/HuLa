import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

const { handlers } = vi.hoisted(() => ({ handlers: [] as Array<(event: { payload: unknown }) => void> }))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_name: string, handler: (event: { payload: unknown }) => void) => {
    handlers.push(handler)
    return () => {}
  })
}))
vi.mock('@/services/webSocketRust', () => ({
  default: { getState: vi.fn(async () => null) },
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
})
