import type { MessageType } from '@/services/types'

/**
 * 聊天记录的显示顺序：先按发送时间，再按服务端消息 ID。
 * 还没发出去或发送失败的消息用的是临时 ID（如 `T1792634055628`），`Number()` 得到 NaN，
 * 单靠 ID 排序时它们的位置是未定义的，会跑到更早的消息前面。
 */
const numericId = (id: unknown) => {
  const value = Number(id)
  return Number.isFinite(value) ? value : null
}

export const compareMessages = (a: MessageType, b: MessageType): number => {
  const timeDiff = (a.message?.sendTime ?? 0) - (b.message?.sendTime ?? 0)
  if (timeDiff !== 0) return timeDiff
  const aId = numericId(a.message?.id)
  const bId = numericId(b.message?.id)
  if (aId !== null && bId !== null) return aId - bId
  // 正式 ID 的消息服务端已收到，排在同一时刻仍在发送的前面
  if (aId !== null) return -1
  if (bId !== null) return 1
  return String(a.message?.id ?? '').localeCompare(String(b.message?.id ?? ''))
}

/** 从旧到新 */
export const sortMessages = (messages: MessageType[]): MessageType[] => [...messages].sort(compareMessages)
