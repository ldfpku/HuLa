import type { WsTokenExpire } from '@/services/wsType'

export function isExpiredSession(
  uid: string | null | undefined,
  client: string | undefined,
  event: Pick<WsTokenExpire, 'uid' | 'client'>
): boolean {
  return Boolean(uid) && uid === event.uid && client === event.client
}
