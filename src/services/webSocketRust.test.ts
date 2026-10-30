import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('@tauri-apps/plugin-log', () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }))
vi.mock('@/hooks/useMitt', () => ({ useMitt: { emit: vi.fn() } }))
vi.mock('@/stores/contacts', () => ({ useContactStore: vi.fn() }))

import rustWebSocketClient from './webSocketRust'

describe('desktop websocket visibility', () => {
  it('initializes with the current visibility', async () => {
    mocks.invoke.mockReset().mockResolvedValue(undefined)
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await rustWebSocketClient.initConnect()
    expect(mocks.invoke).toHaveBeenCalledWith('ws_set_app_background_state', { isBackground: true })
    visibility.mockRestore()
  })

  it('sends visibility changes in order, even after an earlier failure', async () => {
    let finish: (() => void) | undefined
    mocks.invoke.mockReset().mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    mocks.invoke.mockResolvedValue(undefined)
    const hidden = rustWebSocketClient.setAppBackgroundState(true)
    const visible = rustWebSocketClient.setAppBackgroundState(false)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    finish?.()
    await Promise.all([hidden, visible])
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'ws_set_app_background_state', { isBackground: true })
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'ws_set_app_background_state', { isBackground: false })
    mocks.invoke.mockRejectedValueOnce(new Error('synthetic failure'))
    await expect(rustWebSocketClient.setAppBackgroundState(true)).rejects.toThrow('synthetic failure')
    await expect(rustWebSocketClient.setAppBackgroundState(false)).resolves.toBeUndefined()
  })
})
