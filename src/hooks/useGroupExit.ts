import { useI18n } from 'vue-i18n'
import { useGroupStore } from '@/stores/group'
import { confirmGroupAction } from '@/utils/groupDialogs'

export const useGroupExit = () => {
  const { t } = useI18n()
  const groupStore = useGroupStore()

  const confirmExitGroup = (
    roomId: string,
    name: string,
    dissolve: boolean,
    onSuccess?: () => void | Promise<void>
  ) => {
    if (!roomId || roomId === '1') {
      window.$message.warning(
        t(dissolve ? 'home.chat_header.toast.dissolve_not_allowed' : 'home.chat_header.toast.exit_not_allowed')
      )
      return
    }
    const action = dissolve ? 'dissolve' : 'leave'
    confirmGroupAction({
      title: t(`message.group_action.${action}_title`, { name }),
      content: t(`message.group_action.${action}_content`),
      positiveText: t(dissolve ? 'menu.dissolve_group' : 'menu.leave_group'),
      negativeText: t('components.common.cancel'),
      pendingText: t(`message.group_action.${action}_pending`),
      errorMessage: t(`message.group_action.${action}_failed`),
      onConfirm: async () => {
        await groupStore.exitGroup(roomId, dissolve)
        window.$message.success(t(`message.group_action.${action}_success`))
        await onSuccess?.()
      }
    })
  }

  return { confirmExitGroup }
}
