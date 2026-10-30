import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TodoItem, TodoPage } from '@/services/types'
import { TodoSavedRefreshError } from '@/utils/TodoMutationError'

const mocks = vi.hoisted(() => ({
  user: { userInfo: { uid: 'a' } },
  page: vi.fn(),
  detail: vi.fn(),
  lists: vi.fn(),
  steps: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  setDay: vi.fn(),
  createList: vi.fn(),
  updateList: vi.fn(),
  removeList: vi.fn(),
  reorderLists: vi.fn(),
  createStep: vi.fn(),
  updateStep: vi.fn(),
  removeStep: vi.fn(),
  reminders: vi.fn(),
  dismissReminder: vi.fn(),
  attachments: vi.fn(),
  createAttachment: vi.fn(),
  removeAttachment: vi.fn()
}))
vi.mock('@/stores/user', () => ({ useUserStore: () => mocks.user }))
vi.mock('@/stores/todo', () => ({ useTodoStore: () => ({ refreshSilently: vi.fn().mockResolvedValue(undefined) }) }))
vi.mock('@/utils/ImRequestUtils', () => ({
  getTodoPage: mocks.page,
  getTodoDetail: mocks.detail,
  getTodoLists: mocks.lists,
  getTodoSteps: mocks.steps,
  createTodo: mocks.create,
  updateTodo: mocks.update,
  deleteTodo: mocks.remove,
  setTodoDay: mocks.setDay,
  createTodoList: mocks.createList,
  updateTodoList: mocks.updateList,
  deleteTodoList: mocks.removeList,
  reorderTodoLists: mocks.reorderLists,
  createTodoStep: mocks.createStep,
  updateTodoStep: mocks.updateStep,
  deleteTodoStep: mocks.removeStep,
  getTodoReminders: mocks.reminders,
  dismissTodoReminder: mocks.dismissReminder,
  getTodoAttachments: mocks.attachments,
  createTodoAttachment: mocks.createAttachment,
  deleteTodoAttachment: mocks.removeAttachment
}))

import { useTodoWorkspaceStore } from './todoWorkspace'

function item(id: string): TodoItem {
  return {
    id,
    title: id,
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
    ownerId: 'a',
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
}

describe('to-do workspace data', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.user = reactive({ userInfo: { uid: 'a' } })
    mocks.lists.mockResolvedValue([])
    mocks.steps.mockResolvedValue([])
    mocks.reminders.mockResolvedValue([])
    mocks.attachments.mockResolvedValue([])
  })

  it('loads additional pages without treating the first page as the whole list', async () => {
    mocks.page
      .mockResolvedValueOnce({ items: [item('1'), item('2')], hasMore: true, nextCursor: 'next' })
      .mockResolvedValueOnce({ items: [item('2'), item('3')], hasMore: false, nextCursor: null })
    const store = useTodoWorkspaceStore()
    await store.refresh()
    await store.loadMore()
    expect(store.items.map((todo) => todo.id)).toEqual(['1', '2', '3'])
    expect(store.hasMore).toBe(false)
    expect(mocks.page.mock.calls[1][0].cursor).toBe('next')
  })

  it('clears data on account switch and ignores the old account response', async () => {
    let resolveOld!: (page: TodoPage) => void
    mocks.page
      .mockImplementationOnce(() => new Promise<TodoPage>((resolve) => (resolveOld = resolve)))
      .mockResolvedValueOnce({ items: [item('new-account')], hasMore: false, nextCursor: null })
    const store = useTodoWorkspaceStore()
    const oldRequest = store.refresh()
    mocks.user.userInfo.uid = 'b'
    expect(store.items).toEqual([])
    await store.refresh()
    resolveOld({ items: [item('old-account')], hasMore: false, nextCursor: null })
    await oldRequest
    expect(store.items.map((todo) => todo.id)).toEqual(['new-account'])
  })

  it('uses optimistic versions and reports a saved write whose refresh fails', async () => {
    const original = item('1')
    mocks.page.mockResolvedValueOnce({ items: [original], hasMore: false, nextCursor: null })
    const store = useTodoWorkspaceStore()
    await store.refresh()
    mocks.update.mockResolvedValue({ ...original, title: 'changed', version: 2 })
    mocks.page.mockRejectedValueOnce(new Error('offline'))
    await expect(store.update(original, { title: 'changed' })).rejects.toBeInstanceOf(TodoSavedRefreshError)
    expect(mocks.update).toHaveBeenCalledWith({ id: '1', expectedVersion: 1, title: 'changed' })
    expect(store.error).toBe('offline')
  })

  it('retains the saved task version when reloading its selected details fails', async () => {
    const original = item('selected')
    const saved = { ...original, title: 'saved', version: 2 }
    const store = useTodoWorkspaceStore()
    await store.selectTask(original)
    mocks.update.mockResolvedValue(saved)
    mocks.page.mockRejectedValueOnce(new Error('offline'))
    await expect(store.update(original, { title: 'saved' })).rejects.toBeInstanceOf(TodoSavedRefreshError)
    expect(store.selected?.title).toBe('saved')
    expect(store.selected?.version).toBe(2)
  })

  it('keeps the selected task from a later page after a refresh', async () => {
    const later = item('later')
    mocks.page
      .mockResolvedValueOnce({ items: [item('first')], hasMore: true, nextCursor: 'next' })
      .mockResolvedValueOnce({ items: [later], hasMore: false, nextCursor: null })
      .mockResolvedValueOnce({ items: [item('first')], hasMore: true, nextCursor: 'next' })
    mocks.detail.mockResolvedValue({ available: true, item: { ...later, title: 'updated', version: 2 } })
    mocks.update.mockResolvedValue({ ...later, title: 'updated', version: 2 })
    const store = useTodoWorkspaceStore()
    await store.refresh()
    await store.loadMore()
    await store.selectTask(later)
    await store.update(later, { title: 'updated' })
    expect(store.selected?.title).toBe('updated')
    expect(store.selected?.version).toBe(2)
    expect(store.items.map((todo) => todo.id)).toEqual(['first'])
  })

  it('refreshes selected steps and attachments as well as task details', async () => {
    const task = item('selected')
    const step = {
      id: 's1',
      todoId: task.id,
      title: 'step',
      done: true,
      position: 0,
      version: 2,
      createdAt: 1,
      updatedAt: 2
    }
    const attachment = {
      id: 'a1',
      todoId: task.id,
      available: true,
      name: 'file.txt',
      size: 2,
      path: '/file',
      createdAt: 1
    }
    mocks.page.mockResolvedValue({ items: [task], hasMore: false, nextCursor: null })
    mocks.detail.mockResolvedValue({ available: true, item: { ...task, version: 2 } })
    const store = useTodoWorkspaceStore()
    await store.selectTask(task)
    mocks.steps.mockResolvedValueOnce([step])
    mocks.attachments.mockResolvedValueOnce([attachment])
    await store.refresh()
    expect(store.selected?.version).toBe(2)
    expect(store.steps).toEqual([step])
    expect(store.attachments).toEqual([attachment])
  })

  it('clears selected details when access is revoked during refresh', async () => {
    const task = item('selected')
    mocks.page.mockResolvedValue({ items: [], hasMore: false, nextCursor: null })
    mocks.detail.mockResolvedValue({ available: false })
    const store = useTodoWorkspaceStore()
    await store.selectTask(task)
    await store.refresh()
    expect(store.selected).toBeNull()
    expect(store.steps).toEqual([])
    expect(store.attachments).toEqual([])
    expect(store.error).toContain('访问权限')
  })

  it('deduplicates live notifications while retaining reminders for offline review', async () => {
    const reminder = { id: 'r1', todoId: '1', title: 'Task', scheduledAt: 1, createdAt: 2 }
    mocks.reminders.mockResolvedValue([reminder])
    const store = useTodoWorkspaceStore()
    const [first, second] = await Promise.all([
      store.receiveReminders({ ids: ['r1'] }),
      store.receiveReminders({ ids: ['r1'] })
    ])
    expect(first.length + second.length).toBe(1)
    expect(store.reminders).toEqual([reminder])
    expect(mocks.reminders).toHaveBeenCalledOnce()
    await expect(store.receiveReminders({ ids: ['r1'] })).resolves.toEqual([])
  })
})
