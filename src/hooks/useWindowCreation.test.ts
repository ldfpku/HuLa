import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  onNativeError: undefined as ((event: { payload: string }) => Promise<void>) | undefined,
  getWindow: vi.fn(),
  primaryMonitor: vi.fn()
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: class {
    static getByLabel = mocks.getWindow

    async once(name: string, handler: (event: { payload: string }) => Promise<void>) {
      if (name === 'tauri://error') mocks.onNativeError = handler
    }
  }
}))
vi.mock('@tauri-apps/api/window', () => ({
  Window: class {
    static getByLabel = mocks.getWindow
  },
  UserAttentionType: {},
  primaryMonitor: mocks.primaryMonitor
}))
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn() }))
vi.mock('@/stores/global', () => ({ useGlobalStore: () => ({}) }))
vi.mock('@/utils/PlatformConstants', () => ({
  isCompatibility: () => true,
  isDesktop: () => true,
  isMac: () => false,
  isWeb: () => false,
  isWindows: () => true,
  isWindows10: () => false
}))

import { useWindow } from './useWindow'

describe('window creation failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.onNativeError = undefined
    mocks.getWindow.mockResolvedValue(null)
    mocks.primaryMonitor.mockResolvedValue(null)
  })

  it('reports an asynchronous native creation error', async () => {
    const report = vi.fn()
    await useWindow().createWebviewWindow(
      'Image',
      'imageViewer',
      800,
      680,
      '',
      true,
      630,
      500,
      undefined,
      undefined,
      undefined,
      report
    )
    expect(mocks.onNativeError).toBeTypeOf('function')
    await mocks.onNativeError!({ payload: 'native failure' })
    expect(report).toHaveBeenCalledWith('native failure')
  })

  it('does not report failure when an existing window can be restored', async () => {
    mocks.getWindow.mockResolvedValue({
      isMinimized: vi.fn().mockResolvedValue(false),
      isVisible: vi.fn().mockResolvedValue(true),
      setFocus: vi.fn().mockResolvedValue(undefined)
    })
    const report = vi.fn()
    await useWindow().createWebviewWindow(
      'Image',
      'imageViewer',
      800,
      680,
      '',
      true,
      630,
      500,
      undefined,
      undefined,
      undefined,
      report
    )
    expect(mocks.onNativeError).toBeTypeOf('function')
    await mocks.onNativeError!({ payload: 'already exists' })
    expect(report).not.toHaveBeenCalled()
  })

  it('reports an error if restoring the existing window fails', async () => {
    const error = new Error('restore failed')
    mocks.getWindow.mockResolvedValue({ isMinimized: vi.fn().mockRejectedValue(error) })
    const report = vi.fn()
    await useWindow().createWebviewWindow(
      'Image',
      'imageViewer',
      800,
      680,
      '',
      true,
      630,
      500,
      undefined,
      undefined,
      undefined,
      report
    )
    expect(mocks.onNativeError).toBeTypeOf('function')
    await mocks.onNativeError!({ payload: 'already exists' })
    expect(report).toHaveBeenCalledWith(error)
  })
})
