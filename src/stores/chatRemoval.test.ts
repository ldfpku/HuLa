import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { RoomTypeEnum, SessionOperateEnum, TauriCommand } from '@/enums'
import type { SessionItem } from '@/services/types'

const mocks = vi.hoisted(() => {
  vi.stubGlobal(
    'Worker',
    class {
      postMessage() {}
      terminate() {}
    }
  )
  return {
    invoke: vi.fn(),
    getSessionDetail: vi.fn(),
    removed: new Set<string>(),
    refreshBadge: vi.fn()
  }
})
const globalStore = reactive({
  currentSessionRoomId: '',
  unreadReady: false,
  unReadMark: 0,
  updateCurrentSessionRoomId: (roomId: string) => {
    globalStore.currentSessionRoomId = roomId
  }
})
vi.mock('@/stores/global', () => ({ useGlobalStore: () => globalStore }))
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ userInfo: { uid: 'self' } }) }))
vi.mock('@/stores/feed', () => ({ useFeedStore: () => ({ unreadCount: 0 }) }))
vi.mock('@/stores/group', () => ({
  useGroupStore: () => ({
    get removedGroupIds() {
      return [...mocks.removed]
    },
    isRemovedGroup: (roomId: string) => mocks.removed.has(roomId),
    restoreGroup: (roomId: string) => mocks.removed.delete(roomId)
  })
}))
vi.mock('vue-router', () => ({ useRoute: () => ({ path: '/' }) }))
vi.mock('@/utils/TauriInvokeHandler', () => ({ invokeWithErrorHandler: mocks.invoke }))
vi.mock('@/utils/ImRequestUtils', () => ({
  getSessionDetail: mocks.getSessionDetail,
  markMsgRead: vi.fn().mockResolvedValue(undefined),
  getChatPurges: vi.fn().mockResolvedValue({ epoch: 0, rooms: [], messages: [] })
}))
vi.mock('@/utils/UnreadCountManager', () => ({
  unreadCountManager: {
    refreshBadge: mocks.refreshBadge,
    calculateTotal: vi.fn(),
    setUpdateCallback: vi.fn(),
    requestUpdate: vi.fn()
  }
}))
vi.mock('@/utils/RenderReplyContent', () => ({ renderReplyContent: vi.fn() }))

import { useChatStore } from './chat'

const room = (roomId: string): SessionItem => ({
  roomId,
  name: roomId,
  type: RoomTypeEnum.GROUP,
  hotFlag: 0,
  top: false,
  shield: false,
  muteNotification: 0,
  activeTime: 0,
  unreadCount: 0,
  avatar: '',
  text: '',
  detailId: roomId,
  account: roomId,
  id: roomId,
  operate: SessionOperateEnum.DISSOLUTION_GROUP,
  hide: false,
  allowScanEnter: false
})

describe('removed group sessions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mocks.removed.clear()
    globalStore.currentSessionRoomId = ''
    mocks.invoke.mockResolvedValue([])
  })

  it('removes the last session without reading a nonexistent fallback', () => {
    const store = useChatStore()
    store.sessionList = [room('gone')]
    globalStore.currentSessionRoomId = 'gone'
    store.removeSession('gone')
    expect(store.sessionList).toEqual([])
    expect(globalStore.currentSessionRoomId).toBe('')
    expect(store.getSession('gone')).toBeUndefined()
  })

  it('ignores stale SQLite sessions and removes old map entries on refresh', async () => {
    const store = useChatStore()
    mocks.invoke.mockResolvedValue([room('gone'), room('keep')])
    await store.getSessionList()
    expect(store.getSession('gone')).toBeDefined()
    mocks.removed.add('gone')
    await store.getSessionList()
    expect(store.sessionList.map((session) => session.roomId)).toEqual(['keep'])
    expect(store.getSession('gone')).toBeUndefined()
  })

  it('filters a list request that finishes after dissolution', async () => {
    let resolve!: (sessions: SessionItem[]) => void
    mocks.invoke.mockReturnValueOnce(
      new Promise<SessionItem[]>((complete) => {
        resolve = complete
      })
    )
    const store = useChatStore()
    const pending = store.getSessionList()
    mocks.removed.add('gone')
    store.removeSession('gone')
    resolve([room('gone'), room('keep')])
    await pending
    expect(store.sessionList.map((session) => session.roomId)).toEqual(['keep'])
  })

  it('queues an authoritative refresh when a local-first request is already in flight', async () => {
    let resolve!: (sessions: SessionItem[]) => void
    mocks.invoke
      .mockReturnValueOnce(
        new Promise<SessionItem[]>((complete) => {
          resolve = complete
        })
      )
      .mockResolvedValueOnce([])
    const store = useChatStore()
    const pending = store.getSessionList()
    const fresh = store.getSessionList(true)
    expect(store.sessionOptions.isLoading).toBe(true)
    resolve([room('gone')])
    await pending
    await fresh
    expect(mocks.invoke).toHaveBeenCalledTimes(2)
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      TauriCommand.LIST_CONTACTS,
      { forceRefresh: true },
      expect.any(Object)
    )
    await vi.waitFor(() => expect(store.sessionList).toEqual([]))
  })

  it('does not reinsert a group from an older session detail response', async () => {
    let resolve!: (session: SessionItem) => void
    mocks.getSessionDetail.mockReturnValueOnce(
      new Promise<SessionItem>((complete) => {
        resolve = complete
      })
    )
    const store = useChatStore()
    const pending = store.addSession('gone')
    mocks.removed.add('gone')
    store.removeSession('gone')
    resolve(room('gone'))
    await pending
    expect(store.getSession('gone')).toBeUndefined()
  })

  it('restores a rejoined group only from a new authoritative request', async () => {
    mocks.removed.add('rejoined')
    mocks.invoke.mockResolvedValue([room('rejoined')])
    const store = useChatStore()
    await store.getSessionList(true)
    expect(mocks.removed.has('rejoined')).toBe(false)
    expect(store.getSession('rejoined')).toBeDefined()
  })
})
