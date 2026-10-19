import type { MessageType } from '@/services/types'

/**
 * 服务端会把自己发的消息也推给自己的其他设备。发出这条消息的设备还拿着用临时 ID 显示的那一份，
 * 等发送结果回来再换成正式 ID，所以推回来的这份（带着同一个 clientMsgId）不必再显示。
 */
export const isOwnPendingEcho = (
  data: MessageType,
  myUid: string | undefined,
  hasMessage: (roomId: string, msgId: string) => boolean | undefined
): boolean => {
  const clientMsgId = data.message?.clientMsgId
  if (!myUid || !clientMsgId || data.fromUser?.uid !== myUid || clientMsgId === data.message.id) return false
  return Boolean(hasMessage(data.message.roomId, clientMsgId))
}
