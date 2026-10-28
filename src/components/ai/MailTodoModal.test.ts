import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'

const draft = vi.hoisted(() => vi.fn())
vi.mock('@/utils/ImRequestUtils', () => ({ draftMailTodo: draft }))
vi.mock('@/stores/todo', () => ({ useTodoStore: () => ({ add: vi.fn() }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

import MailTodoModal from './MailTodoModal.vue'

const container = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      h('div', slots.default?.())
})
const button = defineComponent({
  setup:
    (_, { slots, attrs }) =>
    () =>
      h('button', attrs, slots.default?.())
})

describe('mail to-do consent', () => {
  it('does not request an AI draft until explicitly confirmed', async () => {
    draft.mockReset()
    draft.mockResolvedValue({ title: 'Task', dueAt: null, notes: '' })
    const wrapper = mount(MailTodoModal, {
      props: { shareId: 'share', subject: 'Subject', show: false },
      global: {
        stubs: {
          Modal: container,
          Flex: container,
          Button: button,
          Form: container,
          FormItem: container,
          Input: true,
          DatePicker: true
        }
      }
    })
    await wrapper.setProps({ show: true })
    expect(draft).not.toHaveBeenCalled()
    await wrapper
      .findAll('button')
      .find((item) => item.text().includes('确认使用 AI 生成'))!
      .trigger('click')
    await flushPromises()
    expect(draft).toHaveBeenCalledExactlyOnceWith({ shareId: 'share', confirmed: true })
    wrapper.unmount()
  })
})
