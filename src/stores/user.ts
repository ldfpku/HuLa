import { defineStore } from 'pinia'
import { StoresEnum } from '@/enums'
import type { UserInfoType } from '@/services/types'
import { getUserDetail, uploadAvatar } from '@/utils/ImRequestUtils'
import * as PathUtil from '@/utils/PathUtil'
import { useGlobalStore } from './global'
import { useGroupStore } from './group'
import { useLoginHistoriesStore } from './loginHistory'

export const useUserStore = defineStore(
  StoresEnum.USER,
  () => {
    const userInfo = ref<UserInfoType>()
    const globalStore = useGlobalStore()
    let updatingAvatar = false

    const getUserDetailAction = () => {
      getUserDetail()
        .then((res: any) => {
          userInfo.value = { ...userInfo.value, ...res }
        })
        .catch((e) => {
          console.error('获取用户详情失败:', e)
        })
    }

    const isMe = computed(() => (id: string) => {
      return userInfo.value?.uid === id
    })

    const updateAvatar = async (avatar: string) => {
      const uid = userInfo.value?.uid
      if (!uid) throw new Error('无法更新头像：用户未登录')
      if (!avatar.trim()) throw new Error('无法更新头像：头像地址为空')
      if (updatingAvatar) throw new Error('头像正在更新，请稍后重试')
      updatingAvatar = true
      try {
        const result = await uploadAvatar({ avatar })
        if (userInfo.value?.uid !== uid) throw new Error('账号已切换，无法更新当前用户头像')

        if (result === false) throw new Error('服务端拒绝更新头像')
        let savedAvatar = avatar
        if (result !== null && result !== undefined && result !== true) {
          if (typeof result !== 'object' || !('avatar' in result) || typeof result.avatar !== 'string' || !result.avatar.trim()) {
            throw new Error('服务端返回的头像地址无效')
          }
          savedAvatar = result.avatar
        }
        userInfo.value.avatar = savedAvatar
        userInfo.value.avatarUpdateTime = Date.now()
        const history = useLoginHistoriesStore().loginHistories.find((item) => item.uid === uid)
        if (history) history.avatar = savedAvatar
        const groupStore = useGroupStore()
        groupStore.updateCachedUserAvatar(uid, savedAvatar)
        return savedAvatar
      } finally {
        updatingAvatar = false
      }
    }

    const getUserRoomDir = async () => {
      return await PathUtil.getUserVideosDir(userInfo.value!.uid, globalStore.currentSessionRoomId)
    }

    const getUserRoomAbsoluteDir = async () => {
      return await PathUtil.getUserAbsoluteVideosDir(userInfo.value!.uid, globalStore.currentSessionRoomId)
    }

    return { userInfo, getUserDetailAction, updateAvatar, isMe, getUserRoomDir, getUserRoomAbsoluteDir }
  },
  {
    share: {
      enable: true,
      initialize: true
    }
  }
)
