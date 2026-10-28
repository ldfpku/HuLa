import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  currentMonitor: vi.fn(),
  warning: vi.fn(),
  window: {
    outerPosition: vi.fn(),
    outerSize: vi.fn(),
    isMaximized: vi.fn(),
    isFullscreen: vi.fn(),
    setFullscreen: vi.fn(),
    unmaximize: vi.fn(),
    maximize: vi.fn(),
    setMinSize: vi.fn(),
    setSize: vi.fn(),
    setPosition: vi.fn()
  }
}))

vi.mock('@tauri-apps/api/window', () => ({
  currentMonitor: mocks.currentMonitor,
  getCurrentWindow: () => mocks.window
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

import { splitWindowState } from '@/utils/SplitWindowState'
import SplitWindowMenu from './SplitWindowMenu.vue'

describe('split window menu', () => {
  let position: { x: number; y: number }
  let size: { width: number; height: number }

  beforeEach(() => {
    vi.clearAllMocks()
    splitWindowState.saved = undefined
    position = { x: 100, y: 50 }
    size = { width: 960, height: 720 }
    mocks.currentMonitor.mockResolvedValue({
      workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
      scaleFactor: 1
    })
    mocks.window.outerPosition.mockImplementation(async () => ({ ...position }))
    mocks.window.outerSize.mockImplementation(async () => ({ ...size }))
    mocks.window.isMaximized.mockResolvedValue(false)
    mocks.window.isFullscreen.mockResolvedValue(false)
    mocks.window.setMinSize.mockResolvedValue(undefined)
    mocks.window.setSize.mockImplementation(async (value: { width: number; height: number }) => {
      size = { width: value.width, height: value.height }
    })
    mocks.window.setPosition.mockImplementation(async (value: { x: number; y: number }) => {
      position = { x: value.x, y: value.y }
    })
    Object.assign(window, { $message: { warning: mocks.warning } })
  })

  it('tiles the window and restores its previous geometry', async () => {
    const wrapper = mount(SplitWindowMenu)
    wrapper.findComponent({ name: 'Dropdown' }).vm.$emit('select', 'right')
    await new Promise((resolve) => setTimeout(resolve, 250))
    await flushPromises()
    expect(position).toEqual({ x: 960, y: 0 })
    expect(size).toEqual({ width: 960, height: 1040 })
    expect(mocks.warning).not.toHaveBeenCalled()
    wrapper.findComponent({ name: 'Dropdown' }).vm.$emit('select', 'restore')
    await flushPromises()
    expect(position).toEqual({ x: 100, y: 50 })
    expect(size).toEqual({ width: 960, height: 720 })
    wrapper.unmount()
  })

  it('warns and restores when the window manager ignores positioning', async () => {
    mocks.window.setPosition.mockImplementation(async () => {})
    const wrapper = mount(SplitWindowMenu)
    wrapper.findComponent({ name: 'Dropdown' }).vm.$emit('select', 'right')
    await new Promise((resolve) => setTimeout(resolve, 250))
    await flushPromises()
    expect(mocks.warning).toHaveBeenCalledWith('components.actionBar.split.unsupported')
    expect(size).toEqual({ width: 960, height: 720 })
    wrapper.unmount()
  })
})
