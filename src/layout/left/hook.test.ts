import { mount } from '@vue/test-utils'
import { defineComponent, h, reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  modify: vi.fn(),
  history: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  user: { userInfo: { uid: 'one', name: 'Old', modifyNameChance: 0 } },
  members: {
    first: [{ uid: 'one', name: 'Old' }],
    second: [{ uid: 'one', name: 'Old' }]
  }
}))

vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn() }))
vi.mock('@vueuse/core', () => ({ useTimeoutFn: vi.fn() }))
vi.mock('pinia', async () => {
  const { toRefs } = await import('vue')
  return { storeToRefs: toRefs }
})
vi.mock('@/services/i18n', () => ({ useI18nGlobal: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/useMitt.ts', () => ({ useMitt: { on: vi.fn(), emit: vi.fn() } }))
vi.mock('@/hooks/useWindow.ts', () => ({ useWindow: () => ({ createWebviewWindow: vi.fn() }) }))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))
vi.mock('@/stores/group', () => ({
  useGroupStore: () => ({
    updateCachedUserName: (uid: string, name: string) => {
      for (const members of Object.values(mocks.members)) {
        for (const member of members) if (member.uid === uid) member.name = name
      }
    }
  })
}))
vi.mock('@/stores/loginHistory.ts', () => ({ useLoginHistoriesStore: () => ({ updateLoginHistory: mocks.history }) }))
vi.mock('@/stores/mail', () => ({ useMailStore: () => ({}) }))
vi.mock('@/stores/todo', () => ({ useTodoStore: () => ({}) }))
vi.mock('@/stores/menuTop.ts', () => ({ useMenuTopStore: () => reactive({ menuTop: [{ url: 'message' }] }) }))
vi.mock('@/stores/setting.ts', () => ({ useSettingStore: () => ({ themes: { content: 'light', pattern: 'light' } }) }))
vi.mock('@/stores/user.ts', () => ({ useUserStore: () => mocks.user }))
vi.mock('@/stores/userStatus.ts', () => ({ useUserStatusStore: () => reactive({ currentState: {} }) }))
vi.mock('@/utils/ImRequestUtils', () => ({ ModifyUserInfo: mocks.modify, setUserBadge: vi.fn() }))

import { leftHook } from './hook'

describe('chat profile name', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user.userInfo = { uid: 'one', name: 'Old', modifyNameChance: 0 }
    mocks.members.first[0].name = 'Old'
    mocks.members.second[0].name = 'Old'
    mocks.modify.mockResolvedValue(true)
    Object.assign(window, { $message: { success: mocks.success, error: mocks.error, warning: mocks.warning } })
  })

  function createHook() {
    let result!: ReturnType<typeof leftHook>
    const wrapper = mount(
      defineComponent({
        setup() {
          result = leftHook()
          return () => h('div')
        }
      })
    )
    return { result, wrapper }
  }

  it('lets the server decide the limit and updates all local caches after success', async () => {
    const { result, wrapper } = createHook()
    result.editInfo.value.content = mocks.user.userInfo
    await result.saveEditInfo({ name: 'New', modifyNameChance: 0 })
    expect(mocks.modify).toHaveBeenCalledWith({ name: 'New' }, false)
    expect(mocks.user.userInfo.name).toBe('New')
    expect(mocks.members.first[0].name).toBe('New')
    expect(mocks.members.second[0].name).toBe('New')
    expect(mocks.history).toHaveBeenCalledOnce()
    expect(mocks.success).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('reports server rejection without updating the cached name', async () => {
    mocks.modify.mockRejectedValue(new Error('Server rejected the name'))
    const { result, wrapper } = createHook()
    await result.saveEditInfo({ name: 'New' })
    expect(mocks.user.userInfo.name).toBe('Old')
    expect(mocks.error).toHaveBeenCalledWith('Server rejected the name')
    wrapper.unmount()
  })

  it('does not apply an old account response to the new account', async () => {
    let resolve!: (value: boolean) => void
    mocks.modify.mockReturnValue(new Promise((done) => (resolve = done)))
    const { result, wrapper } = createHook()
    const pending = result.saveEditInfo({ name: 'New' })
    mocks.user.userInfo = { uid: 'two', name: 'Other', modifyNameChance: 0 }
    resolve(true)
    await pending
    expect(mocks.user.userInfo.name).toBe('Other')
    expect(mocks.warning).toHaveBeenCalled()
    wrapper.unmount()
  })
})
