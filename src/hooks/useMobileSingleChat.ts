import { AppException } from '@/common/exception'
import { useMessage } from '@/hooks/useMessage'
import router from '@/router'
import { useChatStore } from '@/stores/chat'
import { getSessionDetailWithFriends } from '@/utils/ImRequestUtils'
import { useI18n } from 'vue-i18n'

export const useMobileSingleChat = () => {
  const { t } = useI18n()
  const chatStore = useChatStore()
  const { preloadChatRoom } = useMessage()

  const openMobileSingleChat = async (uid: string) => {
    try {
      const session = await getSessionDetailWithFriends({ id: uid, roomType: 2 })
      if (!chatStore.getSession(session.roomId)) {
        chatStore.updateSessionLastActiveTime(session.roomId)
        await chatStore.getSessionList(true)
      }
      preloadChatRoom(session.roomId)
      await router.push('/mobile/chatRoom/chatMain')
    } catch (error) {
      console.error('打开单聊失败:', error)
      if (!(error instanceof AppException)) window.$message.error(t('message.directory_contact.open_failed'))
    }
  }

  return { openMobileSingleChat }
}
