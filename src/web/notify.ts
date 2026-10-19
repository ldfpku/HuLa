/**
 * 网页版的消息通知与未读角标（只在主窗口 home 里启用）：
 * - 新消息、新邮件在页面不在前台时用浏览器通知提醒，点击通知回到对应会话或打开邮件
 * - 标签页标题和 favicon 上显示聊天未读数
 *
 * 业务代码里的 sendNotification（被 @ 时、收到新邮件时）原本由替身直接弹出，不管页面是否在前台，
 * 点击也没有反应；这里接管 plugin:notification|notify，统一由本文件弹出。
 * 不用 Web Push：浏览器的推送服务由浏览器厂商提供（如 Chrome 走 Google），属于外部服务。
 */
import { emit } from '@tauri-apps/api/event'
import { watch } from 'vue'
import { MsgEnum, NotificationTypeEnum, RoomTypeEnum } from '@/enums'
import { useMitt } from '@/hooks/useMitt'
import router from '@/router'
import type { MessageType } from '@/services/types'
import { WsResponseMessageType } from '@/services/wsType'
import { useChatStore } from '@/stores/chat'
import { useGlobalStore } from '@/stores/global'
import { useGroupStore } from '@/stores/group'
import { type MailNewEvent, useMailStore } from '@/stores/mail'
import { useUserStore } from '@/stores/user'
import { AvatarUtils } from '@/utils/AvatarUtils'
import { renderReplyContent } from '@/utils/RenderReplyContent'
import { badgeText, baseTitle, isPageActive, titleWithUnread, withBasePath } from './notifyUtils'

const BASE = import.meta.env.BASE_URL
const LOGO = withBasePath(BASE, '/logo.png')

const supported = () => 'Notification' in window

/** 首次进入时申请通知权限。浏览器要求在用户操作中申请，所以放在第一次点击或按键时 */
const requestPermissionOnce = () => {
  if (!supported() || Notification.permission !== 'default') return
  const ask = () => {
    window.removeEventListener('pointerdown', ask, true)
    window.removeEventListener('keydown', ask, true)
    if (Notification.permission === 'default') void Notification.requestPermission()
  }
  window.addEventListener('pointerdown', ask, true)
  window.addEventListener('keydown', ask, true)
}

type WebNotice = {
  title: string
  body?: string
  icon?: string
  /** 同一个 tag 的通知会替换上一条，避免同一会话刷屏 */
  tag: string
  onClick?: () => void
}

/** 页面不在前台时才弹出通知 */
const show = (notice: WebNotice) => {
  if (!supported() || Notification.permission !== 'granted' || isPageActive(document)) return
  try {
    const n = new Notification(notice.title, {
      body: notice.body,
      icon: notice.icon || LOGO,
      tag: notice.tag
    })
    n.onclick = () => {
      window.focus()
      n.close()
      notice.onClick?.()
    }
  } catch (error) {
    console.warn('[web] 弹出通知失败', error)
  }
}

const iconUrl = (avatar?: string) => withBasePath(BASE, AvatarUtils.getAvatarUrl(avatar || ''))

/** 切到消息页并打开会话：消息页挂载后才会监听 search_to_msg，所以必要时先跳转再发 */
const openSession = async (roomId: string) => {
  const session = useChatStore().getSession(roomId)
  if (!session) return
  const payload = {
    uid: session.type === RoomTypeEnum.SINGLE ? session.detailId : session.roomId,
    roomType: session.type
  }
  if (router.currentRoute.value.path !== '/message') {
    await router.push('/message')
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  await emit('search_to_msg', payload)
}

const onMessage = (data: MessageType) => {
  const userStore = useUserStore()
  const myUid = userStore.userInfo?.uid
  if (!myUid || data.fromUser?.uid === myUid) return
  if (data.message.type === MsgEnum.RECALL) return

  const roomId = data.message.roomId
  const globalStore = useGlobalStore()
  // 正在看这个会话就不提醒（页面在后台时仍然提醒）
  if (
    isPageActive(document) &&
    router.currentRoute.value.path === '/message' &&
    globalStore.currentSessionRoomId === roomId
  )
    return

  const session = useChatStore().getSession(roomId)
  const atMe = Boolean(data.message.body?.atUidList?.includes(myUid))
  // 免打扰的会话只在被 @ 时提醒
  if (session?.muteNotification === NotificationTypeEnum.NOT_DISTURB && !atMe) return

  const sender = useGroupStore().getUserInfo(data.fromUser.uid, roomId)
  const senderName = sender?.name || data.fromUser.username || ''
  const roomType = session?.type ?? RoomTypeEnum.SINGLE
  const preview =
    renderReplyContent(senderName, data.message.type, data.message.body?.content ?? data.message.body, roomType) ||
    '[新消息]'

  show({
    title: (atMe ? '[有人@我] ' : '') + (session?.name || senderName || '新消息'),
    body: String(preview),
    icon: iconUrl(session?.avatar || sender?.avatar || data.fromUser.avatar),
    tag: `smj-room-${roomId}`,
    onClick: () => void openSession(roomId)
  })
}

const onMail = (mail: MailNewEvent) => {
  show({
    title: `新邮件：${mail.fromName || mail.from}`,
    body: mail.subject || '(无主题)',
    tag: `smj-mail-${mail.messageId}`,
    onClick: () => void useMailStore().openMail()
  })
}

/** 业务代码的 sendNotification 改由上面的 onMessage / onMail 弹出，这里不再重复弹 */
const takeOverPluginNotify = () => {
  const internals = (window as any).__TAURI_INTERNALS__
  const invoke = internals.invoke
  internals.invoke = (cmd: string, args: any, options?: any) =>
    cmd === 'plugin:notification|notify' ? Promise.resolve(null) : invoke(cmd, args, options)
}

/** 在 favicon 右上角画未读数 */
const createFaviconBadge = () => {
  const link =
    document.querySelector<HTMLLinkElement>('link[rel~="icon"]') ??
    Object.assign(document.createElement('link'), { rel: 'icon' })
  if (!link.parentNode) document.head.appendChild(link)
  const original = link.href || LOGO
  let image: HTMLImageElement | null = null
  let pending = ''

  const draw = (text: string) => {
    if (!text) {
      link.href = original
      return
    }
    if (!image?.complete) {
      pending = text
      return
    }
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (image.naturalWidth) ctx.drawImage(image, 0, 0, size, size)
    const radius = text.length > 2 ? 22 : 18
    const cx = size - radius
    const cy = radius
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    // 图标底是斯米伽蓝，角标用白底蓝字才看得清；信号橙只属于标志上钩，不做角标
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.lineWidth = 3
    ctx.strokeStyle = '#0a1f54'
    ctx.stroke()
    ctx.fillStyle = '#034fbc'
    ctx.font = `bold ${text.length > 2 ? 20 : 26}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, cx, cy + 1)
    try {
      link.href = canvas.toDataURL('image/png')
    } catch {
      link.href = original
    }
  }

  image = new Image()
  image.onload = image.onerror = () => {
    if (pending) draw(pending)
  }
  image.src = original
  return draw
}

/** 标题前加 “(n) ”；应用改标题时重新加上 */
const createTitleBadge = () => {
  let count = 0
  const apply = () => {
    const next = titleWithUnread(document.title, count)
    if (document.title !== next) document.title = next
  }
  const titleEl = document.querySelector('title') ?? document.head.appendChild(document.createElement('title'))
  new MutationObserver(apply).observe(titleEl, { childList: true, characterData: true, subtree: true })
  return (n: number) => {
    count = n
    if (!badgeText(n)) document.title = baseTitle(document.title)
    apply()
  }
}

export const startWebNotify = (label: string) => {
  if (label !== 'home') return
  takeOverPluginNotify()
  requestPermissionOnce()

  useMitt.on(WsResponseMessageType.RECEIVE_MESSAGE, onMessage)
  useMitt.on(WsResponseMessageType.MAIL_NEW, onMail)

  const setTitle = createTitleBadge()
  const setFavicon = createFaviconBadge()
  const globalStore = useGlobalStore()
  watch(
    () => globalStore.unReadMark.newMsgUnreadCount,
    (count) => {
      setTitle(count)
      setFavicon(badgeText(count))
    },
    { immediate: true }
  )
}
