import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OnlineEnum } from '@/enums'

const mocks = vi.hoisted(() => ({
  getUserByIds: vi.fn(),
  applyPresence: vi.fn(),
  user: { userInfo: { uid: 'self' } }
}))

vi.mock('@/utils/ImRequestUtils', () => ({ getUserByIds: mocks.getUserByIds }))
vi.mock('@/stores/user', () => ({ useUserStore: () => mocks.user }))
vi.mock('@/stores/group', () => ({ useGroupStore: () => ({ applyPresence: mocks.applyPresence }) }))
vi.mock('@/stores/global', () => ({ useGlobalStore: () => ({}) }))
vi.mock('@/stores/feed', () => ({ useFeedStore: () => ({}) }))
vi.mock('@/utils/UnreadCountManager', () => ({ unreadCountManager: {} }))

import { useContactStore } from './contacts'

describe('contact presence', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.user.userInfo.uid = 'self'
  })

  it('does not let an older refresh overwrite a newer realtime update', async () => {
    let resolve!: (value: unknown[]) => void
    mocks.getUserByIds.mockReturnValue(new Promise((done) => (resolve = done)))
    const store = useContactStore()
    store.contactsList = [
      {
        uid: 'peer',
        remark: '',
        activeStatus: OnlineEnum.OFFLINE,
        lastOptTime: 1,
        hideMyPosts: false,
        hideTheirPosts: false
      }
    ]
    const refresh = store.refreshPresence()
    store.applyPresence([{ uid: 'peer', activeStatus: OnlineEnum.ONLINE, lastOptTime: 20 }])
    resolve([{ uid: 'peer', activeStatus: OnlineEnum.OFFLINE, lastOptTime: 10 }])
    await refresh
    expect(store.contactsList[0]).toMatchObject({ activeStatus: OnlineEnum.ONLINE, lastOptTime: 20 })
  })
})
