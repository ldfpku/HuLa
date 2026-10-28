import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OnlineEnum, RoomTypeEnum } from '@/enums'

const { groupList, getGroupDetail, chatStore, userStore, history } = vi.hoisted(() => ({
  groupList: vi.fn(),
  getGroupDetail: vi.fn(),
  chatStore: {
    getSession: vi.fn(),
    sessionList: [] as Array<{ roomId: string; detailId: string; type: number }>,
    updateSession: vi.fn()
  },
  userStore: { userInfo: { uid: 'self', name: 'Self', avatar: '', avatarUpdateTime: 0 } },
  history: vi.fn()
}))
vi.mock('@/utils/ImRequestUtils', () => ({ groupList, getGroupDetail }))
vi.mock('@/stores/global', () => ({ useGlobalStore: () => ({ currentSessionRoomId: 'room' }) }))
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

describe('group member counts', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    groupList.mockReset()
    getGroupDetail.mockReset()
    chatStore.sessionList = []
    chatStore.updateSession.mockReset()
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
})
