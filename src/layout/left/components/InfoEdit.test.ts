import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ updateAvatar: vi.fn(), success: vi.fn(), error: vi.fn() }))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getCurrent: () => ({ listen: vi.fn().mockResolvedValue(() => {}) }) }
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('naive-ui', async () => {
  const { defineComponent, h } = await import('vue')
  const component = defineComponent({
    setup(_, { slots }) {
      return () => h('div', [slots.trigger?.(), slots.default?.()])
    }
  })
  return {
    NModal: component,
    NFlex: component,
    NPopover: component,
    NAvatar: component,
    NInput: component,
    NImage: component,
    NButton: component
  }
})
vi.mock('@/components/common/AvatarCropper.vue', async () => {
  const { defineComponent } = await import('vue')
  return { default: defineComponent({ name: 'AvatarCropper', template: '<div />' }) }
})
vi.mock('@/components/common/AvatarPicker.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      props: { show: Boolean },
      emits: ['select', 'upload', 'update:show'],
      setup(props, { emit }) {
        return () =>
          props.show
            ? h('div', [
                h('button', { class: 'pick-avatar', onClick: () => emit('select', '022') }),
                h('button', { class: 'upload-avatar', onClick: () => emit('upload') })
              ])
            : null
      }
    })
  }
})
vi.mock('@/hooks/useUpload', () => ({
  UploadProviderEnum: { QINIU: 'qiniu' },
  useUpload: vi.fn()
}))
vi.mock('@/hooks/useCommon.ts', () => ({ useCommon: () => ({ countGraphemes: vi.fn() }) }))
vi.mock('@/hooks/useMitt.ts', () => ({ useMitt: { on: vi.fn(), emit: vi.fn() } }))
vi.mock('@/hooks/useTauriListener', () => ({ useTauriListener: () => ({ addListener: vi.fn() }) }))
vi.mock('@/layout/left/hook.ts', async () => {
  const { ref } = await import('vue')
  return {
    leftHook: () => ({
      editInfo: ref({ show: true, content: { name: 'User', avatar: '', modifyNameChance: 1 }, badgeList: [] }),
      currentBadge: ref(null),
      updateCurrentUserCache: vi.fn(),
      saveEditInfo: vi.fn(),
      toggleWarningBadge: vi.fn()
    })
  }
})
vi.mock('@/stores/user.ts', () => ({
  useUserStore: () => ({ userInfo: { uid: 'user', name: 'User', avatar: '' }, updateAvatar: mocks.updateAvatar })
}))
vi.mock('@/stores/loginHistory', () => ({ useLoginHistoriesStore: () => ({ loginHistories: [] }) }))
vi.mock('@/utils/ImRequestUtils', () => ({ getBadgeList: vi.fn(), uploadAvatar: vi.fn() }))
vi.mock('@/utils/AvatarUtils', () => ({ AvatarUtils: { getAvatarUrl: (url: string) => url } }))
vi.mock('@/utils/PlatformConstants', () => ({ isMac: () => false, isWindows: () => true }))

import InfoEdit from './InfoEdit.vue'

describe('profile avatar editor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updateAvatar.mockResolvedValue(undefined)
    Object.assign(window, { $message: { success: mocks.success, error: mocks.error } })
  })

  it('opens the actual file input from the avatar picker', async () => {
    const wrapper = mount(InfoEdit)
    const input = wrapper.get('input[type=file]').element as HTMLInputElement
    const click = vi.spyOn(input, 'click').mockImplementation(() => {})
    await wrapper.get('.avatar-wrapper').trigger('click')
    await wrapper.get('.upload-avatar').trigger('click')
    expect(click).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('saves a selected built-in avatar', async () => {
    const wrapper = mount(InfoEdit)
    await wrapper.get('.avatar-wrapper').trigger('click')
    await wrapper.get('.pick-avatar').trigger('click')
    await flushPromises()
    expect(mocks.updateAvatar).toHaveBeenCalledWith('022')
    expect(mocks.success).toHaveBeenCalled()
    expect(wrapper.find('.pick-avatar').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps the picker open when saving fails', async () => {
    mocks.updateAvatar.mockRejectedValue(new Error('save failed'))
    const wrapper = mount(InfoEdit)
    await wrapper.get('.avatar-wrapper').trigger('click')
    await wrapper.get('.pick-avatar').trigger('click')
    await flushPromises()
    expect(mocks.error).toHaveBeenCalledWith('components.avatarPicker.save_failed')
    expect(wrapper.find('.pick-avatar').exists()).toBe(true)
    wrapper.unmount()
  })
})
