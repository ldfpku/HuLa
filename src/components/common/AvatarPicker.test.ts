import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { AvatarUtils } from '@/utils/AvatarUtils'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('naive-ui', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    NModal: defineComponent({
      props: { show: Boolean },
      setup(props, { slots }) {
        return () => (props.show ? h('div', slots.default?.()) : null)
      }
    }),
    NButton: defineComponent({
      setup(_, { attrs, slots }) {
        return () => h('button', attrs, slots.default?.())
      }
    })
  }
})

import AvatarPicker from './AvatarPicker.vue'

describe('avatar picker', () => {
  it('displays all presets and emits the chosen avatar', async () => {
    const wrapper = mount(AvatarPicker, { props: { show: true, currentAvatar: '001' } })
    const options = wrapper.findAll('.avatar-option')
    expect(options).toHaveLength(22)
    expect(options[0].attributes('aria-pressed')).toBe('true')
    await options[21].trigger('click')
    expect(wrapper.emitted('select')).toEqual([['022']])
  })

  it('marks the stable fallback as selected and disables changes while saving', () => {
    const uid = 'user-123'
    const wrapper = mount(AvatarPicker, { props: { show: true, uid, busy: true } })
    const selected = wrapper.find('.avatar-option[aria-pressed="true"]')
    expect(selected.attributes('aria-label')).toBe('components.avatarPicker.option')
    expect(selected.find('img').attributes('src')).toBe(AvatarUtils.getAvatarUrl('', uid))
    expect(wrapper.findAll('.avatar-option').every((option) => option.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.get('[role=status]').text()).toBe('components.avatarPicker.saving')
  })
})
