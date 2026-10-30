import { h, ref } from 'vue'
import { NInput, NSelect } from 'naive-ui'
import type { UserItem } from '@/services/types'
import { useGroupStore } from '@/stores/group'
import { useUserStore } from '@/stores/user'
import { AppException } from '@/common/exception'

/** 群名称上限，与服务端一致 */
export const GROUP_NAME_MAX_LENGTH = 30

/**
 * 修改群名称弹窗：会话右键菜单、群头部、右侧群信息共用。
 * 权限在服务端校验（群主和管理员），无权限时接口返回的提示会直接显示。
 */
export const openRenameGroupDialog = (roomId: string, currentName: string) => {
  const name = ref(currentName)
  const groupStore = useGroupStore()
  window.$dialog.create({
    title: '修改群名称',
    showIcon: false,
    content: () =>
      h(NInput, {
        value: name.value,
        'onUpdate:value': (value: string) => {
          name.value = value
        },
        maxlength: GROUP_NAME_MAX_LENGTH,
        showCount: true,
        autofocus: true,
        placeholder: '请输入群名称',
        spellcheck: false
      }),
    positiveText: '保存',
    negativeText: '取消',
    onPositiveClick: async () => {
      const trimmed = name.value.trim()
      if (!trimmed) {
        window.$message.warning('群名称不能为空')
        return false
      }
      if (trimmed === currentName) return true
      try {
        await groupStore.renameGroup(roomId, trimmed)
        window.$message.success('群名称已修改')
        return true
      } catch (error) {
        console.error('修改群名称失败:', error)
        return false
      }
    }
  })
}

/** 二次确认后执行，危险操作（解散、转让）用 */
export const confirmGroupAction = (options: {
  title: string
  content: string
  positiveText: string
  negativeText?: string
  pendingText?: string
  errorMessage?: string
  onConfirm: () => Promise<void>
}) => {
  let pending = false
  const dialog = window.$dialog.warning({
    title: options.title,
    content: options.content,
    positiveText: options.positiveText,
    negativeText: options.negativeText ?? '取消',
    positiveButtonProps: { type: 'error' },
    onPositiveClick: async () => {
      if (pending) return false
      pending = true
      dialog.loading = true
      dialog.closable = false
      dialog.maskClosable = false
      dialog.closeOnEsc = false
      dialog.negativeButtonProps = { disabled: true }
      dialog.positiveText = options.pendingText ?? options.positiveText
      try {
        await options.onConfirm()
        return true
      } catch (error) {
        console.error(`${options.title}失败:`, error)
        if (!(error instanceof AppException)) {
          window.$message.error(options.errorMessage ?? `${options.title}失败，请重试`)
        }
        return false
      } finally {
        pending = false
        dialog.loading = false
        dialog.closable = true
        dialog.maskClosable = true
        dialog.closeOnEsc = true
        dialog.negativeButtonProps = { disabled: false }
        dialog.positiveText = options.positiveText
      }
    }
  })
}

/** 转让群主：从群成员里选一位，确认后自己变为普通成员 */
export const openTransferOwnerDialog = (roomId: string, members: UserItem[]) => {
  const groupStore = useGroupStore()
  const myUid = useUserStore().userInfo?.uid
  const options = members
    .filter((member) => member.uid !== myUid)
    .map((member) => ({ label: member.myName || member.name, value: member.uid }))
  if (!options.length) {
    window.$message.warning('群里没有其他成员可以接任群主')
    return
  }
  const selected = ref<string | null>(null)
  window.$dialog.create({
    title: '转让群主',
    showIcon: false,
    content: () =>
      h('div', { style: 'display: flex; flex-direction: column; gap: 10px' }, [
        h(
          'p',
          { style: 'font-size: 13px; color: var(--text-color)' },
          '转让后你将成为普通成员，新群主可管理群资料、成员和管理员。'
        ),
        h(NSelect, {
          value: selected.value,
          'onUpdate:value': (value: string) => {
            selected.value = value
          },
          options,
          filterable: true,
          placeholder: '选择新群主'
        })
      ]),
    positiveText: '转让',
    negativeText: '取消',
    onPositiveClick: async () => {
      if (!selected.value) {
        window.$message.warning('请选择新群主')
        return false
      }
      try {
        await groupStore.transferOwner(roomId, selected.value)
        window.$message.success('群主已转让')
        return true
      } catch (error) {
        console.error('转让群主失败:', error)
        return false
      }
    }
  })
}
