import type { ChatPurgeChanges } from '@/services/types'

/** 管理员清理聊天数据后，本机要做的事：整段删掉的会话、单独删掉的消息、处理完要记下的进度 */
export type ChatPurgeSteps = {
  rooms: string[]
  messages: { roomId: string; msgId: string }[]
  epoch: number
}

/** 读本机记下的进度；没有或不是数字时从头开始 */
export const parseChatPurgeEpoch = (raw: string | null): number => {
  const value = Number(raw ?? 0)
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** 服务端没有比本机更新的清理时返回 null */
export const chatPurgeSteps = (changes: ChatPurgeChanges | null | undefined, since: number): ChatPurgeSteps | null => {
  if (!changes || !(changes.epoch > since)) return null
  const rooms = changes.rooms.filter((room) => room.all).map((room) => room.roomId)
  const whole = new Set(rooms)
  const messages = changes.rooms
    .filter((room) => !room.all && !whole.has(room.roomId))
    .flatMap((room) => room.msgIds.map((msgId) => ({ roomId: room.roomId, msgId })))
  return { rooms, messages, epoch: changes.epoch }
}
