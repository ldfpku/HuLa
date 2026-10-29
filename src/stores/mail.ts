import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { invoke } from '@tauri-apps/api/core'
import { sendNotification } from '@tauri-apps/plugin-notification'
import { defineStore } from 'pinia'
import { APP_FEATURES } from '@/common/backend'
import { StoresEnum } from '@/enums'
import type { MailCardBody, MailSearchHit } from '@/services/types'
import { getMailSsoUrl, getMailUnread } from '@/utils/ImRequestUtils'
import { desktopMailTarget } from '@/utils/DesktopMail'
import { isDesktop, isWeb } from '@/utils/PlatformConstants'
import { useWorkspaceStore } from '@/stores/workspace'

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

async function prepareMailWindow(webview: WebviewWindow, refreshUnread?: () => Promise<void>, onFinished?: () => void) {
  const created = webview.once('tauri://created', async () => {
    try {
      await invoke('set_mail_window_identity', { label: webview.label })
    } catch (error) {
      console.error('设置邮件窗口图标失败:', error)
      window.$message.warning('邮件窗口图标设置失败')
    }
    try {
      await webview.show()
    } catch (error) {
      console.error('显示邮件窗口失败:', error)
      window.$message.error('打开邮件窗口失败，请重试')
    } finally {
      onFinished?.()
    }
  })
  const failed = webview.once('tauri://error', (event) => {
    console.error('创建邮件窗口失败:', event.payload)
    window.$message.error('打开邮件窗口失败，请重试')
    onFinished?.()
  })
  const registrations = [created, failed]
  if (refreshUnread) {
    registrations.push(
      webview.once('tauri://destroyed', () => {
        refreshUnread().catch((error) => console.error('刷新未读邮件数失败:', error))
      })
    )
  }
  await Promise.all(registrations)
}

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

  const openEmbeddedMail = async (path?: string) => {
    const home = await WebviewWindow.getByLabel('home')
    if (!home) throw new Error('主窗口不可用，无法打开邮件')
    await home.unminimize()
    await home.show()
    await home.setFocus()
    useWorkspaceStore().openMail(path)
  }

  /** 打开邮件窗口；已打开时直接聚焦 */
  const openMail = async (next?: string) => {
    if (APP_FEATURES.embeddedMailWorkspace && isDesktop() && !isWeb()) {
      await openEmbeddedMail(next)
      return
    }
    if (opening) return
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
      const { url } = await getMailSsoUrl(desktopMailTarget(next))
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
        visible: false
      })
      await prepareMailWindow(webview, refreshUnread, () => {
        opening = false
      })
    } catch (error) {
      opening = false
      throw error
    }
  }

  /** 打开聊天里的邮件卡片：每封分享的邮件一个窗口，同样通过一次性链接免登录 */
  const openMailShare = async (card: MailCardBody) => {
    const path = new URL(card.url).pathname
    if (APP_FEATURES.embeddedMailWorkspace && isDesktop() && !isWeb()) {
      if (path !== `/api/im/mail/share/${encodeURIComponent(card.shareId)}`) throw new Error('邮件分享地址无效')
      await openEmbeddedMail(path)
      return
    }
    const label = `mail-share-${card.shareId}`
    const existing = await WebviewWindow.getByLabel(label)
    if (existing) {
      await existing.unminimize()
      await existing.show()
      await existing.setFocus()
      return
    }
    const { url } = await getMailSsoUrl(desktopMailTarget(path))
    const webview = new WebviewWindow(label, {
      url,
      title: card.subject || '邮件',
      width: 900,
      height: 720,
      minWidth: 600,
      minHeight: 480,
      center: true,
      resizable: true,
      decorations: true,
      visible: false
    })
    await prepareMailWindow(webview)
  }

  /** 打开搜索到的邮件：每封邮件一个窗口，打开邮件网页里这封邮件的页面 */
  const openMailMessage = async (mail: Pick<MailSearchHit, 'id' | 'path' | 'subject'>) => {
    if (APP_FEATURES.embeddedMailWorkspace && isDesktop() && !isWeb()) {
      await openEmbeddedMail(mail.path)
      return
    }
    const label = `mail-message-${mail.id.replace(/[^a-zA-Z0-9_-]/g, '')}`
    const existing = await WebviewWindow.getByLabel(label)
    if (existing) {
      await existing.unminimize()
      await existing.show()
      await existing.setFocus()
      return
    }
    const { url } = await getMailSsoUrl(desktopMailTarget(mail.path))
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
      visible: false
    })
    // 在邮件网页里读过后，刷新未读数
    await prepareMailWindow(webview, refreshUnread)
  }

  return { unreadCount, refreshUnread, handleMailNew, openMail, openMailShare, openMailMessage }
})
