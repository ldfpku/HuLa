import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  sso: vi.fn(),
  user: { userInfo: { uid: 'user-a' } }
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))
vi.mock('@/utils/ImRequestUtils', () => ({ getMailSsoUrl: mocks.sso }))
vi.mock('@/stores/user', () => ({ useUserStore: () => mocks.user }))
vi.mock('@/components/windows/ActionBar.vue', () => ({ default: { template: '<header><slot /></header>' } }))

import { useWorkspaceStore } from '@/stores/workspace'
import EmbeddedMailWorkspace from './EmbeddedMailWorkspace.vue'

describe('embedded mail workspace', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.user = reactive({ userInfo: { uid: 'user-a' } })
    mocks.invoke.mockResolvedValue(undefined)
    mocks.listen.mockResolvedValue(vi.fn())
    mocks.sso.mockResolvedValue({ url: 'https://mail.example.test/sso' })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('test-overlay') ? new DOMRect(100, 50, 200, 200) : new DOMRect(64, 24, 700, 500)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('creates one child, hides it for chat and overlays, and disposes it', async () => {
    const workspace = useWorkspaceStore()
    workspace.openMail()
    const wrapper = mount(EmbeddedMailWorkspace, { props: { blocked: false }, attachTo: document.body })
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('set_embedded_mail_visible', { visible: true }))
    expect(mocks.invoke).toHaveBeenCalledWith('create_embedded_mail', {
      account: 'user-a',
      url: 'https://mail.example.test/sso',
      bounds: { x: 64, y: 24, width: 700, height: 500 }
    })

    workspace.openChat()
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('set_embedded_mail_visible', { visible: false }))
    workspace.openMail()
    await vi.waitFor(() =>
      expect(mocks.invoke.mock.calls.filter(([name]) => name === 'set_embedded_mail_visible')).toHaveLength(3)
    )
    expect(mocks.sso).toHaveBeenCalledOnce()

    const overlay = document.createElement('div')
    overlay.className = 'n-modal-container test-overlay'
    document.body.appendChild(overlay)
    await vi.waitFor(() =>
      expect(mocks.invoke.mock.calls.filter(([name]) => name === 'set_embedded_mail_visible')).toHaveLength(4)
    )
    expect(mocks.invoke).toHaveBeenLastCalledWith('set_embedded_mail_visible', { visible: false })
    overlay.remove()
    await vi.waitFor(() =>
      expect(mocks.invoke.mock.calls.filter(([name]) => name === 'set_embedded_mail_visible')).toHaveLength(5)
    )

    wrapper.unmount()
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('close_embedded_mail'))
  })

  it('retries a failed event-listener registration', async () => {
    mocks.listen.mockRejectedValueOnce(new Error('listener unavailable'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = mount(EmbeddedMailWorkspace, { props: { blocked: false }, attachTo: document.body })
    await vi.waitFor(() => expect(wrapper.text()).toContain('状态监听失败'))
    await wrapper.get('button').trigger('click')
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledTimes(3))
    expect(wrapper.text()).not.toContain('状态监听失败')
    expect(error).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('hides the native mail view while the sidebar menu is open and restores it afterwards', async () => {
    const workspace = useWorkspaceStore()
    workspace.openMail()
    const wrapper = mount(EmbeddedMailWorkspace, { props: { blocked: false }, attachTo: document.body })
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('set_embedded_mail_visible', { visible: true }))
    workspace.sidebarMenuOpen = true
    await vi.waitFor(() =>
      expect(mocks.invoke).toHaveBeenLastCalledWith('set_embedded_mail_visible', { visible: false })
    )
    workspace.sidebarMenuOpen = false
    await vi.waitFor(() =>
      expect(mocks.invoke).toHaveBeenLastCalledWith('set_embedded_mail_visible', { visible: true })
    )
    wrapper.unmount()
  })

  it('shows desktop download completion and failures', async () => {
    const workspace = useWorkspaceStore()
    workspace.openMail()
    const wrapper = mount(EmbeddedMailWorkspace, { props: { blocked: false }, attachTo: document.body })
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledTimes(2))
    const download = mocks.listen.mock.calls.find(([name]) => name === 'mail-workspace-download')?.[1]
    const error = mocks.listen.mock.calls.find(([name]) => name === 'mail-workspace-error')?.[1]
    download?.({ payload: '附件已下载至 Downloads\\guide.html' })
    await vi.waitFor(() => expect(wrapper.get('[role="status"]').text()).toContain('guide.html'))
    error?.({ payload: '邮件附件下载失败，请重试' })
    await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain('下载失败'))
    wrapper.unmount()
  })

  it('cleans up the error listener if registering the download listener fails', async () => {
    const stop = vi.fn()
    mocks.listen.mockResolvedValueOnce(stop).mockRejectedValueOnce(new Error('listener unavailable'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = mount(EmbeddedMailWorkspace, { props: { blocked: false }, attachTo: document.body })
    await vi.waitFor(() => expect(wrapper.text()).toContain('状态监听失败'))
    expect(stop).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalled()
    wrapper.unmount()
  })
})
