/** @全体成员 在 atUidList 里的写法；只有群主和管理员能发，服务端校验 */
export const AT_ALL_UID = '0'
export const AT_ALL_NAME = '全体成员'

/** 消息是否 @ 了这个人：点名或 @全体成员（自己发的 @全体成员 不算） */
export const isMentioned = (atUidList: string[] | null | undefined, uid: string | undefined, fromUid?: string) => {
  if (!uid || !Array.isArray(atUidList)) return false
  return atUidList.some((atUid) => String(atUid) === String(uid) || (atUid === AT_ALL_UID && fromUid !== uid))
}
