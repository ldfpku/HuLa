import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TodoSavedRefreshError } from '@/utils/TodoMutationError'

const { draft, add, warning, error, success } = vi.hoisted(() => ({
  draft: vi.fn(),
  add: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  success: vi.fn()
}))
vi.mock('@/utils/ImRequestUtils', () => ({ draftMailTodo: draft }))
vi.mock('@/stores/todo', () => ({ useTodoStore: () => ({ add }) }))
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
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window, { $message: { warning, error, success } })
  })

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

  it('closes and warns when the task was saved but the subsequent refresh failed', async () => {
    add.mockRejectedValueOnce(new TodoSavedRefreshError(new Error('offline')))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
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
    await wrapper
      .findAll('button')
      .find((item) => item.text().includes('保存到我的待办'))!
      .trigger('click')
    await flushPromises()
    expect(add).toHaveBeenCalledOnce()
    expect(wrapper.emitted('update:show')?.at(-1)).toEqual([false])
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('操作已保存'))
    wrapper.unmount()
    vi.restoreAllMocks()
  })

  it('keeps unsaved input and reports a failed write', async () => {
    add.mockRejectedValueOnce(new Error('write failed'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
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
    await wrapper
      .findAll('button')
      .find((item) => item.text().includes('保存到我的待办'))!
      .trigger('click')
    await flushPromises()
    expect(wrapper.emitted('update:show')).toBeUndefined()
    expect(error).toHaveBeenCalledWith('write failed')
    wrapper.unmount()
    vi.restoreAllMocks()
  })
})
