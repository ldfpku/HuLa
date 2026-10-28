import { shallowMount } from '@vue/test-utils'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AvatarUtils } from '@/utils/AvatarUtils'

const mocks = vi.hoisted(() => ({ getUserInfo: vi.fn() }))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/stores/feed', () => ({
  useFeedStore: defineStore('dynamic-list-test', {
    state: () => ({ feedList: [], feedOptions: { isLoading: false, isLast: true } })
  })
}))
vi.mock('@/stores/group', () => ({ useGroupStore: () => ({ getUserInfo: mocks.getUserInfo }) }))
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ userInfo: { uid: 'current' } }) }))
vi.mock('@/utils/ComputedTime', () => ({ formatTimestamp: () => '' }))

import { useFeedStore } from '@/stores/feed'
import DynamicList from './DynamicList.vue'

describe('feed avatar display', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mocks.getUserInfo.mockReset()
  })

  const renderAvatar = (avatar?: string) => {
    useFeedStore().feedList = [{ id: 'feed-1', uid: 'user-1', content: '', userAvatar: avatar }]
    const wrapper = shallowMount(DynamicList)
    return wrapper.get('avatar-stub').attributes('src')
  }

  it('uses the feed avatar if the user is not cached', () => {
    expect(renderAvatar('https://example.test/avatar.png')).toBe('https://example.test/avatar.png')
  })

  it('prefers the latest cached avatar', () => {
    mocks.getUserInfo.mockReturnValue({ avatar: '022' })
    expect(renderAvatar('001')).toBe('/avatar/022.webp')
  })

  it('uses the stable user fallback when no avatar exists', () => {
    expect(renderAvatar()).toBe(AvatarUtils.getAvatarUrl('', 'user-1'))
  })
})
