import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getFriendPage: vi.fn(),
  user: { userInfo: { uid: 'self' } }
}))

vi.mock('@/utils/ImRequestUtils', () => ({ getFriendPage: mocks.getFriendPage }))
vi.mock('@/stores/user', () => ({ useUserStore: () => mocks.user }))
vi.mock('@/stores/group', () => ({ useGroupStore: () => ({}) }))
vi.mock('@/stores/global', () => ({ useGlobalStore: () => ({}) }))
vi.mock('@/stores/feed', () => ({ useFeedStore: () => ({}) }))
vi.mock('@/utils/UnreadCountManager', () => ({ unreadCountManager: {} }))

import { useContactStore } from './contacts'

const page = (uid: string) => ({
  list: [{ uid, remark: '', activeStatus: 0, lastOptTime: 0, hideMyPosts: false, hideTheirPosts: false }],
  cursor: '',
  isLast: true
})

describe('organization directory', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.user.userInfo.uid = 'self'
  })

  it('refreshes and checks the requested contact against the server', async () => {
    mocks.getFriendPage.mockResolvedValue(page('peer'))
    const store = useContactStore()
    await expect(store.refreshDirectoryContact('peer')).resolves.toBe('found')
    expect(store.contactsList.map((item) => item.uid)).toEqual(['peer'])
    expect(store.contactsLoaded).toBe(true)
    await expect(store.refreshDirectoryContact('other')).resolves.toBe('missing')
  })

  it('coalesces overlapping refreshes for the same account', async () => {
    let resolve!: (value: ReturnType<typeof page>) => void
    mocks.getFriendPage.mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    const store = useContactStore()
    const first = store.refreshDirectoryContact('peer')
    const second = store.getContactList(true)
    expect(mocks.getFriendPage).toHaveBeenCalledTimes(1)
    resolve(page('peer'))
    await expect(first).resolves.toBe('found')
    await expect(second).resolves.toBe(true)
  })

  it('does not replace another account directory with a late response', async () => {
    let resolveFirst!: (value: ReturnType<typeof page>) => void
    mocks.getFriendPage
      .mockReturnValueOnce(
        new Promise((done) => {
          resolveFirst = done
        })
      )
      .mockResolvedValueOnce(page('new-peer'))
    const store = useContactStore()
    const first = store.getContactList(true)
    mocks.user.userInfo.uid = 'other-account'
    await expect(store.getContactList(true)).resolves.toBe(true)
    resolveFirst(page('old-peer'))
    await expect(first).resolves.toBe(false)
    expect(store.contactsOwnerUid).toBe('other-account')
    expect(store.contactsList.map((item) => item.uid)).toEqual(['new-peer'])
  })

  it('keeps the previous directory and reports a failed refresh', async () => {
    mocks.getFriendPage.mockResolvedValueOnce(page('peer')).mockRejectedValueOnce(new Error('offline'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = useContactStore()
    await store.getContactList(true)
    await expect(store.refreshDirectoryContact('peer')).resolves.toBe('failed')
    expect(store.contactsLoadError).toBe(true)
    expect(store.contactsList[0].uid).toBe('peer')
    consoleError.mockRestore()
  })

  it('rejects a malformed directory response without reporting an absent user', async () => {
    mocks.getFriendPage.mockResolvedValue({ list: null })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = useContactStore()
    await expect(store.refreshDirectoryContact('peer')).resolves.toBe('failed')
    expect(store.contactsLoaded).toBe(false)
    expect(store.contactsLoadError).toBe(true)
    consoleError.mockRestore()
  })

  it('invalidates in-flight responses when account state is cleared', async () => {
    let resolve!: (value: ReturnType<typeof page>) => void
    mocks.getFriendPage.mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    const store = useContactStore()
    const pending = store.getContactList(true)
    store.resetAccountState()
    resolve(page('peer'))
    await expect(pending).resolves.toBe(false)
    expect(store.contactsList).toEqual([])
  })
})
