import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, reactive, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getUserByIds: vi.fn(),
  refresh: vi.fn(),
  open: vi.fn(),
  createWindow: vi.fn(),
  contacts: [] as { uid: string }[]
}))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/useCommon.ts', () => ({ useCommon: () => ({ userUid: ref('self'), openMsgSession: mocks.open }) }))
vi.mock('@/hooks/useDirectoryContact', () => ({
  useDirectoryContact: () => ({ refreshDirectoryContact: mocks.refresh })
}))
vi.mock('@/hooks/useWindow', () => ({ useWindow: () => ({ createWebviewWindow: mocks.createWindow }) }))
vi.mock('@/hooks/useMitt', () => ({ useMitt: { emit: vi.fn() } }))
vi.mock('@/layout/left/hook', () => ({ leftHook: () => ({ openContent: vi.fn() }) }))
vi.mock('@/stores/cached', () => ({ useCachedStore: () => ({ badgeById: vi.fn() }) }))
vi.mock('@/stores/chat', () => ({ useChatStore: () => ({ isGroup: false }) }))
vi.mock('@/stores/contacts.ts', () => ({ useContactStore: () => ({ contactsList: mocks.contacts }) }))
vi.mock('@/stores/global', () => ({ useGlobalStore: () => ({ currentSessionRoomId: 'room' }) }))
vi.mock('@/stores/group', () => ({ useGroupStore: () => ({ getUserInfo: mocks.getUser }) }))
vi.mock('@/stores/setting', () => ({ useSettingStore: () => reactive({ themes: ref({ content: 'light' }) }) }))
vi.mock('@/stores/userStatus', () => ({ useUserStatusStore: () => reactive({ stateList: ref([]) }) }))
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ userInfo: { uid: 'self' } }) }))
vi.mock('@/utils/ImRequestUtils', () => ({ getUserByIds: mocks.getUserByIds }))

import InfoPopover from './InfoPopover.vue'

const container = defineComponent({
  setup:
    (_, { slots, attrs }) =>
    () =>
      h('div', attrs, slots.default?.())
})
const button = defineComponent({
  setup:
    (_, { slots, attrs }) =>
    () =>
      h('button', attrs, slots.default?.())
})

describe('directory contact profile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.contacts = []
    mocks.getUser.mockReturnValue({ uid: 'peer', avatar: '', name: '', account: '' })
    mocks.getUserByIds.mockResolvedValue([{ uid: 'peer', avatar: '', name: 'Peer', account: 'peer@example.test' }])
    mocks.refresh.mockResolvedValue(true)
    mocks.open.mockResolvedValue(undefined)
  })

  it('loads missing profile fields and opens a verified directory contact without a friend window', async () => {
    const wrapper = mount(InfoPopover, {
      props: { uid: 'peer' },
      global: { stubs: { Flex: container, Button: button, Avatar: container, Tooltip: container, Popover: container } }
    })
    await flushPromises()
    expect(mocks.getUserByIds).toHaveBeenCalledWith(['peer'])
    expect(wrapper.text()).toContain('peer@example.test')
    expect(wrapper.text()).toContain('Peer')
    const refresh = wrapper.findAll('button').find((item) => item.text().includes('message.directory_contact.refresh'))
    expect(refresh).toBeDefined()
    await refresh!.trigger('click')
    await flushPromises()
    expect(mocks.refresh).toHaveBeenCalledWith('peer')
    expect(mocks.open).toHaveBeenCalledWith('peer')
    expect(mocks.createWindow).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not open a chat when the directory lookup fails', async () => {
    mocks.refresh.mockResolvedValue(false)
    const wrapper = mount(InfoPopover, {
      props: { uid: 'peer' },
      global: { stubs: { Flex: container, Button: button, Avatar: container, Tooltip: container, Popover: container } }
    })
    await flushPromises()
    const refresh = wrapper.findAll('button').find((item) => item.text().includes('message.directory_contact.refresh'))
    await refresh!.trigger('click')
    await flushPromises()
    expect(mocks.open).not.toHaveBeenCalled()
    expect(mocks.createWindow).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
