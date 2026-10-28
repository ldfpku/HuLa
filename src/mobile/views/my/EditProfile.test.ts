import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ updateAvatar: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('naive-ui', async () => {
  const { defineComponent, h } = await import('vue')
  const component = defineComponent({
    setup:
      (_, { slots }) =>
      () =>
        h('div', slots.default?.())
  })
  const hidden = defineComponent({ setup: () => () => null })
  return {
    NAvatar: component,
    NCard: component,
    NForm: component,
    NFormItem: component,
    NInput: component,
    NDivider: component,
    NDrawer: hidden,
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
vi.mock('@/hooks/useUpload', () => ({ useUpload: vi.fn() }))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))
vi.mock('@/stores/group', () => ({ useGroupStore: () => ({ getUserInfo: vi.fn() }) }))
vi.mock('@/stores/loginHistory', () => ({ useLoginHistoriesStore: () => ({ updateLoginHistory: vi.fn() }) }))
vi.mock('@/stores/user.ts', () => ({
  useUserStore: () => ({
    userInfo: { uid: 'user', name: 'User', avatar: '', sex: 1 },
    updateAvatar: mocks.updateAvatar
  })
}))
vi.mock('@/utils/ImRequestUtils', () => ({ ModifyUserInfo: vi.fn() }))

import EditProfile from './EditProfile.vue'

const scaffold = defineComponent({
  setup(_, { slots }) {
    return () => h('div', [slots.header?.(), slots.container?.()])
  }
})

describe('mobile profile avatar editor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updateAvatar.mockResolvedValue(undefined)
    Object.assign(window, { $message: { success: mocks.success, error: mocks.error } })
  })

  it('opens the actual file input from the avatar picker', async () => {
    const wrapper = mount(EditProfile, { global: { components: { MobileScaffold: scaffold } } })
    const input = wrapper.get('input[type=file]').element as HTMLInputElement
    const click = vi.spyOn(input, 'click').mockImplementation(() => {})
    await wrapper.get('.rounded-full.relative').trigger('click')
    await wrapper.get('.upload-avatar').trigger('click')
    expect(click).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('persists a selected preset through the profile avatar action', async () => {
    const wrapper = mount(EditProfile, { global: { components: { MobileScaffold: scaffold } } })
    await wrapper.get('.rounded-full.relative').trigger('click')
    await wrapper.get('.pick-avatar').trigger('click')
    await flushPromises()
    expect(mocks.updateAvatar).toHaveBeenCalledWith('022')
    expect(mocks.success).toHaveBeenCalled()
    wrapper.unmount()
  })
})
