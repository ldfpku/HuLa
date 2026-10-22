import { ref } from 'vue'

/** 待定位的消息：搜索结果打开会话后，聊天窗口挂载并加载好这个会话时再滚动过去 */
export type MessageJumpTarget = {
  roomId: string
  msgId: string
}

const pendingMessageJump = ref<MessageJumpTarget | null>(null)

export const useMessageJump = () => {
  const requestMessageJump = (target: MessageJumpTarget) => {
    pendingMessageJump.value = { ...target }
  }

  /** 取出发给这个会话的待定位消息，取出后即清空 */
  const takeMessageJump = (roomId: string | null) => {
    const target = pendingMessageJump.value
    if (!target || target.roomId !== roomId) return null
    pendingMessageJump.value = null
    return target
  }

  return { pendingMessageJump, requestMessageJump, takeMessageJump }
}
