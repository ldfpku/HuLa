import { mount } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadEvent } from '@tauri-apps/plugin-updater'

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  hide: vi.fn(),
  onCloseRequested: vi.fn(),
  listen: vi.fn(),
  publish: vi.fn(),
  prepare: vi.fn()
}))

vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ hide: mocks.hide, onCloseRequested: mocks.onCloseRequested })
}))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: mocks.check }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/services/WindowsUpdateWindow', () => ({
  prepareWindowsUpdateInstall: mocks.prepare,
  publishWindowsUpdateState: mocks.publish,
  UPDATE_QUERY_EVENT: 'query',
  UPDATE_START_EVENT: 'start'
}))

import WindowsUpdate from './WindowsUpdate.vue'

describe('Windows update presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listen.mockResolvedValue(vi.fn())
    mocks.onCloseRequested.mockResolvedValue(vi.fn())
    mocks.hide.mockResolvedValue(undefined)
    mocks.publish.mockResolvedValue(undefined)
  })

  it('shows verification before restart is offered and keeps the owner alive when postponed', async () => {
    let finishDownload!: () => void
    let progress!: (event: DownloadEvent) => void
    const update = {
      version: '2.0',
      download: vi.fn((onEvent: (event: DownloadEvent) => void) => {
        progress = onEvent
        return new Promise<void>((resolve) => {
          finishDownload = resolve
        })
      }),
      close: vi.fn(),
      install: vi.fn()
    }
    mocks.check.mockResolvedValue(update)
    const wrapper = mount(WindowsUpdate, {
      global: {
        stubs: {
          BrandLogo: true,
          NProgress: true,
          NSpin: true,
          NButton: { template: '<button @click="$emit(\'click\')"><slot /></button>' }
        }
      }
    })
    await flushPromises()
    expect(wrapper.find('video').exists()).toBe(false)
    expect(wrapper.find('[aria-live="polite"]').exists()).toBe(true)
    progress({ event: 'Started', data: {} })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.update-progress [aria-label="message.update_window.stage_downloading"]').exists()).toBe(true)
    progress({ event: 'Finished' })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('message.update_window.stage_verifying')
    expect(wrapper.text()).not.toContain('message.update_window.restart')
    finishDownload()
    await flushPromises()
    expect(wrapper.text()).toContain('message.update_window.stage_ready')
    expect(wrapper.text()).toContain('message.update_window.restart')
    await wrapper.findAll('button')[0].trigger('click')
    await flushPromises()
    expect(mocks.hide).toHaveBeenCalledOnce()
    expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({ stage: 'ready', version: '2.0' }))
    expect(update.close).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('can retry listener initialization if the window was not ready', async () => {
    mocks.listen.mockRejectedValueOnce(new Error('listener unavailable'))
    mocks.check.mockResolvedValue(null)
    const wrapper = mount(WindowsUpdate, {
      global: {
        stubs: {
          BrandLogo: true,
          NProgress: true,
          NSpin: true,
          NButton: { template: '<button @click="$emit(\'click\')"><slot /></button>' }
        }
      }
    })
    await flushPromises()
    expect(wrapper.text()).toContain('message.update_window.stage_error')
    await wrapper.findAll('button')[1].trigger('click')
    await flushPromises()
    expect(mocks.check).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('message.update_window.stage_none')
    wrapper.unmount()
  })
})
