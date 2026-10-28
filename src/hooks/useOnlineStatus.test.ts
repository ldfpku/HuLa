import { reactive, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { OnlineEnum } from '@/enums'

const user = reactive({ activeStatus: OnlineEnum.OFFLINE, userStateId: '1' })
vi.mock('pinia', async () => {
  const { toRefs } = await import('vue')
  return { storeToRefs: toRefs }
})
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ userInfo: { uid: 'user' } }) }))
vi.mock('@/stores/group', () => ({ useGroupStore: () => ({ getUserInfo: () => user }) }))
vi.mock('@/stores/userStatus', () => ({
  useUserStatusStore: () => reactive({ currentState: null, stateList: [{ id: '1', title: '在线', url: '' }] })
}))

import { useOnlineStatus } from './useOnlineStatus'

describe('connection presence', () => {
  it('does not mistake the default online preference for a live connection', () => {
    const status = useOnlineStatus(ref('user'))
    expect(status.isOnline.value).toBe(false)
    expect(status.statusIcon.value).toBe('/status/offline.png')
    expect(status.statusTitle.value).toBe('home.profile_card.status.offline')
    user.activeStatus = OnlineEnum.ONLINE
    expect(status.isOnline.value).toBe(true)
    expect(status.statusIcon.value).toBe('/status/online.png')
    expect(status.statusTitle.value).toBe('home.profile_card.status.online')
  })
})
