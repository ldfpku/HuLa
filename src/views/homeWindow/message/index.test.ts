import { mount } from '@vue/test-utils'
import { defineComponent, h, reactive, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RoomTypeEnum } from '@/enums'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (value: { roomId: string }) => void>(),
  refresh: vi.fn(),
  load: vi.fn()
}))

const session = (roomId: string, type: RoomTypeEnum, activeTime: number, top = false) => ({
  roomId,
  type,
  activeTime,
  top,
  name: roomId,
  avatar: '',
  account: roomId,
  detailId: roomId,
  hotFlag: 0,
  unreadCount: 0,
  shield: false,
  muteNotification: 0
})
const chat = reactive({
  sessionList: [
    session('person-recent', RoomTypeEnum.SINGLE, 400),
    session('group-recent', RoomTypeEnum.GROUP, 300),
    session('person-pinned', RoomTypeEnum.SINGLE, 100, true),
    session('group-pinned', RoomTypeEnum.GROUP, 100, true)
  ],
  sessionOptions: { isLoading: false },
  currentSessionInfo: null,
  syncLoading: false,
  chatMessageListByRoomId: () => []
})
const details = reactive<Record<string, { onlineNum: number; memberNum: number }>>({
  'group-pinned': { onlineNum: 0, memberNum: 2 },
  'group-recent': { onlineNum: 3, memberNum: 10 }
})

vi.mock('pinia', async () => {
  const { toRefs } = await import('vue')
  return { storeToRefs: toRefs }
})
vi.mock('vue-router', () => ({ useRoute: () => ({ path: '/message' }) }))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, values?: { online: number; total: number }) =>
      key === 'message.message_list.group_count_value' && values ? `在线 ${values.online}/${values.total}` : key
  })
}))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getCurrent: () => ({ label: 'other' }) }
}))
vi.mock('@/hooks/useCommon.ts', () => ({ useCommon: () => ({ openMsgSession: vi.fn() }) }))
vi.mock('@/hooks/useMessage.ts', () => ({
  useMessage: () => ({
    handleMsgClick: vi.fn(),
    handleMsgDelete: vi.fn(),
    handleMsgDblclick: vi.fn(),
    visibleMenu: () => [],
    visibleSpecialMenu: () => []
  })
}))
vi.mock('@/hooks/useMitt', () => ({
  useMitt: {
    emit: vi.fn(),
    on: (event: string, callback: (value: { roomId: string }) => void) => mocks.handlers.set(event, callback)
  }
}))
vi.mock('@/hooks/useReplaceMsg.ts', () => ({
  useReplaceMsg: () => ({ checkRoomAtMe: vi.fn(), getMessageSenderName: vi.fn(), formatMessageContent: vi.fn() })
}))
vi.mock('@/hooks/useTauriListener', () => ({ useTauriListener: () => ({ addListener: vi.fn() }) }))
vi.mock('@/hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({
    browserOnline: ref(true),
    wsOnline: ref(true),
    wsRetrying: ref(false),
    wsOutageLong: ref(false)
  })
}))
vi.mock('@/stores/chat.ts', () => ({ useChatStore: () => chat }))
vi.mock('@/stores/global.ts', () => ({
  useGlobalStore: () => ({ currentSessionRoomId: '', unreadReady: true })
}))
vi.mock('@/stores/group.ts', () => ({
  useGroupStore: () => ({
    getUserInfo: () => undefined,
    getGroupDetailByRoomId: (roomId: string) => details[roomId],
    loadGroupDetails: mocks.load,
    refreshGroupCounts: mocks.refresh
  })
}))
vi.mock('@/stores/setting', () => ({ useSettingStore: () => reactive({ themes: { content: 'light' } }) }))
vi.mock('@/stores/bot', () => ({ useBotStore: () => ({ displayText: '' }) }))
vi.mock('@/utils/AvatarUtils', () => ({ AvatarUtils: { getAvatarUrl: () => '' } }))
vi.mock('@/utils/ComputedTime.ts', () => ({ formatTimestamp: () => '' }))

import MessageList from './index.vue'
import { MittEnum } from '@/enums'

const passthrough = defineComponent({
  setup(_, { slots }) {
    return () => h('div', slots.default?.())
  }
})

describe('desktop session list', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.handlers.clear()
    mocks.load.mockResolvedValue(undefined)
    mocks.refresh.mockResolvedValue(undefined)
  })
  afterEach(() => vi.useRealTimers())

  it('renders groups and people separately with authoritative counts', async () => {
    const wrapper = mount(MessageList, {
      global: {
        stubs: {
          ContextMenu: passthrough,
          NScrollbar: passthrough,
          NFlex: passthrough,
          NAvatar: true,
          NPopover: passthrough,
          NBadge: true
        }
      }
    })
    expect(wrapper.findAll('.msg-box').map((item) => item.attributes('data-key'))).toEqual([
      'group-pinned',
      'group-recent',
      'person-pinned',
      'person-recent'
    ])
    expect(wrapper.get('[data-key="group-pinned"]').text()).toContain('0/2')
    expect(wrapper.get('[data-key="group-recent"]').text()).toContain('3/10')
    expect(wrapper.text()).toContain('message.message_list.sections.groups')
    expect(wrapper.text()).toContain('message.message_list.sections.people')
    const scroll = vi.fn()
    wrapper.get('[data-key="person-recent"]').element.scrollIntoView = scroll
    await mocks.handlers.get(MittEnum.LOCATE_SESSION)?.({ roomId: 'person-recent' })
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.refresh).toHaveBeenCalledWith(['group-recent', 'group-pinned'])
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })
})
