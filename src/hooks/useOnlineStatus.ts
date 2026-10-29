import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { OnlineEnum } from '@/enums'
import { useGroupStore } from '@/stores/group'
import { useUserStore } from '@/stores/user'
import { useUserStatusStore } from '@/stores/userStatus'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { userStateIcon } from '@/utils/UserStateIcon'

export const useOnlineStatus = (uid?: ComputedRef<string | undefined> | Ref<string | undefined>) => {
  const { t } = useI18n()
  const userStore = useUserStore()
  const groupStore = useGroupStore()
  const userStatusStore = useUserStatusStore()
  const { wsStatus } = useNetworkStatus()
  const { currentState } = storeToRefs(userStatusStore)
  const isSelf = computed(() => !uid || (!!uid.value && uid.value === userStore.userInfo?.uid))

  const currentUser = computed(() => {
    const targetUid = uid ? uid.value : userStore.userInfo?.uid
    return targetUid ? groupStore.getUserInfo(targetUid) : undefined
  })

  const userStateId = computed(() => (isSelf.value ? userStore.userInfo?.userStateId : currentUser.value?.userStateId))

  const activeStatus = computed(() =>
    isSelf.value
      ? userStore.userInfo?.uid && wsStatus.value === 'connected'
        ? OnlineEnum.ONLINE
        : OnlineEnum.OFFLINE
      : (currentUser.value?.activeStatus ?? OnlineEnum.OFFLINE)
  )
  const isOnline = computed(() => activeStatus.value === OnlineEnum.ONLINE)
  const isConnectionPending = computed(
    () => isSelf.value && (wsStatus.value === 'connecting' || wsStatus.value === 'unknown')
  )
  const connectionKnown = computed(() => (isSelf.value ? wsStatus.value !== 'unknown' : !!currentUser.value))
  const connectionTitle = computed(() => {
    if (isSelf.value) {
      if (!userStore.userInfo?.uid || wsStatus.value === 'unknown') return t('home.profile_card.status.unknown')
      if (wsStatus.value === 'connecting') return t('home.profile_card.status.connecting')
      if (wsStatus.value === 'disconnected' || wsStatus.value === 'error') {
        return t('home.profile_card.status.disconnected')
      }
    } else if (!currentUser.value) {
      return t('home.profile_card.status.unknown')
    }
    return isOnline.value ? t('home.profile_card.status.online') : t('home.profile_card.status.offline')
  })

  const hasCustomState = computed(() => {
    const stateId = userStateId.value
    return (isSelf.value || isOnline.value) && !!stateId && stateId !== '0' && stateId !== '1'
  })

  const userStatus = computed(() => {
    if (!userStateId.value) return null
    return userStatusStore.stateList.find((state: { id: string }) => state.id === userStateId.value)
  })

  const customStatusTitle = computed(() => {
    if (!hasCustomState.value || !userStatus.value?.title) return ''
    const key = `auth.onlineStatus.states.${userStatus.value.title}`
    const translated = t(key)
    return translated === key ? userStatus.value.title : translated
  })

  const statusIcon = computed(() => {
    if (hasCustomState.value && userStatus.value) {
      return userStateIcon(userStatus.value)
    }
    return isOnline.value ? '/status/online.png' : '/status/offline.png'
  })

  const statusTitle = computed(() => {
    if (isSelf.value && wsStatus.value !== 'connected') return connectionTitle.value
    return customStatusTitle.value || connectionTitle.value
  })

  const statusBgColor = computed(() => {
    if (hasCustomState.value && userStatus.value?.bgColor) {
      return userStatus.value.bgColor
    }
    return isOnline.value ? 'rgba(19, 152, 127, 0.4)' : 'rgba(144, 144, 144, 0.4)'
  })

  return {
    currentState,
    activeStatus,
    statusIcon,
    statusTitle,
    statusBgColor,
    isOnline,
    isConnectionPending,
    connectionKnown,
    connectionTitle,
    customStatusTitle,
    hasCustomState,
    userStatus
  }
}
