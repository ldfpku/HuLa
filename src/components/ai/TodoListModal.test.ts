import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TodoSavedRefreshError } from '@/utils/TodoMutationError'

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  store: {} as Record<string, unknown>
}))
vi.mock('@/stores/todo', () => ({ useTodoStore: () => mocks.store }))
vi.mock('@/stores/mail', () => ({ useMailStore: () => ({ openMailMessage: vi.fn() }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

import TodoListModal from './TodoListModal.vue'

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
const input = defineComponent({
  props: ['value', 'placeholder'],
  emits: ['update:value'],
  setup:
    (props, { emit, attrs }) =>
    () =>
      h('input', {
        ...attrs,
        value: props.value ?? '',
        placeholder: props.placeholder,
        onInput: (event: Event) => emit('update:value', (event.target as HTMLInputElement).value)
      })
})

describe('legacy to-do entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.add.mockReset()
    mocks.store = reactive({
      visible: true,
      loading: false,
      loadingMore: { open: false, done: false },
      hasMore: { open: false, done: false },
      openItems: [],
      doneItems: [],
      add: mocks.add
    })
    Object.assign(window, { $message: { warning: mocks.warning, error: mocks.error } })
  })

  it('clears only a saved task and reports refresh failure without inviting a duplicate', async () => {
    mocks.add.mockRejectedValueOnce(new TodoSavedRefreshError(new Error('offline')))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const wrapper = mount(TodoListModal, {
      global: {
        stubs: {
          Modal: container,
          Flex: container,
          Button: button,
          Input: input,
          DatePicker: true,
          Tabs: container,
          Tab: container,
          Scrollbar: container
        }
      }
    })
    const field = wrapper.get<HTMLInputElement>('input[placeholder="添加待办，回车保存"]')
    await field.setValue('Saved task')
    await wrapper
      .findAll('button')
      .find((entry) => entry.text() === '添加')!
      .trigger('click')
    await flushPromises()
    expect(field.element.value).toBe('')
    expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining('操作已保存'))
    wrapper.unmount()
    vi.restoreAllMocks()
  })
})
