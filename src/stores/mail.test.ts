import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  getByLabel: vi.fn(),
  sso: vi.fn(),
  unread: vi.fn(),
  sendNotification: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  isDesktop: vi.fn(),
  isWeb: vi.fn(),
  isWindows: vi.fn(),
  user: { userInfo: { uid: 'user-1' } },
  features: { embeddedMailWorkspace: false },
  windows: [] as Array<{
    label: string
    options: Record<string, unknown>
    handlers: Record<string, (event: { payload?: unknown }) => unknown>
    show: ReturnType<typeof vi.fn>
  }>
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/api/window', () => ({ Window: { getByLabel: mocks.getByLabel } }))
vi.mock('@/common/backend', () => ({ APP_FEATURES: mocks.features }))
vi.mock('@tauri-apps/plugin-notification', () => ({ sendNotification: mocks.sendNotification }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: class {
    static getByLabel = mocks.getByLabel
    label: string
    options: Record<string, unknown>
    handlers: Record<string, (event: { payload?: unknown }) => unknown> = {}
    show = vi.fn().mockResolvedValue(undefined)
    constructor(label: string, options: Record<string, unknown>) {
      this.label = label
      this.options = options
      mocks.windows.push(this)
    }
    async once(name: string, handler: (event: { payload?: unknown }) => unknown) {
      this.handlers[name] = handler
    }
  }
}))
vi.mock('@/utils/ImRequestUtils', () => ({ getMailSsoUrl: mocks.sso, getMailUnread: mocks.unread }))
vi.mock('@/utils/PlatformConstants', () => ({
  isDesktop: mocks.isDesktop,
  isWeb: mocks.isWeb,
  isWindows: mocks.isWindows,
  PHONE_LAYOUT_QUERY: '(max-width: 899px)'
}))
vi.mock('@/stores/user', () => ({ useUserStore: () => mocks.user }))

import { useMailStore } from './mail'
import { useWorkspaceStore } from './workspace'

describe('desktop mail windows', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.windows = []
    mocks.getByLabel.mockResolvedValue(null)
    mocks.sso.mockResolvedValue({ url: `${window.location.origin}/api/im/mail/sso/${'a'.repeat(48)}` })
    mocks.invoke.mockResolvedValue(undefined)
    mocks.isDesktop.mockReturnValue(false)
    mocks.isWeb.mockReturnValue(true)
    mocks.isWindows.mockReturnValue(false)
    mocks.features.embeddedMailWorkspace = false
    mocks.user.userInfo.uid = 'user-1'
    Object.assign(window, { $message: { warning: mocks.warning, error: mocks.error } })
  })

  it('sets the mail icon before showing the window and marks the desktop destination', async () => {
    await useMailStore().openMail('/inbox?folder=sent')
    const mail = mocks.windows[0]
    expect(mocks.sso).toHaveBeenCalledWith('/inbox?folder=sent&smj_desktop=1')
    expect(mail.options.visible).toBe(false)
    expect(mail.options.dragDropEnabled).toBe(false)
    await mail.handlers['tauri://created']({})
    expect(mocks.invoke).toHaveBeenCalledWith('set_mail_window_identity', { label: 'mail' })
    expect(mocks.invoke.mock.invocationCallOrder[0]).toBeLessThan(mail.show.mock.invocationCallOrder[0])
  })

  it('opens the window with an explicit warning if the icon cannot be set', async () => {
    mocks.invoke.mockRejectedValue(new Error('icon error'))
    await useMailStore().openMail()
    const mail = mocks.windows[0]
    await mail.handlers['tauri://created']({})
    expect(mocks.warning).toHaveBeenCalled()
    expect(mail.show).toHaveBeenCalledOnce()
  })

  it('prevents a second open before creation finishes and allows retry after a native error', async () => {
    const store = useMailStore()
    await store.openMail()
    await store.openMail()
    expect(mocks.windows).toHaveLength(1)
    mocks.windows[0].handlers['tauri://error']({ payload: 'creation failed' })
    expect(mocks.error).toHaveBeenCalled()
    await store.openMail()
    expect(mocks.windows).toHaveLength(2)
  })

  it('marks and sets the icon for individual message windows too', async () => {
    await useMailStore().openMailMessage({ id: 'm1', path: '/message/m1', subject: 'Subject' })
    const mail = mocks.windows[0]
    expect(mocks.sso).toHaveBeenCalledWith('/message/m1?smj_desktop=1')
    expect(mail.options.dragDropEnabled).toBe(false)
    await mail.handlers['tauri://created']({})
    expect(mocks.invoke).toHaveBeenCalledWith('set_mail_window_identity', { label: 'mail-message-m1' })
  })

  it('lets the mail share page receive native file drops', async () => {
    await useMailStore().openMailShare({
      shareId: 'share-1',
      url: 'https://mail.example.test/api/im/mail/share/share-1',
      subject: '',
      from: '',
      fromName: '',
      date: 0,
      snippet: '',
      attachmentCount: 0
    })
    expect(mocks.windows[0].options.dragDropEnabled).toBe(false)
  })

  it.each(['inbox', 'message', 'share'] as const)('rejects an untrusted web SSO origin for %s', async (entry) => {
    mocks.sso.mockResolvedValue({ url: `https://attacker.example.test/api/im/mail/sso/${'a'.repeat(48)}` })
    const mail = useMailStore()
    const open = {
      inbox: () => mail.openMail(),
      message: () => mail.openMailMessage({ id: 'm1', path: '/inbox/m1', subject: '' }),
      share: () =>
        mail.openMailShare({
          shareId: 'share-1',
          url: 'https://mail.example.test/api/im/mail/share/share-1',
          subject: '',
          from: '',
          fromName: '',
          date: 0,
          snippet: '',
          attachmentCount: 0
        })
    }[entry]
    await expect(open()).rejects.toThrow('邮件登录地址无效')
    expect(mocks.windows).toHaveLength(0)
  })

  it('routes desktop inbox and message links to the main workspace without creating a window', async () => {
    const home = { unminimize: vi.fn(), show: vi.fn(), setFocus: vi.fn() }
    mocks.isDesktop.mockReturnValue(true)
    mocks.isWeb.mockReturnValue(false)
    mocks.features.embeddedMailWorkspace = true
    mocks.getByLabel.mockResolvedValue(home)
    const mail = useMailStore()
    await mail.openMail()
    expect(useWorkspaceStore().active).toBe('mail')
    await mail.openMailMessage({ id: 'm1', path: '/inbox/m1', subject: 'Subject' })
    expect(useWorkspaceStore().mailNavigation?.target).toBe('/inbox/m1?smj_desktop=1')
    expect(mocks.windows).toHaveLength(0)
    expect(mocks.sso).not.toHaveBeenCalled()
    expect(home.setFocus).toHaveBeenCalledTimes(2)
  })

  it('rejects a desktop share card whose path does not match its share ID', async () => {
    mocks.isDesktop.mockReturnValue(true)
    mocks.isWeb.mockReturnValue(false)
    mocks.features.embeddedMailWorkspace = true
    await expect(
      useMailStore().openMailShare({
        shareId: 'share-1',
        url: 'https://mail.example.test/inbox',
        subject: '',
        from: '',
        fromName: '',
        date: 0,
        snippet: '',
        attachmentCount: 0
      })
    ).rejects.toThrow('邮件分享地址无效')
    expect(mocks.getByLabel).not.toHaveBeenCalled()
  })

  it('keeps the existing desktop window available while the embedded workspace is disabled', async () => {
    mocks.isDesktop.mockReturnValue(true)
    mocks.isWeb.mockReturnValue(false)
    await useMailStore().openMail()
    expect(mocks.windows).toHaveLength(1)
    expect(useWorkspaceStore().active).toBe('chat')
  })

  it('only locks an embedded desktop view before logout when the feature is enabled', async () => {
    mocks.isDesktop.mockReturnValue(true)
    mocks.isWeb.mockReturnValue(false)
    expect(await useMailStore().prepareLogout()).toBe(false)
    expect(mocks.invoke).not.toHaveBeenCalled()
    mocks.features.embeddedMailWorkspace = true
    mocks.invoke.mockResolvedValue(true)
    expect(await useMailStore().prepareLogout()).toBe(true)
    await useMailStore().releaseLogout()
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'prepare_embedded_mail_logout')
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'release_embedded_mail_logout')
  })

  it('opens the notified message and rejects notifications from an old account', async () => {
    const home = { unminimize: vi.fn(), show: vi.fn(), setFocus: vi.fn() }
    mocks.isDesktop.mockReturnValue(true)
    mocks.isWeb.mockReturnValue(false)
    mocks.features.embeddedMailWorkspace = true
    mocks.getByLabel.mockResolvedValue(home)
    const mail = useMailStore()
    const event = { messageId: 'message 1', mailboxId: 'box', from: 'sender', fromName: null, subject: 'Subject' }
    await mail.openMailNotification(event, 'user-1')
    expect(useWorkspaceStore().mailNavigation?.target).toBe('/inbox/message%201?smj_desktop=1')
    mocks.user.userInfo.uid = 'user-2'
    await expect(mail.openMailNotification(event, 'user-1')).rejects.toThrow('账号已切换')
  })

  it('lets the web notification handler show mail alerts without duplicating them', async () => {
    const mail = useMailStore()
    const event = { messageId: 'm1', mailboxId: 'box', from: 'sender', fromName: null, subject: 'Subject' }
    await mail.handleMailNew(event)
    expect(mail.unreadCount).toBe(1)
    expect(mocks.sendNotification).not.toHaveBeenCalled()
    mocks.isWeb.mockReturnValue(false)
    await mail.handleMailNew(event)
    expect(mocks.sendNotification).toHaveBeenCalledOnce()
  })

  it('uses the clickable native notification on Windows', async () => {
    mocks.isDesktop.mockReturnValue(true)
    mocks.isWeb.mockReturnValue(false)
    mocks.isWindows.mockReturnValue(true)
    await useMailStore().handleMailNew({
      messageId: 'm1',
      mailboxId: 'box',
      from: 'sender',
      fromName: null,
      subject: 'Subject'
    })
    expect(mocks.invoke).toHaveBeenCalledWith('show_mail_notification', {
      messageId: 'm1',
      title: '新邮件：sender',
      body: 'Subject'
    })
    expect(mocks.sendNotification).not.toHaveBeenCalled()
  })
})
