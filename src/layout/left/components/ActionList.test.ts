import { mount } from '@vue/test-utils'
import { reactive, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ click: vi.fn(), workspace: { sidebarMenuOpen: false } }))
vi.mock('pinia', async () => {
  const { toRefs } = await import('vue')
  return { storeToRefs: toRefs }
})
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getCurrent: () => ({ listen: vi.fn().mockResolvedValue(() => {}) }) }
}))
vi.mock('@/hooks/useTauriListener.ts', () => ({ useTauriListener: () => ({ addListener: vi.fn() }) }))
vi.mock('@/common/backend', () => ({ APP_FEATURES: { plugins: false } }))
vi.mock('@/stores/global.ts', () => ({
  useGlobalStore: () => ({ unReadMark: { newFriendUnreadCount: 0, newGroupUnreadCount: 0 }, unreadReady: true })
}))
vi.mock('@/stores/plugins.ts', () => ({ usePluginsStore: () => reactive({ plugins: [], updatePlugin: vi.fn() }) }))
vi.mock('@/stores/feed.ts', () => ({ useFeedStore: () => reactive({ unreadCount: 0 }) }))
vi.mock('@/stores/menuTop.ts', () => ({ useMenuTopStore: () => reactive({ menuTop: [] }) }))
vi.mock('@/stores/setting.ts', () => ({ useSettingStore: () => reactive({ showMode: 'icon' }) }))
vi.mock('@/stores/workspace', () => ({ useWorkspaceStore: () => mocks.workspace }))
vi.mock('../config.tsx', () => ({
  useItemsBottom: () => ref([]),
  useMoreList: () => [{ label: 'Settings', icon: 'settings', click: mocks.click }]
}))
vi.mock('../hook.ts', () => ({
  leftHook: () => ({
    activeUrl: ref('mail'),
    openWindowsList: ref(new Set()),
    settingShow: ref(false),
    tipShow: ref(false),
    pageJumps: vi.fn()
  })
}))
vi.mock('./definePlugins/index.vue', () => ({ default: { template: '<div />' } }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

import ActionList from './ActionList.vue'

describe('sidebar more menu', () => {
  afterEach(() => {
    vi.clearAllMocks()
    mocks.workspace.sidebarMenuOpen = false
    document.body.innerHTML = ''
  })

  it('opens once per click, blocks the embedded view, and closes after an action', async () => {
    const wrapper = mount(ActionList, { attachTo: document.body })
    const button = wrapper.get('[aria-label="home.action.more"]')
    await button.trigger('click')
    expect(mocks.workspace.sidebarMenuOpen).toBe(true)
    expect(button.attributes('aria-expanded')).toBe('true')
    const item = document.querySelector<HTMLElement>('[aria-label="Settings"]')
    expect(item).not.toBeNull()
    item?.click()
    await wrapper.vm.$nextTick()
    expect(mocks.click).toHaveBeenCalledOnce()
    expect(mocks.workspace.sidebarMenuOpen).toBe(false)
    expect(button.attributes('aria-expanded')).toBe('false')
    await button.trigger('keydown', { key: 'Enter' })
    expect(mocks.workspace.sidebarMenuOpen).toBe(true)
    wrapper.unmount()
    expect(mocks.workspace.sidebarMenuOpen).toBe(false)
  })
})
