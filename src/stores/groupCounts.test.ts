import { createPinia, setActivePinia } from 'pinia'
import { createApp } from 'vue'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OnlineEnum, RoomTypeEnum } from '@/enums'

const { groupList, getGroupDetail, exitGroup, groupListMember, chatStore, globalStore, userStore, history } =
  vi.hoisted(() => ({
    groupList: vi.fn(),
    getGroupDetail: vi.fn(),
    exitGroup: vi.fn(),
    groupListMember: vi.fn(),
    chatStore: {
      getSession: vi.fn(),
      addSession: vi.fn(),
      sessionList: [] as Array<{ roomId: string; detailId: string; type: number }>,
      updateSession: vi.fn(),
      removeSession: vi.fn(),
      clearRoomMessages: vi.fn(),
      getSessionList: vi.fn()
    },
    globalStore: { currentSessionRoomId: 'room', updateCurrentSessionRoomId: vi.fn() },
    userStore: { userInfo: { uid: 'self', name: 'Self', avatar: '', avatarUpdateTime: 0 } },
    history: vi.fn()
  }))
vi.mock('@/utils/ImRequestUtils', () => ({ groupList, getGroupDetail, exitGroup, groupListMember }))
vi.mock('@/stores/global', () => ({ useGlobalStore: () => globalStore }))
vi.mock('@/stores/user', () => ({ useUserStore: () => userStore }))
vi.mock('@/stores/loginHistory', () => ({ useLoginHistoriesStore: () => ({ updateLoginHistory: history }) }))
vi.mock('./chat', () => ({ useChatStore: () => chatStore }))

import { useGroupStore } from './group'

const detail = {
  roomId: 'room',
  groupName: 'Group',
  avatar: '',
  account: 'room',
  roleId: 1,
  memberNum: 12,
  onlineNum: 3,
  remark: '',
  myName: '',
  allowScanEnter: false
}

const deferred = () => {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((complete, fail) => {
    resolve = complete
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('group member counts', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    groupList.mockReset()
    getGroupDetail.mockReset()
    exitGroup.mockReset()
    groupListMember.mockReset()
    chatStore.sessionList = []
    chatStore.getSession
      .mockReset()
      .mockImplementation((roomId: string) => chatStore.sessionList.find((item) => item.roomId === roomId))
    chatStore.addSession.mockReset().mockImplementation(async (roomId: string) => {
      chatStore.sessionList.push({ roomId, detailId: roomId, type: RoomTypeEnum.GROUP })
    })
    chatStore.updateSession.mockReset()
    chatStore.clearRoomMessages.mockReset()
    chatStore.getSessionList.mockReset()
    chatStore.removeSession.mockReset().mockImplementation((roomId: string) => {
      chatStore.sessionList = chatStore.sessionList.filter((item) => item.roomId !== roomId)
    })
    globalStore.currentSessionRoomId = 'room'
    globalStore.updateCurrentSessionRoomId.mockReset().mockImplementation((roomId: string) => {
      globalStore.currentSessionRoomId = roomId
    })
    localStorage.clear()
    history.mockReset()
    userStore.userInfo.name = 'Self'
    userStore.userInfo.avatar = ''
    userStore.userInfo.avatarUpdateTime = 0
  })

  it('uses server totals and preserves a zero online count', async () => {
    groupList.mockResolvedValue([{ ...detail }])
    const store = useGroupStore()
    await store.setGroupDetails()
    store.updateOnlineNum({ roomId: 'room', onlineNum: 0, isAdd: false })
    expect(store.getGroupDetailByRoomId('room')?.onlineNum).toBe(0)
    store.updateGroupNumber('room', 13, 1)
    expect(store.getGroupDetailByRoomId('room')).toMatchObject({ memberNum: 13, onlineNum: 1 })
  })

  it('does not count duplicate presence events or invent a count for unknown members', async () => {
    groupList.mockResolvedValue([{ ...detail }])
    const store = useGroupStore()
    await store.setGroupDetails()
    store.updateMemberCache('room', [
      {
        uid: 'member',
        name: 'Member',
        account: 'member',
        avatar: '',
        lastOptTime: 0,
        activeStatus: OnlineEnum.ONLINE
      }
    ])
    store.updateOnlineNum({ roomId: 'room', uid: 'member', isAdd: true })
    expect(store.getGroupDetailByRoomId('room')?.onlineNum).toBe(3)
    store.updateOnlineNum({ roomId: 'room', uid: 'unknown', isAdd: false })
    expect(store.getGroupDetailByRoomId('room')?.onlineNum).toBe(3)
    store.updateOnlineNum({ roomId: 'room', uid: 'member', isAdd: false })
    expect(store.getGroupDetailByRoomId('room')?.onlineNum).toBe(2)
    expect(store.onlineCountMap.room).toBe(2)
    store.updateUserItem('member', { activeStatus: OnlineEnum.OFFLINE }, 'room')
    store.updateOnlineNum({ roomId: 'room', uid: 'member', isAdd: false })
    expect(store.getGroupDetailByRoomId('room')?.onlineNum).toBe(2)
  })

  it('updates the cached nickname in all rooms without overwriting group nicknames', () => {
    const store = useGroupStore()
    const member = {
      uid: 'member',
      name: 'Old',
      account: 'member',
      avatar: '',
      lastOptTime: 0,
      activeStatus: OnlineEnum.ONLINE,
      myName: 'Group alias'
    }
    store.updateMemberCache('room', [{ ...member }])
    store.updateMemberCache('other', [{ ...member }])
    store.updateCachedUserName('member', 'New')
    expect(store.userListMap.room[0]).toMatchObject({ name: 'New', myName: 'Group alias' })
    expect(store.userListMap.other[0]).toMatchObject({ name: 'New', myName: 'Group alias' })
  })

  it('propagates profile updates to relevant sessions and the signed-in account', () => {
    chatStore.sessionList = [
      { roomId: 'private', detailId: 'self', type: RoomTypeEnum.SINGLE },
      { roomId: 'group', detailId: 'self', type: RoomTypeEnum.GROUP },
      { roomId: 'other', detailId: 'other', type: RoomTypeEnum.SINGLE }
    ]
    const store = useGroupStore()
    expect(store.applyUserProfileChange({ uid: 'self', name: 'New' })).toBe(true)
    expect(chatStore.updateSession).toHaveBeenCalledOnce()
    expect(chatStore.updateSession).toHaveBeenCalledWith('private', { name: 'New' })
    expect(userStore.userInfo.name).toBe('New')
    expect(history).toHaveBeenCalledOnce()
    expect(store.applyUserProfileChange({ uid: 'self', name: '' })).toBe(false)
  })

  it('propagates avatar-only updates without changing the user name', () => {
    chatStore.sessionList = [{ roomId: 'private', detailId: 'self', type: RoomTypeEnum.SINGLE }]
    const store = useGroupStore()
    store.updateMemberCache('room', [
      {
        uid: 'self',
        name: 'Self',
        account: 'self',
        avatar: '',
        lastOptTime: 0,
        activeStatus: OnlineEnum.ONLINE
      }
    ])
    expect(store.applyUserProfileChange({ uid: 'self', avatar: '022' })).toBe(true)
    expect(store.userListMap.room[0]).toMatchObject({ name: 'Self', avatar: '022' })
    expect(chatStore.updateSession).toHaveBeenCalledWith('private', { avatar: '022' })
    expect(userStore.userInfo).toMatchObject({ name: 'Self', avatar: '022' })
    expect(userStore.userInfo.avatarUpdateTime).toBeGreaterThan(0)
    expect(history).toHaveBeenCalledOnce()
    expect(store.applyUserProfileChange({ uid: 'self', avatar: '' })).toBe(false)
  })

  it('does not present a missing group as zero members', () => {
    const store = useGroupStore()
    expect(store.getGroupDetailByRoomId('unknown')).toBeUndefined()
  })

  it('synchronizes a user’s connection status across cached rooms without changing server totals', async () => {
    groupList.mockResolvedValue([{ ...detail }])
    const store = useGroupStore()
    await store.setGroupDetails()
    const member = {
      uid: 'member',
      name: 'Member',
      account: 'member',
      avatar: '',
      lastOptTime: 1,
      activeStatus: OnlineEnum.ONLINE
    }
    store.updateMemberCache('room', [{ ...member }])
    store.updateMemberCache('other', [{ ...member }])
    store.applyPresence([{ uid: 'member', activeStatus: OnlineEnum.OFFLINE, lastOptTime: 2 }])
    expect(store.userListMap.room[0].activeStatus).toBe(OnlineEnum.OFFLINE)
    expect(store.userListMap.other[0].activeStatus).toBe(OnlineEnum.OFFLINE)
    expect(store.onlineCountMap.room).toBe(0)
    expect(store.getGroupDetailByRoomId('room')?.onlineNum).toBe(3)
    store.applyPresence([{ uid: 'member', activeStatus: OnlineEnum.ONLINE, lastOptTime: 1 }])
    expect(store.userListMap.room[0].activeStatus).toBe(OnlineEnum.OFFLINE)
  })

  it('clears counts and details when changing accounts', async () => {
    groupList.mockResolvedValue([{ ...detail }])
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

  it('fetches complete details when the group list contains only basic information', async () => {
    groupList.mockResolvedValue([{ roomId: 'room', roomName: 'Group' }])
    getGroupDetail.mockResolvedValue({ ...detail, onlineNum: 0 })
    const store = useGroupStore()
    await store.setGroupDetails()
    expect(store.getGroupDetailByRoomId('room')).toBeUndefined()
    await store.loadGroupDetails(['room'])
    expect(getGroupDetail).toHaveBeenCalledOnce()
    expect(store.getGroupDetailByRoomId('room')).toMatchObject({ memberNum: 12, onlineNum: 0 })
  })

  it('uses the full list without requesting every group again', async () => {
    groupList.mockResolvedValue([{ ...detail }])
    const store = useGroupStore()
    await store.setGroupDetails()
    await store.loadGroupDetails(['room'])
    expect(getGroupDetail).not.toHaveBeenCalled()
    expect(store.getGroupDetailByRoomId('room')).toMatchObject({ memberNum: 12, onlineNum: 3 })
  })

  it('really refreshes details when explicitly requested', async () => {
    groupList.mockResolvedValue([{ ...detail }])
    getGroupDetail.mockResolvedValue({ ...detail, memberNum: 13, onlineNum: 1 })
    const store = useGroupStore()
    await store.setGroupDetails()
    await store.addGroupDetail('room', true)
    expect(store.getGroupDetailByRoomId('room')).toMatchObject({ memberNum: 13, onlineNum: 1 })
  })

  it('refreshes current counts in one list request, including zero', async () => {
    groupList.mockResolvedValueOnce([{ ...detail }]).mockResolvedValueOnce([{ ...detail, memberNum: 13, onlineNum: 0 }])
    const store = useGroupStore()
    await store.setGroupDetails()
    await store.refreshGroupCounts(['room'])
    expect(store.getGroupDetailByRoomId('room')).toMatchObject({ memberNum: 13, onlineNum: 0 })
    expect(store.onlineCountMap.room).toBe(0)
    expect(getGroupDetail).not.toHaveBeenCalled()
  })

  it('refreshes older servers that return only basic group records', async () => {
    groupList.mockResolvedValueOnce([{ ...detail }]).mockResolvedValueOnce([{ roomId: 'room' }])
    getGroupDetail.mockResolvedValue({ ...detail, memberNum: 14, onlineNum: 2 })
    const store = useGroupStore()
    await store.setGroupDetails()
    await store.refreshGroupCounts(['room'])
    expect(store.getGroupDetailByRoomId('room')).toMatchObject({ memberNum: 14, onlineNum: 2 })
  })

  it('does not apply a count refresh after an account switch', async () => {
    let resolveList!: (groups: unknown[]) => void
    groupList.mockReturnValue(new Promise((resolve) => (resolveList = resolve)))
    const store = useGroupStore()
    const pending = store.refreshGroupCounts(['room'])
    store.clearAccountCache()
    resolveList([{ ...detail }])
    await pending
    expect(store.getGroupDetailByRoomId('room')).toBeUndefined()
    expect(store.onlineCountMap.room).toBeUndefined()
  })

  it('removes a dissolved group and its cached members, safely selecting an empty fallback', async () => {
    groupList.mockResolvedValue([{ ...detail }])
    exitGroup.mockResolvedValue(true)
    chatStore.sessionList = [{ roomId: 'room', detailId: 'room', type: RoomTypeEnum.GROUP }]
    const store = useGroupStore()
    await store.setGroupDetails()
    store.updateGroupNumber('room', 12, 3)
    store.updateMemberCache('room', [
      { uid: 'self', name: 'Self', account: 'self', avatar: '', activeStatus: OnlineEnum.ONLINE, lastOptTime: 0 }
    ])
    await store.exitGroup('room', true)
    expect(exitGroup).toHaveBeenCalledWith({ roomId: 'room', dissolve: true })
    expect(store.getGroupDetail('room')).toBeUndefined()
    expect(store.userListMap.room).toBeUndefined()
    expect(store.onlineCountMap.room).toBeUndefined()
    expect(chatStore.sessionList).toEqual([])
    expect(chatStore.clearRoomMessages).toHaveBeenCalledWith('room')
    expect(globalStore.currentSessionRoomId).toBe('')
    expect(chatStore.getSessionList).toHaveBeenCalledWith(true)
    expect(store.isRemovedGroup('room')).toBe(true)
  })

  it('deduplicates requests and preserves the group on failure so it can be retried', async () => {
    const request = deferred()
    exitGroup.mockReturnValueOnce(request.promise)
    const store = useGroupStore()
    const first = store.exitGroup('room', true)
    const duplicate = store.exitGroup('room', true)
    request.reject(new Error('offline'))
    await expect(first).rejects.toThrow('offline')
    await expect(duplicate).rejects.toThrow('offline')
    expect(exitGroup).toHaveBeenCalledOnce()
    expect(chatStore.removeSession).not.toHaveBeenCalled()
    expect(store.isRemovedGroup('room')).toBe(false)
    exitGroup.mockResolvedValue(true)
    await store.exitGroup('room', true)
    expect(exitGroup).toHaveBeenCalledTimes(2)
    expect(store.isRemovedGroup('room')).toBe(true)
  })

  it('does not remove the newly selected room when the request completes', async () => {
    let resolve!: () => void
    exitGroup.mockReturnValue(
      new Promise<void>((complete) => {
        resolve = complete
      })
    )
    const store = useGroupStore()
    const pending = store.exitGroup('room', true)
    globalStore.currentSessionRoomId = 'other'
    resolve()
    await pending
    expect(chatStore.removeSession).toHaveBeenCalledWith('room')
    expect(globalStore.currentSessionRoomId).toBe('other')
  })

  it('does not restore a dissolved group from an older group list or detail response', async () => {
    let resolveList!: (groups: unknown[]) => void
    let resolveDetail!: (group: unknown) => void
    groupList.mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve
      })
    )
    getGroupDetail.mockReturnValue(
      new Promise((resolve) => {
        resolveDetail = resolve
      })
    )
    const store = useGroupStore()
    const list = store.setGroupDetails()
    const detailRequest = store.addGroupDetail('room', true)
    store.removeGroup('room')
    store.removeGroup('room')
    resolveList([{ ...detail }])
    resolveDetail({ ...detail })
    await Promise.all([list, detailRequest])
    expect(store.getGroupDetail('room')).toBeUndefined()
    expect(store.removedGroupIds).toEqual(['room'])
    store.restoreGroup('room')
    getGroupDetail.mockResolvedValue({ ...detail })
    await store.addGroupDetail('room', true)
    expect(store.getGroupDetail('room')).toMatchObject(detail)
  })

  it('does not restore members from an older request after removal', async () => {
    let resolveMembers!: (members: unknown[]) => void
    groupListMember.mockReturnValue(
      new Promise((resolve) => {
        resolveMembers = resolve
      })
    )
    const store = useGroupStore()
    const pending = store.getGroupUserList('room', true)
    store.removeGroup('room')
    resolveMembers([{ uid: 'self', activeStatus: OnlineEnum.ONLINE }])
    await pending
    expect(store.userListMap.room).toBeUndefined()
    store.updateMemberCache('room', [])
    expect(store.userListMap.room).toBeUndefined()
    expect(store.onlineCountMap.room).toBeUndefined()
  })

  it('keeps removal markers across a restart and clears them for a new account', () => {
    const first = createPinia().use(createPersistedState({ auto: true }))
    createApp({}).use(first)
    const store = useGroupStore(first)
    store.removeGroup('room')
    store.$persist()
    const second = createPinia().use(createPersistedState({ auto: true }))
    createApp({}).use(second)
    const restored = useGroupStore(second)
    expect(restored.isRemovedGroup('room')).toBe(true)
    restored.clearAccountCache()
    expect(restored.isRemovedGroup('room')).toBe(false)
  })

  it('does not apply a completed exit to another account', async () => {
    let resolve!: () => void
    exitGroup.mockReturnValue(
      new Promise<void>((complete) => {
        resolve = complete
      })
    )
    const store = useGroupStore()
    const pending = store.exitGroup('room', true)
    store.clearAccountCache()
    resolve()
    await expect(pending).rejects.toThrow('账号已切换')
    expect(chatStore.removeSession).not.toHaveBeenCalled()
  })

  it('loads the creator’s room directly when the refreshed list does not contain it yet', async () => {
    getGroupDetail.mockResolvedValue({ ...detail })
    groupListMember.mockResolvedValue([])
    const store = useGroupStore()
    await expect(store.loadCreatedGroup({ roomId: 'room' })).resolves.toBe('room')
    expect(chatStore.getSessionList).toHaveBeenCalledWith(true)
    expect(chatStore.addSession).toHaveBeenCalledWith('room')
    expect(globalStore.currentSessionRoomId).toBe('room')
    expect(store.getGroupDetail('room')).toMatchObject(detail)
  })

  it('waits for the creator’s list refresh and does not depend on WebSocket delivery', async () => {
    const refresh = deferred()
    chatStore.getSessionList.mockReturnValue(refresh.promise)
    getGroupDetail.mockResolvedValue({ ...detail })
    groupListMember.mockResolvedValue([])
    const store = useGroupStore()
    const pending = store.loadCreatedGroup({ id: 'legacy-detail' })
    expect(chatStore.addSession).not.toHaveBeenCalled()
    globalStore.currentSessionRoomId = 'previous'
    chatStore.sessionList = [{ roomId: 'room', detailId: 'legacy-detail', type: RoomTypeEnum.GROUP }]
    refresh.resolve()
    await expect(pending).resolves.toBe('room')
    expect(chatStore.addSession).not.toHaveBeenCalled()
    expect(globalStore.currentSessionRoomId).toBe('room')
  })

  it('does not report success for a malformed create response', async () => {
    await expect(useGroupStore().loadCreatedGroup({})).rejects.toThrow('创建群聊响应缺少群聊标识')
    expect(chatStore.addSession).not.toHaveBeenCalled()
  })

  it('recognizes a group rejoined while offline from a new server group list', async () => {
    const store = useGroupStore()
    store.removeGroup('room')
    groupList.mockResolvedValue([{ ...detail }])
    await store.setGroupDetails()
    expect(store.isRemovedGroup('room')).toBe(false)
    expect(store.getGroupDetail('room')).toMatchObject(detail)
  })
})
