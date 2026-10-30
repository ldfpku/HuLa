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
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledTimes(2))
    expect(wrapper.text()).not.toContain('状态监听失败')
    expect(error).toHaveBeenCalled()
    wrapper.unmount()
  })
})
