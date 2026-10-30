import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, reactive, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  change: vi.fn(),
  read: vi.fn(),
  hide: vi.fn(),
  error: vi.fn(),
  user: {} as Record<string, unknown>,
  status: {} as Record<string, unknown>,
  global: {} as Record<string, unknown>
}))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getCurrent: () => ({ hide: mocks.hide, listen: vi.fn() }) },
  getCurrentWebviewWindow: () => ({ show: vi.fn().mockResolvedValue(undefined) })
}))
vi.mock('@tauri-apps/api/window', () => ({ Window: { getByLabel: vi.fn() } }))
vi.mock('@tauri-apps/api/tray', () => ({ TrayIcon: { getById: vi.fn() } }))
vi.mock('@tauri-apps/api/event', () => ({ emitTo: vi.fn() }))
vi.mock('@tauri-apps/plugin-process', () => ({ exit: vi.fn() }))
vi.mock('@/hooks/useWindow.ts', () => ({
  useWindow: () => ({ checkWinExist: vi.fn(), createWebviewWindow: vi.fn(), resizeWindow: vi.fn() })
}))
vi.mock('@/hooks/useOnlineStatus.ts', () => ({
  useOnlineStatus: () => ({
    currentState: ref(null),
    statusIcon: ref(''),
    statusTitle: ref(''),
    statusBgColor: ref(''),
    hasCustomState: ref(false),
    isConnectionPending: ref(false)
  })
}))
vi.mock('@/stores/user', () => ({ useUserStore: () => mocks.user }))
vi.mock('@/stores/userStatus', () => ({ useUserStatusStore: () => mocks.status }))
vi.mock('@/stores/global.ts', () => ({ useGlobalStore: () => mocks.global }))
vi.mock('@/stores/setting.ts', () => ({
  useSettingStore: () => reactive({ lockScreen: ref({ enable: false }), notification: { messageSound: true } })
}))
vi.mock('@/utils/ImRequestUtils', () => ({ changeUserState: mocks.change, getUserDetail: mocks.read }))
vi.mock('@/utils/PlatformConstants', () => ({ isWindows: () => false }))
vi.mock('@/components/windows/ActionBar.vue', () => ({ default: { template: '<div />' } }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

import OnlineStatusWindow from './onlineStatusWindow/index.vue'
import Tray from './Tray.vue'

const container = defineComponent({
  setup:
    (_, { slots, attrs }) =>
    () =>
      h('div', attrs, slots.default?.())
})

describe('user state error reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user = reactive({ userInfo: { uid: 'a', userStateId: '1' } })
    mocks.status = reactive({ stateList: ref([{ id: '5', title: '隐身', url: '' }]), stateId: ref('1') })
    mocks.global = reactive({ tipVisible: ref(false), isTrayMenuShow: ref(true) })
    mocks.read.mockResolvedValue({ uid: 'a', userStateId: '5' })
    mocks.change.mockRejectedValue(new Error('状态已保存，但同步失败，系统将自动重试'))
    Object.assign(window, { $message: { error: mocks.error, success: vi.fn() } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it.each([
    ['status window', OnlineStatusWindow],
    ['tray menu', Tray]
  ])('shows the saved-but-pending error in the %s and reconciles the state', async (_name, component) => {
    const wrapper = mount(component, { global: { stubs: { Flex: container, Scrollbar: container } } })
    const entry = wrapper.findAll('span').find((item) => item.text().includes('隐身'))
    expect(entry).toBeDefined()
    await entry!.trigger('click')
    await flushPromises()
    expect(mocks.error).toHaveBeenCalledWith('状态已保存，但同步失败，系统将自动重试')
    expect(mocks.read).toHaveBeenCalledWith(false)
    expect((mocks.user.userInfo as { userStateId: string }).userStateId).toBe('5')
    expect(mocks.hide).not.toHaveBeenCalled()
    wrapper.unmount()
    vi.restoreAllMocks()
  })

  it.each([
    ['status window', OnlineStatusWindow],
    ['tray menu', Tray]
  ])('prevents overlapping selections in the %s and supports keyboard activation', async (_name, component) => {
    let finish!: () => void
    mocks.change.mockReset().mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))
    const wrapper = mount(component, { global: { stubs: { Flex: container, Scrollbar: container } } })
    const button = wrapper.findAll('[role="button"]').find((item) => item.text().includes('隐身'))
    expect(button).toBeDefined()
    await button!.trigger('keydown', { key: 'Enter' })
    await button!.trigger('click')
    expect(mocks.change).toHaveBeenCalledOnce()
    expect(button!.attributes('aria-disabled')).toBe('true')
    finish()
    await flushPromises()
    expect(button!.attributes('aria-disabled')).toBe('false')
    wrapper.unmount()
    vi.restoreAllMocks()
  })
})
