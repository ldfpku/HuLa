import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getItems: vi.fn(), send: vi.fn(), error: vi.fn() }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/utils/ImRequestUtils', () => ({ getDriveItems: mocks.getItems, sendDriveFileToRoom: mocks.send }))

import DrivePickerModal from './DrivePickerModal.vue'

const stubs = {
  Modal: { template: '<div><slot /></div>' },
  Flex: { template: '<div><slot /></div>' },
  Scrollbar: { template: '<div><slot /></div>' },
  Spin: { template: '<div><slot /></div>' },
  Button: { template: '<button><slot /></button>' }
}

describe('Drive picker', () => {
  it('discards a pending listing after the picker is closed', async () => {
    let resolveOld!: (value: unknown) => void
    let resolveNew!: (value: unknown) => void
    mocks.getItems.mockReset()
    mocks.getItems
      .mockReturnValueOnce(new Promise((resolve) => (resolveOld = resolve)))
      .mockReturnValueOnce(new Promise((resolve) => (resolveNew = resolve)))
    const wrapper = mount(DrivePickerModal, { props: { show: false, attach: true }, global: { stubs } })
    await wrapper.setProps({ show: true })
    await wrapper.setProps({ show: false })
    resolveOld({
      path: [],
      items: [{ id: 'old', kind: 'file', name: 'Old account file', size: 1, sendable: true }],
      limitBytes: 500
    })
    await flushPromises()
    await wrapper.setProps({ show: true })
    expect(wrapper.text()).not.toContain('Old account file')
    resolveNew({
      path: [],
      items: [{ id: 'new', kind: 'file', name: 'New account file', size: 1, sendable: true }],
      limitBytes: 500
    })
    await flushPromises()
    expect(wrapper.text()).toContain('New account file')
    wrapper.unmount()
  })

  it('reports a listing failure to the user', async () => {
    mocks.getItems.mockReset().mockRejectedValue(new Error('offline'))
    mocks.error.mockReset()
    Object.assign(window, { $message: { error: mocks.error } })
    const wrapper = mount(DrivePickerModal, { props: { show: false, attach: true }, global: { stubs } })
    await wrapper.setProps({ show: true })
    await flushPromises()
    expect(mocks.error).toHaveBeenCalledWith('home.chat_header.sidebar.group.files.picker_load_failed')
    expect(wrapper.get('[role="alert"]').text()).toContain('home.chat_header.sidebar.group.files.picker_retry')
    mocks.getItems.mockResolvedValue({ path: [], items: [], limitBytes: 500 })
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
