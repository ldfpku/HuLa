import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TodoItem, TodoPage } from '@/services/types'
import { TodoSavedRefreshError } from '@/utils/TodoMutationError'

const mocks = vi.hoisted(() => ({
  user: { userInfo: { uid: 'a' } },
  page: vi.fn(),
  counts: vi.fn(),
  silent: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn()
}))
vi.mock('@/stores/user', () => ({ useUserStore: () => mocks.user }))
vi.mock('@/utils/ImRequestUtils', () => ({
  getTodoPage: mocks.page,
  getTodoCounts: mocks.counts,
  imRequestSilent: mocks.silent,
  createTodo: mocks.create,
  updateTodo: mocks.update,
  deleteTodo: mocks.remove
}))

import { useTodoStore } from './todo'

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

describe('to-do dialog pagination', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.user = reactive({ userInfo: { uid: 'a' } })
    mocks.counts.mockResolvedValue({ due: 251 })
  })

  it('uses the authoritative count and loads further pages', async () => {
    mocks.page.mockImplementation(async (params: { status: string; cursor?: string }) => {
      if (params.status === 'done') return { items: [], hasMore: false, nextCursor: null }
      if (params.cursor) return { items: [item('2')], hasMore: false, nextCursor: null }
      return { items: [item('1')], hasMore: true, nextCursor: 'next' }
    })
    const store = useTodoStore()
    await store.refresh()
    expect(store.dueCount).toBe(251)
    await store.loadMore('open')
    expect(store.openItems.map((todo) => todo.id)).toEqual(['1', '2'])
    expect(store.hasMore.open).toBe(false)
  })

  it('does not expose a late page after the account changes', async () => {
    let resolveOpen!: (page: TodoPage) => void
    mocks.page.mockImplementation((params: { status: string }) =>
      params.status === 'open'
        ? new Promise<TodoPage>((resolve) => (resolveOpen = resolve))
        : Promise.resolve({ items: [], hasMore: false, nextCursor: null })
    )
    const store = useTodoStore()
    const request = store.refresh()
    mocks.user.userInfo.uid = 'b'
    resolveOpen({ items: [item('old')], hasMore: false, nextCursor: null })
    await request
    expect(store.openItems).toEqual([])
    expect(store.dueCount).toBe(0)
  })

  it('does not let an older silent count overwrite a newer count', async () => {
    let resolveOld!: (result: { due: number }) => void
    mocks.silent
      .mockImplementationOnce(() => new Promise<{ due: number }>((resolve) => (resolveOld = resolve)))
      .mockResolvedValueOnce({ due: 2 })
    const store = useTodoStore()
    const old = store.refreshSilently()
    await store.refreshSilently()
    resolveOld({ due: 100 })
    await old
    expect(store.dueCount).toBe(2)
  })

  it('distinguishes a saved task from a failed create when refreshing fails', async () => {
    const store = useTodoStore()
    mocks.create.mockResolvedValueOnce(item('saved'))
    mocks.page.mockRejectedValueOnce(new Error('offline'))
    await expect(store.add({ title: 'Saved' })).rejects.toBeInstanceOf(TodoSavedRefreshError)
    expect(mocks.create).toHaveBeenCalledOnce()
    mocks.create.mockRejectedValueOnce(new Error('create failed'))
    await expect(store.add({ title: 'Unsaved' })).rejects.toThrow('create failed')
  })
})
