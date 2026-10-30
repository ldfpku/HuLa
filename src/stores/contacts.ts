import { defineStore } from 'pinia'
import { StoresEnum } from '@/enums'
import type { FriendItem, NoticeItem } from '@/services/types'
import { RequestNoticeAgreeStatus } from '@/services/types'
import { useGlobalStore } from '@/stores/global'
import { useFeedStore } from '@/stores/feed'
import { useGroupStore } from '@/stores/group'
import { useUserStore } from '@/stores/user'
import {
  deleteFriend,
  getFriendPage,
  getUserByIds,
  getNoticeUnreadCount,
  handleInvite,
  requestNoticePage
} from '@/utils/ImRequestUtils'
import { unreadCountManager } from '@/utils/UnreadCountManager'
// 定义分页大小常量
export const pageSize = 20
export const useContactStore = defineStore(StoresEnum.CONTACTS, () => {
  const globalStore = useGlobalStore()
  const feedStore = useFeedStore()
  const groupStore = useGroupStore()
  const userStore = useUserStore()

  /** 联系人列表 */
  const contactsList = ref<FriendItem[]>([])
  const contactsOwnerUid = ref<string>()
  const contactsLoaded = ref(false)
  const contactsLoadError = ref(false)
  /** 好友请求列表 */
  const requestFriendsList = ref<NoticeItem[]>([])

  /** 联系人列表分页选项 */
  const contactsOptions = ref({ isLast: false, isLoading: false, cursor: '' })
  /** 好友请求列表分页选项 */
  const applyPageOptions = ref({ isLast: false, cursor: '', pageNo: 1 })
  let contactsVersion = 0
  let refreshPromise: Promise<boolean> | undefined
  let refreshUid: string | undefined

  /**
   * 获取联系人列表
   * @param isFresh 是否刷新列表，true则重新加载，false则加载更多
   */
  const getContactList = (isFresh = false): Promise<boolean> => {
    const requestUid = userStore.userInfo?.uid
    if (!requestUid) return Promise.resolve(false)
    if (contactsOwnerUid.value !== requestUid) {
      contactsVersion++
      contactsOwnerUid.value = requestUid
      contactsList.value = []
      contactsLoaded.value = false
      contactsLoadError.value = false
      contactsOptions.value = { isLast: false, isLoading: false, cursor: '' }
    }
    if (isFresh && refreshPromise && refreshUid === requestUid) return refreshPromise
    if (!isFresh && (contactsOptions.value.isLast || contactsOptions.value.isLoading)) return Promise.resolve(false)

    const version = ++contactsVersion
    const cursor = isFresh ? '' : contactsOptions.value.cursor
    contactsOptions.value.isLoading = true
    const request = (async () => {
      try {
        const data = await getFriendPage({ cursor })
        if (version !== contactsVersion || userStore.userInfo?.uid !== requestUid) return false
        if (!data || !Array.isArray(data.list)) throw new Error('通讯录响应格式错误')
        if (isFresh) {
          contactsList.value = data.list
        } else {
          contactsList.value.push(...data.list)
        }
        contactsOptions.value.cursor = data.cursor
        contactsOptions.value.isLast = data.isLast
        contactsLoaded.value = true
        contactsLoadError.value = false
        return true
      } catch (error) {
        console.error('获取联系人列表失败:', error)
        if (version === contactsVersion && userStore.userInfo?.uid === requestUid) contactsLoadError.value = true
        return false
      } finally {
        if (version === contactsVersion) contactsOptions.value.isLoading = false
      }
    })()
    if (isFresh) {
      refreshUid = requestUid
      refreshPromise = request
      void request.then(() => {
        if (refreshPromise === request) {
          refreshPromise = undefined
          refreshUid = undefined
        }
      })
    }
    return request
  }

  const refreshDirectoryContact = async (uid: string): Promise<'found' | 'missing' | 'failed'> => {
    if (!uid) {
      console.error('刷新通讯录失败：缺少用户 ID')
      return 'failed'
    }
    if (!(await getContactList(true))) return 'failed'
    return contactsList.value.some((contact) => contact.uid === uid) ? 'found' : 'missing'
  }

  const refreshPresence = async () => {
    const account = userStore.userInfo?.uid
    const ids = contactsList.value.map((contact) => contact.uid)
    if (!account || !ids.length) return
    const users = []
    for (let offset = 0; offset < ids.length; offset += 100) {
      users.push(...(await getUserByIds(ids.slice(offset, offset + 100))))
    }
    if (account !== userStore.userInfo?.uid) return
    applyPresence(users)
  }

  const applyPresence = (users: Pick<FriendItem, 'uid' | 'activeStatus' | 'lastOptTime'>[]) => {
    const byId = new Map(users.map((user) => [user.uid, user]))
    for (const contact of contactsList.value) {
      const user = byId.get(contact.uid)
      if (
        user &&
        Number.isFinite(user.lastOptTime) &&
        (!Number.isFinite(contact.lastOptTime) || user.lastOptTime >= contact.lastOptTime)
      ) {
        contact.activeStatus = user.activeStatus
        contact.lastOptTime = user.lastOptTime
      }
    }
    groupStore.applyPresence(users)
  }

  /**
   * 获取好友申请未读数
   * 更新全局store中的未读计数
   */
  const getApplyUnReadCount = async () => {
    const requestUid = userStore.userInfo?.uid
    if (!requestUid) return

    const res: any = await getNoticeUnreadCount()
    if (!res || userStore.userInfo?.uid !== requestUid) return

    // 仅允许当前账号的响应更新未读计数，避免切换账号时旧请求覆盖新状态
    globalStore.unReadMark.newFriendUnreadCount = res.unReadCount4Friend
    globalStore.unReadMark.newGroupUnreadCount = res.unReadCount4Group

    unreadCountManager.refreshBadge(globalStore.unReadMark, feedStore.unreadCount)
  }

  /**
   * 获取好友申请列表
   * @param isFresh 是否刷新列表，true则重新加载，false则加载更多
   * @param click 是否点击刷新，true则点击清空通知未读，false则仅仅请求通知列表
   */
  const getApplyPage = async (applyType: string, isFresh = false, click = false) => {
    // 非刷新模式下，如果已经加载完或正在加载中，则直接返回
    if (!isFresh) {
      if (applyPageOptions.value.isLast) return
    }

    // 刷新时重置页码
    if (isFresh) {
      applyPageOptions.value.pageNo = 1
      applyPageOptions.value.cursor = ''
    }

    try {
      const res = await requestNoticePage({
        pageNo: applyPageOptions.value.pageNo,
        pageSize: 30,
        click: click,
        applyType,
        cursor: isFresh ? '' : applyPageOptions.value.cursor
      })
      if (!res) return
      // 刷新模式下替换整个列表，否则追加到列表末尾
      if (isFresh) {
        requestFriendsList.value.splice(0, requestFriendsList.value.length, ...res.list)
      } else {
        requestFriendsList.value.push(...res.list)
      }

      // 更新分页信息
      applyPageOptions.value.cursor = res.cursor
      applyPageOptions.value.isLast = res.isLast

      // 如果有返回pageNo，则使用服务器返回的pageNo，否则自增页码
      if (res.pageNo) {
        applyPageOptions.value.pageNo = res.pageNo + 1
      } else {
        applyPageOptions.value.pageNo++
      }
    } catch (error) {
      console.error('获取好友申请列表失败:', error)
    }
  }

  const deleteContact = (uid: string) => {
    contactsList.value = contactsList.value.filter((item) => item.uid !== uid)
  }

  /**
   * 处理好友/群申请
   * @param apply 好友申请信息
   * @param state 处理状态 0拒绝 2同意 3忽略
   */
  const resolveApplyType = (applyType?: 'friend' | 'group', type?: number): 'friend' | 'group' => {
    if (applyType === 'friend' || applyType === 'group') return applyType
    // 后端 type: 1 群聊通知, 2 好友通知
    return type === 2 ? 'friend' : 'group'
  }

  const onHandleInvite = async (apply: {
    applyId: string
    state: number
    roomId?: string
    type?: number
    applyType?: 'friend' | 'group'
    markAsRead?: boolean
  }) => {
    const targetApplyType = resolveApplyType(apply.applyType, apply.type)
    const markAsRead = apply.markAsRead ?? false

    try {
      await handleInvite({ applyId: apply.applyId, state: apply.state })

      // 刷新好友申请列表
      await getApplyPage(targetApplyType, true, markAsRead)
      if (markAsRead) {
        targetApplyType === 'friend'
          ? (globalStore.unReadMark.newFriendUnreadCount = 0)
          : (globalStore.unReadMark.newGroupUnreadCount = 0)
        unreadCountManager.refreshBadge(globalStore.unReadMark, feedStore.unreadCount)
      }
      // 刷新好友列表
      await getContactList(true)
      // 获取最新的未读数
      await getApplyUnReadCount()

      // 如果是同意群邀请/群申请，则刷新群信息与成员列表
      const isGroupApply =
        apply.state === RequestNoticeAgreeStatus.ACCEPTED &&
        targetApplyType === 'group' &&
        apply.roomId &&
        Number(apply.roomId) > 0

      if (isGroupApply) {
        try {
          await groupStore.addGroupDetail(apply.roomId!)
          await groupStore.getGroupUserList(apply.roomId!, true)
        } catch (error) {
          console.error('刷新群成员信息失败:', error)
        }
      }

      // 更新当前选中联系人的状态
      if (globalStore.currentSelectedContact) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        globalStore.currentSelectedContact.status = RequestNoticeAgreeStatus.ACCEPTED
      }
    } catch (error) {
      console.error('处理好友/群申请失败:', error)
      throw error
    }
  }

  /**
   * 删除好友
   * @param uid 要删除的好友用户ID
   * 处理流程：
   * 1. 调用删除好友接口
   * 2. 刷新好友列表
   */
  const onDeleteFriend = async (uid: string) => {
    if (!uid) return
    // 删除好友
    await deleteFriend({ targetUid: uid })
    // 刷新好友列表
    await getContactList(true)
  }

  /** 清理账号相关的联系人和申请状态，避免切换账号时复用旧数据 */
  const resetAccountState = () => {
    contactsVersion++
    refreshPromise = undefined
    refreshUid = undefined
    contactsList.value = []
    contactsOwnerUid.value = undefined
    contactsLoaded.value = false
    contactsLoadError.value = false
    requestFriendsList.value = []
    contactsOptions.value = { isLast: false, isLoading: false, cursor: '' }
    applyPageOptions.value = { isLast: false, cursor: '', pageNo: 1 }
  }

  return {
    getContactList,
    refreshDirectoryContact,
    refreshPresence,
    applyPresence,
    getApplyPage,
    getApplyUnReadCount,
    contactsList,
    contactsOwnerUid,
    contactsLoaded,
    contactsLoadError,
    requestFriendsList,
    contactsOptions,
    applyPageOptions,
    onDeleteFriend,
    onHandleInvite,
    deleteContact,
    resetAccountState
  }
})
