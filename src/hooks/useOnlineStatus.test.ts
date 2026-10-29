import { reactive, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OnlineEnum } from '@/enums'

const peer = reactive({ activeStatus: OnlineEnum.OFFLINE, userStateId: '1' })
const currentUser = reactive({ uid: 'user', userStateId: '1' })
const connection = ref<'unknown' | 'connected' | 'connecting' | 'disconnected' | 'error'>('unknown')
vi.mock('pinia', async () => {
  const { toRefs } = await import('vue')
  return { storeToRefs: toRefs }
})
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ userInfo: currentUser }) }))
vi.mock('@/stores/group', () => ({
  useGroupStore: () => ({ getUserInfo: (uid: string) => (uid === 'peer' ? peer : undefined) })
}))
vi.mock('@/stores/userStatus', () => ({
  useUserStatusStore: () =>
    reactive({
      currentState: null,
      stateList: [
        { id: '1', title: '在线', url: '' },
        { id: '2', title: '忙碌', url: '' }
      ]
    })
}))
vi.mock('@/hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ wsStatus: connection }) }))

import { useOnlineStatus } from './useOnlineStatus'

describe('connection presence', () => {
  beforeEach(() => {
    peer.activeStatus = OnlineEnum.OFFLINE
    currentUser.userStateId = '1'
    connection.value = 'unknown'
  })

  it('does not mistake the default online preference for a live connection', () => {
    const status = useOnlineStatus(ref('peer'))
    expect(status.isOnline.value).toBe(false)
    expect(status.statusIcon.value).toBe('/status/offline.png')
    expect(status.statusTitle.value).toBe('home.profile_card.status.offline')
    peer.activeStatus = OnlineEnum.ONLINE
    expect(status.isOnline.value).toBe(true)
    expect(status.statusIcon.value).toBe('/status/online.png')
    expect(status.statusTitle.value).toBe('home.profile_card.status.online')
  })

  it('shows the current user as connected even when group-member caches are empty', () => {
    connection.value = 'connected'
    const status = useOnlineStatus()
    expect(status.isOnline.value).toBe(true)
    expect(status.statusTitle.value).toBe('home.profile_card.status.online')
    expect(useOnlineStatus(ref('user')).isOnline.value).toBe(true)
  })

  it('distinguishes connecting and unknown from an established offline state', () => {
    const status = useOnlineStatus()
    expect(status.statusTitle.value).toBe('home.profile_card.status.unknown')
    connection.value = 'connecting'
    expect(status.statusTitle.value).toBe('home.profile_card.status.connecting')
    expect(status.isOnline.value).toBe(false)
    connection.value = 'connected'
    expect(status.statusTitle.value).toBe('home.profile_card.status.online')
  })

  it('does not present a missing peer record as confirmed offline', () => {
    const status = useOnlineStatus(ref('missing'))
    expect(status.connectionKnown.value).toBe(false)
    expect(status.connectionTitle.value).toBe('home.profile_card.status.unknown')
  })

  it('keeps the current user’s chosen busy state when connected', () => {
    currentUser.userStateId = '2'
    connection.value = 'connected'
    const status = useOnlineStatus()
    expect(status.isOnline.value).toBe(true)
    expect(status.hasCustomState.value).toBe(true)
    expect(status.statusTitle.value).toBe('忙碌')
    connection.value = 'connecting'
    expect(status.statusTitle.value).toBe('home.profile_card.status.connecting')
    expect(status.customStatusTitle.value).toBe('忙碌')
  })
})
