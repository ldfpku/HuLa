import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { sendNotification } from '@tauri-apps/plugin-notification'
import { defineStore } from 'pinia'
import { StoresEnum } from '@/enums'
import type { MailCardBody, MailSearchHit } from '@/services/types'
import { getMailSsoUrl, getMailUnread } from '@/utils/ImRequestUtils'

/** 服务端推送的新邮件事件（mailNew） */
export type MailNewEvent = {
  messageId: string
  mailboxId: string
  from: string
  fromName: string | null
  subject: string
}

/** 邮件窗口的标识 */
const MAIL_WINDOW_LABEL = 'mail'

/**
 * 邮件：邮件功能由斯米伽邮箱网页提供，在独立窗口中通过一次性链接免登录打开；
 * 这里维护收件箱未读数，并在收到新邮件时弹出系统通知。
 */
export const useMailStore = defineStore(StoresEnum.MAIL, () => {
  const unreadCount = ref(0)
  let opening = false

  const refreshUnread = async () => {
    const res = await getMailUnread()
    if (res) unreadCount.value = Number(res.count) || 0
  }

  const handleMailNew = async (mail: MailNewEvent) => {
    unreadCount.value += 1
    sendNotification({
      title: `新邮件：${mail.fromName || mail.from}`,
      body: mail.subject || '(无主题)'
    })
  }

  /** 打开邮件窗口；已打开时直接聚焦 */
  const openMail = async (next?: string) => {
    const existing = await WebviewWindow.getByLabel(MAIL_WINDOW_LABEL)
    if (existing) {
      await existing.unminimize()
      await existing.show()
      await existing.setFocus()
      return
    }
    if (opening) return
    opening = true
    try {
      const { url } = await getMailSsoUrl(next)
      const webview = new WebviewWindow(MAIL_WINDOW_LABEL, {
        url,
        title: '斯米伽邮箱',
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 560,
        center: true,
        resizable: true,
        decorations: true,
        visible: true
      })
      await webview.once('tauri://destroyed', () => {
        refreshUnread()
      })
    } finally {
      opening = false
    }
  }

  /** 打开聊天里的邮件卡片：每封分享的邮件一个窗口，同样通过一次性链接免登录 */
  const openMailShare = async (card: MailCardBody) => {
    const path = new URL(card.url).pathname
    const label = `mail-share-${card.shareId}`
    const existing = await WebviewWindow.getByLabel(label)
    if (existing) {
      await existing.unminimize()
      await existing.show()
      await existing.setFocus()
      return
    }
    const { url } = await getMailSsoUrl(path)
    new WebviewWindow(label, {
      url,
      title: card.subject || '邮件',
      width: 900,
      height: 720,
      minWidth: 600,
      minHeight: 480,
      center: true,
      resizable: true,
      decorations: true,
      visible: true
    })
  }

  /** 打开搜索到的邮件：每封邮件一个窗口，打开邮件网页里这封邮件的页面 */
  const openMailMessage = async (mail: Pick<MailSearchHit, 'id' | 'path' | 'subject'>) => {
    const label = `mail-message-${mail.id.replace(/[^a-zA-Z0-9_-]/g, '')}`
    const existing = await WebviewWindow.getByLabel(label)
    if (existing) {
      await existing.unminimize()
      await existing.show()
      await existing.setFocus()
      return
    }
    const { url } = await getMailSsoUrl(mail.path)
    const webview = new WebviewWindow(label, {
      url,
      title: mail.subject || '邮件',
      width: 1100,
      height: 760,
      minWidth: 600,
      minHeight: 480,
      center: true,
      resizable: true,
      decorations: true,
      visible: true
    })
    // 在邮件网页里读过后，刷新未读数
    await webview.once('tauri://destroyed', () => {
      refreshUnread()
    })
  }

  return { unreadCount, refreshUnread, handleMailNew, openMail, openMailShare, openMailMessage }
})
