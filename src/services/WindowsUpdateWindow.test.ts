import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  windows: new Map<string, { show: ReturnType<typeof vi.fn>; setFocus: ReturnType<typeof vi.fn> }>(),
  listeners: new Map<string, (event: { payload: { id: string; error?: string } }) => void>(),
  emitTo: vi.fn(),
  unlisten: vi.fn(),
  primaryMonitor: vi.fn(),
  createOptions: [] as Array<{ width: number; height: number; visible: boolean }>
}))

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: mocks.emitTo,
  listen: vi.fn(async (name: string, handler: (event: { payload: { id: string; error?: string } }) => void) => {
    mocks.listeners.set(name, handler)
    return mocks.unlisten
  })
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: class {
    show = vi.fn().mockResolvedValue(undefined)
    setFocus = vi.fn().mockResolvedValue(undefined)
    constructor(_label: string, options: { width: number; height: number; visible: boolean }) {
      mocks.createOptions.push(options)
    }
    async once(event: string, handler: () => void) {
      if (event === 'tauri://created') queueMicrotask(handler)
      return mocks.unlisten
    }
    static async getByLabel(label: string) {
      return mocks.windows.get(label) ?? null
    }
  }
}))

vi.mock('@tauri-apps/api/window', () => ({ primaryMonitor: mocks.primaryMonitor }))

import {
  openWindowsUpdate,
  prepareWindowsUpdateInstall,
  publishWindowsUpdateState,
  requestWindowsUpdateState,
  retryWindowsUpdateCheck,
  UPDATE_PREPARE_EVENT,
  UPDATE_PREPARED_EVENT,
  UPDATE_QUERY_EVENT,
  UPDATE_RELEASE_EVENT,
  UPDATE_START_EVENT,
  UPDATE_STATE_EVENT
} from './WindowsUpdateWindow'

const makeWindow = () => ({
  show: vi.fn().mockResolvedValue(undefined),
  setFocus: vi.fn().mockResolvedValue(undefined)
})

describe('Windows update window coordination', () => {
  beforeEach(() => {
    mocks.windows.clear()
    mocks.listeners.clear()
    mocks.emitTo.mockReset().mockResolvedValue(undefined)
    mocks.unlisten.mockClear()
    mocks.createOptions.length = 0
    mocks.primaryMonitor.mockReset().mockResolvedValue(null)
  })

  it('reuses and focuses the update owner instead of creating another window', async () => {
    const window = makeWindow()
    mocks.windows.set('update', window)
    expect(await openWindowsUpdate(true)).toBe(window)
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.setFocus).toHaveBeenCalledOnce()
    await openWindowsUpdate(false)
    expect(window.show).toHaveBeenCalledOnce()
  })

  it('creates only one owner for simultaneous requests and fits the monitor', async () => {
    mocks.primaryMonitor.mockResolvedValue({ size: { width: 800, height: 600 }, scaleFactor: 2 })
    const [background, foreground] = await Promise.all([openWindowsUpdate(false), openWindowsUpdate(true)])
    expect(background).toBe(foreground)
    expect(mocks.createOptions).toEqual([expect.objectContaining({ width: 368, height: 268, visible: false })])
    expect(foreground.show).toHaveBeenCalledOnce()
  })

  it('queries the owner after a login-to-home window transition', async () => {
    mocks.windows.set('update', makeWindow())
    await requestWindowsUpdateState()
    await retryWindowsUpdateCheck()
    expect(mocks.emitTo).toHaveBeenCalledWith('update', UPDATE_START_EVENT)
    expect(mocks.emitTo).toHaveBeenCalledTimes(3)
    expect(mocks.emitTo).toHaveBeenCalledWith('update', UPDATE_QUERY_EVENT)
  })

  it('delivers state to the remaining window if another window closes', async () => {
    mocks.windows.set('login', makeWindow())
    mocks.windows.set('home', makeWindow())
    mocks.emitTo.mockRejectedValueOnce(new Error('login closed')).mockResolvedValue(undefined)
    const state = { stage: 'ready' as const, version: '2.0', percentage: null, error: null }
    await publishWindowsUpdateState(state)
    expect(mocks.emitTo).toHaveBeenCalledWith('home', UPDATE_STATE_EVENT, state)
  })

  it('requires home preparation before installation and supports releasing it', async () => {
    mocks.windows.set('home', makeWindow())
    mocks.emitTo.mockImplementation(async (_label, event, payload) => {
      if (event === UPDATE_PREPARE_EVENT) mocks.listeners.get(UPDATE_PREPARED_EVENT)?.({ payload })
    })
    const release = await prepareWindowsUpdateInstall()
    const request = mocks.emitTo.mock.calls[0][2]
    expect(mocks.unlisten).toHaveBeenCalledOnce()
    await release()
    expect(mocks.emitTo).toHaveBeenCalledWith('home', UPDATE_RELEASE_EVENT, request)
  })

  it('blocks installation and releases preparation when home reports an error', async () => {
    mocks.windows.set('home', makeWindow())
    mocks.emitTo.mockImplementation(async (_label, event, payload) => {
      if (event === UPDATE_PREPARE_EVENT) {
        mocks.listeners.get(UPDATE_PREPARED_EVENT)?.({ payload: { id: payload.id, error: 'draft pending' } })
      }
    })
    await expect(prepareWindowsUpdateInstall()).rejects.toThrow('draft pending')
    expect(mocks.emitTo).toHaveBeenCalledWith(
      'home',
      UPDATE_RELEASE_EVENT,
      expect.objectContaining({ id: expect.any(String) })
    )
  })

  it('does not install if the home window does not acknowledge preparation', async () => {
    vi.useFakeTimers()
    try {
      mocks.windows.set('home', makeWindow())
      const preparing = prepareWindowsUpdateInstall()
      const rejected = expect(preparing).rejects.toThrow('Update preparation timed out')
      await vi.advanceTimersByTimeAsync(30000)
      await rejected
      expect(mocks.emitTo).toHaveBeenCalledWith(
        'home',
        UPDATE_RELEASE_EVENT,
        expect.objectContaining({ id: expect.any(String) })
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
