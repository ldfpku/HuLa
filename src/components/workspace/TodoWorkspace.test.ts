import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TodoItem } from '@/services/types'
import { TodoSavedRefreshError } from '@/utils/TodoMutationError'

const mocks = vi.hoisted(() => ({
  store: {} as Record<string, unknown>,
  dialog: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  search: vi.fn(),
  user: { userInfo: { uid: 'owner' } }
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/stores/todoWorkspace', () => ({ useTodoWorkspaceStore: () => mocks.store }))
vi.mock('@/stores/user', () => ({ useUserStore: () => mocks.user }))
vi.mock('@/stores/mail', () => ({ useMailStore: () => ({ openMail: vi.fn(), openMailMessage: vi.fn() }) }))
vi.mock('@/utils/ImRequestUtils', () => ({ searchTodoAssignees: mocks.search }))
vi.mock('@/components/windows/ActionBar.vue', () => ({ default: { template: '<header><slot /></header>' } }))
vi.mock('@/components/rightBox/chatBox/DrivePickerModal.vue', () => ({ default: { template: '<div />' } }))

import TodoWorkspace from './TodoWorkspace.vue'

const todo: TodoItem = {
  id: 't1',
  title: 'Original',
  notes: '',
  dueAt: null,
  dueDate: null,
  dueTimeZone: null,
  done: false,
  doneAt: null,
  sourceType: 'manual',
  sourceId: null,
  sourceTitle: '',
  sourcePath: null,
  ownerId: 'owner',
  listId: null,
  assigneeId: null,
  important: false,
  myDay: null,
  version: 1,
  remindAt: null,
  repeat: null,
  createdAt: 1,
  updatedAt: 1
}

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
const select = defineComponent({
  name: 'Select',
  props: ['value', 'options'],
  emits: ['update:value', 'search'],
  setup: () => () => h('div')
})

describe('to-do workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user = reactive({ userInfo: { uid: 'owner' } })
    const state = reactive({
      view: 'tasks',
      listId: null,
      search: '',
      sort: 'created',
      today: '2026-10-30',
      items: [{ ...todo }],
      lists: [],
      steps: [],
      attachments: [],
      reminders: [],
      selected: null as TodoItem | null,
      hasMore: false,
      loading: false,
      loadingMore: false,
      loadingSteps: false,
      loadingReminders: false,
      error: '',
      stepError: '',
      reminderError: '',
      refresh: vi.fn().mockResolvedValue(undefined),
      refreshReminders: vi.fn().mockResolvedValue([]),
      selectView: vi.fn().mockResolvedValue(undefined),
      setSearch: vi.fn().mockResolvedValue(undefined),
      setSort: vi.fn().mockResolvedValue(undefined),
      selectTask: vi.fn(async (item: TodoItem | null) => {
        state.selected = item
      }),
      add: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(todo),
      remove: vi.fn(),
      setDay: vi.fn(),
      addStep: vi.fn(),
      updateStep: vi.fn(),
      removeStep: vi.fn(),
      dismissReminder: vi.fn()
    })
    mocks.store = state
    Object.assign(window, {
      $dialog: { warning: mocks.dialog },
      $message: { warning: mocks.warning, error: mocks.error }
    })
  })

  const render = (attach = false) =>
    mount(TodoWorkspace, {
      ...(attach ? { attachTo: document.body } : {}),
      props: { active: false },
      global: {
        stubs: {
          Scrollbar: container,
          Button: button,
          Input: input,
          DatePicker: true,
          Checkbox: true,
          Select: select,
          Dropdown: container,
          Modal: container,
          Popconfirm: container
        }
      }
    })

  it('creates a task only after an explicit add action', async () => {
    const wrapper = render()
    await wrapper.get('input[placeholder="todo.addPlaceholder"]').setValue('New task')
    expect(mocks.store.add).not.toHaveBeenCalled()
    await wrapper
      .findAll('button')
      .find((entry) => entry.text() === 'todo.add')
      ?.trigger('click')
    await flushPromises()
    expect(mocks.store.add).toHaveBeenCalledWith('New task', null, false)
    wrapper.unmount()
  })

  it('clears a saved task draft when refresh fails but keeps it after a failed write', async () => {
    const wrapper = render()
    const field = wrapper.get<HTMLInputElement>('input[placeholder="todo.addPlaceholder"]')
    const submit = () =>
      wrapper
        .findAll('button')
        .find((entry) => entry.text() === 'todo.add')!
        .trigger('click')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(mocks.store.add as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TodoSavedRefreshError(new Error('offline'))
    )
    await field.setValue('Saved task')
    await submit()
    await flushPromises()
    expect(field.element.value).toBe('')
    expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining('操作已保存'))
    ;(mocks.store.add as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('write failed'))
    await field.setValue('Unsaved task')
    await submit()
    await flushPromises()
    expect(field.element.value).toBe('Unsaved task')
    expect(mocks.error).toHaveBeenCalledWith('write failed')
    wrapper.unmount()
    vi.restoreAllMocks()
  })

  it('does not erase a new task typed while the previous task is saving', async () => {
    let finish!: () => void
    ;(mocks.store.add as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve))
    )
    const wrapper = render()
    const field = wrapper.get<HTMLInputElement>('input[placeholder="todo.addPlaceholder"]')
    await field.setValue('First task')
    await wrapper
      .findAll('button')
      .find((entry) => entry.text() === 'todo.add')!
      .trigger('click')
    await field.setValue('Next task')
    finish()
    await flushPromises()
    expect(field.element.value).toBe('Next task')
    wrapper.unmount()
  })

  it('accepts a saved detail version when only the refresh fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    ;(mocks.store.update as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      mocks.store.selected = { ...todo, title: 'Saved detail', version: 2 }
      throw new TodoSavedRefreshError(new Error('offline'))
    })
    const wrapper = render()
    await wrapper
      .findAll('button')
      .find((entry) => entry.text().includes('Original'))!
      .trigger('click')
    await flushPromises()
    const field = wrapper.findAll('input').find((entry) => entry.element.value === 'Original')!
    await field.setValue('Saved detail')
    const save = wrapper.findAll('button').find((entry) => entry.text() === 'todo.save')!
    await save.trigger('click')
    await flushPromises()
    expect(field.element.value).toBe('Saved detail')
    expect(save.attributes('disabled')).toBeDefined()
    expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining('操作已保存'))
    wrapper.unmount()
    vi.restoreAllMocks()
  })

  it('requires confirmation before abandoning unsaved task details', async () => {
    const wrapper = render()
    await wrapper
      .findAll('button')
      .find((entry) => entry.text().includes('Original'))
      ?.trigger('click')
    await flushPromises()
    const inputs = wrapper.findAll('input')
    const detailTitle = inputs.find((entry) => entry.element.value === 'Original')
    expect(detailTitle).toBeDefined()
    await detailTitle?.setValue('Unsaved')
    await wrapper
      .findAll('button')
      .find((entry) => entry.text() === 'todo.important')
      ?.trigger('click')
    expect(mocks.dialog).toHaveBeenCalledOnce()
    expect(mocks.store.selectView).not.toHaveBeenCalled()
    mocks.dialog.mock.calls[0][0].onPositiveClick()
    await flushPromises()
    expect(mocks.store.selectView).toHaveBeenCalledWith('important', null)
    wrapper.unmount()
  })

  it('moves focus into a narrow detail view and restores it on close', async () => {
    const wrapper = render(true)
    const task = wrapper.findAll('button').find((entry) => entry.text().includes('Original'))
    expect(task).toBeDefined()
    task!.element.focus()
    wrapper.get<HTMLElement>('main').element.style.display = 'none'
    await task!.trigger('click')
    await flushPromises()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('todo.closeDetails')
    wrapper.get<HTMLElement>('main').element.style.display = ''
    await wrapper.get('button[aria-label="todo.closeDetails"]').trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(task!.element)
    wrapper.unmount()
  })

  it('moves focus out of the list if resizing hides it', async () => {
    const wrapper = render(true)
    const task = wrapper.findAll('button').find((entry) => entry.text().includes('Original'))
    await task?.trigger('click')
    await flushPromises()
    const search = wrapper.get<HTMLInputElement>('input[placeholder="todo.search"]')
    search.element.focus()
    wrapper.get<HTMLElement>('main').element.style.display = 'none'
    window.dispatchEvent(new Event('resize'))
    await flushPromises()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('todo.closeDetails')
    wrapper.get<HTMLElement>('main').element.style.display = ''
    await wrapper.get('button[aria-label="todo.closeDetails"]').trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(search.element)
    wrapper.unmount()
  })

  it('does not discard an edit made while a debounced search is pending', async () => {
    const wrapper = render()
    await wrapper
      .findAll('button')
      .find((entry) => entry.text().includes('Original'))
      ?.trigger('click')
    await flushPromises()
    await wrapper.get('input[placeholder="todo.search"]').setValue('query')
    const detailTitle = wrapper.findAll('input').find((entry) => entry.element.value === 'Original')
    await detailTitle?.setValue('Unsaved')
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(mocks.store.setSearch).not.toHaveBeenCalled()
    expect(mocks.warning).toHaveBeenCalledWith('todo.detailsUnsaved')
    expect(detailTitle?.element.value).toBe('Unsaved')
    wrapper.unmount()
  })

  it('does not search for an old account after switching accounts', async () => {
    const wrapper = render()
    await wrapper
      .findAll('button')
      .find((entry) => entry.text().includes('Original'))
      ?.trigger('click')
    await flushPromises()
    wrapper.findAllComponents(select)[3].vm.$emit('search', 'old account query')
    mocks.user.userInfo.uid = 'other'
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(mocks.search).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('clears an unfinished new task when the account changes', async () => {
    const wrapper = render()
    const input = wrapper.get<HTMLInputElement>('input[placeholder="todo.addPlaceholder"]')
    await input.setValue('Old account draft')
    mocks.user.userInfo.uid = 'other'
    await flushPromises()
    expect(input.element.value).toBe('')
    wrapper.unmount()
  })

  it('refreshes an idle active list on focus without disturbing an open detail', async () => {
    const wrapper = render()
    await wrapper.setProps({ active: true })
    await flushPromises()
    vi.mocked(mocks.store.refresh as () => Promise<void>).mockClear()
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(mocks.store.refresh).toHaveBeenCalledOnce()

    await wrapper
      .findAll('button')
      .find((entry) => entry.text().includes('Original'))
      ?.trigger('click')
    await flushPromises()
    vi.mocked(mocks.store.refresh as () => Promise<void>).mockClear()
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(mocks.store.refresh).not.toHaveBeenCalled()
    await wrapper.setProps({ active: false })
    await wrapper.setProps({ active: true })
    await flushPromises()
    expect(mocks.store.refresh).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not assign a task until sharing is explicitly confirmed', async () => {
    const wrapper = render()
    await wrapper
      .findAll('button')
      .find((entry) => entry.text().includes('Original'))
      ?.trigger('click')
    await flushPromises()
    const selects = wrapper.findAllComponents(select)
    expect(selects.length).toBe(4)
    selects[3].vm.$emit('update:value', 'user-2')
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((entry) => entry.text() === 'todo.assign')
      ?.trigger('click')
    expect(mocks.dialog).toHaveBeenCalledOnce()
    expect(mocks.store.update).not.toHaveBeenCalled()
    await mocks.dialog.mock.calls[0][0].onPositiveClick()
    expect(mocks.store.update).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), {
      assigneeId: 'user-2',
      confirmShare: true
    })
    wrapper.unmount()
  })

  it('does not apply an old account sharing confirmation to another account', async () => {
    const wrapper = render()
    await wrapper
      .findAll('button')
      .find((entry) => entry.text().includes('Original'))
      ?.trigger('click')
    await flushPromises()
    wrapper.findAllComponents(select)[3].vm.$emit('update:value', 'user-2')
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((entry) => entry.text() === 'todo.assign')
      ?.trigger('click')
    const confirm = mocks.dialog.mock.calls[0][0].onPositiveClick
    mocks.user.userInfo.uid = 'other'
    await flushPromises()
    await confirm()
    expect(mocks.store.update).not.toHaveBeenCalled()
    expect(mocks.warning).toHaveBeenCalledWith('todo.accountChanged')
    wrapper.unmount()
  })
})
