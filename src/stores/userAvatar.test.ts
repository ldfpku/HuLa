import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  uploadAvatar: vi.fn(),
  history: [{ uid: 'user-1', avatar: '' }],
  groups: { first: [{ uid: 'user-1', avatar: '' }], second: [{ uid: 'user-1', avatar: '' }] }
}))
vi.mock('@/utils/ImRequestUtils', () => ({ getUserDetail: vi.fn(), uploadAvatar: mocks.uploadAvatar }))
vi.mock('@/utils/PathUtil', () => ({}))
vi.mock('./global', () => ({ useGlobalStore: () => ({}) }))
vi.mock('./group', () => ({ useGroupStore: () => ({ userListMap: mocks.groups }) }))
vi.mock('./loginHistory', () => ({ useLoginHistoriesStore: () => ({ loginHistories: mocks.history }) }))

import { SexEnum } from '@/enums'
import type { UserInfoType } from '@/services/types'
import { useUserStore } from './user'

const makeUser = (uid: string): UserInfoType => ({
  uid,
  account: 'user',
  email: '',
  avatar: '',
  name: 'User',
  modifyNameChance: 0,
  sex: SexEnum.MAN,
  userStateId: '',
  avatarUpdateTime: 0,
  client: 'PC',
  resume: ''
})

describe('profile avatar updates', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.uploadAvatar.mockResolvedValue(undefined)
    mocks.history[0].avatar = ''
    mocks.groups.first[0].avatar = ''
    mocks.groups.second[0].avatar = ''
  })

  it('saves the avatar and updates the account, history and all member caches', async () => {
    const store = useUserStore()
    store.userInfo = makeUser('user-1')
    await store.updateAvatar('022')
    expect(mocks.uploadAvatar).toHaveBeenCalledWith({ avatar: '022' })
    expect(store.userInfo.avatar).toBe('022')
    expect(store.userInfo.avatarUpdateTime).toBeGreaterThan(0)
    expect(mocks.history[0].avatar).toBe('022')
    expect(mocks.groups.first[0].avatar).toBe('022')
    expect(mocks.groups.second[0].avatar).toBe('022')
  })

  it('does not change cached avatars when saving fails', async () => {
    const store = useUserStore()
    store.userInfo = makeUser('user-1')
    mocks.uploadAvatar.mockRejectedValue(new Error('save failed'))
    await expect(store.updateAvatar('021')).rejects.toThrow('save failed')
    expect(store.userInfo.avatar).toBe('')
    expect(mocks.history[0].avatar).toBe('')
    expect(mocks.groups.first[0].avatar).toBe('')
  })

  it('does not apply an old account update after switching accounts', async () => {
    const store = useUserStore()
    store.userInfo = makeUser('user-1')
    let finish!: () => void
    mocks.uploadAvatar.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
    const pending = store.updateAvatar('020')
    store.userInfo = makeUser('user-2')
    finish()
    await expect(pending).rejects.toThrow('账号已切换')
    expect(store.userInfo.avatar).toBe('')
    expect(mocks.history[0].avatar).toBe('')
  })
})
