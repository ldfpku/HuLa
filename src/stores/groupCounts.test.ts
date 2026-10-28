import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const groupList = vi.hoisted(() => vi.fn())
vi.mock('@/utils/ImRequestUtils', () => ({ groupList }))
vi.mock('@/stores/global', () => ({ useGlobalStore: () => ({ currentSessionRoomId: 'room' }) }))
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ userInfo: { uid: 'self' } }) }))
vi.mock('./chat', () => ({ useChatStore: () => ({ getSession: vi.fn() }) }))

import { useGroupStore } from './group'

describe('group member counts', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    groupList.mockReset()
  })

  it('uses server totals and preserves a zero online count', async () => {
    groupList.mockResolvedValue([{ roomId: 'room', memberNum: 12, onlineNum: 3 }])
    const store = useGroupStore()
    await store.setGroupDetails()
    store.updateOnlineNum({ roomId: 'room', onlineNum: 0, isAdd: false })
    expect(store.getGroupDetailByRoomId('room')?.onlineNum).toBe(0)
    store.updateGroupNumber('room', 13, 1)
    expect(store.getGroupDetailByRoomId('room')).toMatchObject({ memberNum: 13, onlineNum: 1 })
  })

  it('does not present a missing group as zero members', () => {
    const store = useGroupStore()
    expect(store.getGroupDetailByRoomId('unknown')).toBeUndefined()
  })

  it('clears counts and details when changing accounts', async () => {
    groupList.mockResolvedValue([{ roomId: 'room', memberNum: 12, onlineNum: 3 }])
    const store = useGroupStore()
    await store.setGroupDetails()
    store.updateGroupNumber('room', 12, 3)
    store.clearAccountCache()
    expect(store.getGroupDetailByRoomId('room')).toBeUndefined()
    expect(store.onlineCountMap.room).toBeUndefined()
  })

  it('does not repopulate the new account with a stale group list', async () => {
    let resolveList!: (groups: unknown[]) => void
    groupList.mockReturnValue(new Promise((resolve) => (resolveList = resolve)))
    const store = useGroupStore()
    const pending = store.setGroupDetails()
    store.clearAccountCache()
    resolveList([{ roomId: 'old', memberNum: 12, onlineNum: 3 }])
    await pending
    expect(store.getGroupDetailByRoomId('old')).toBeUndefined()
  })
})
