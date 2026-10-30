import { defineStore } from 'pinia'
import { ImUrlEnum, StoresEnum } from '@/enums'
import type { TodoItem } from '@/services/types'
import { useUserStore } from '@/stores/user'
import { createTodo, deleteTodo, getTodoCounts, getTodoPage, imRequestSilent, updateTodo } from '@/utils/ImRequestUtils'
import { localTodoDay } from '@/utils/TodoDate'
import { TodoSavedRefreshError } from '@/utils/TodoMutationError'

/**
 * 我的待办：服务端 im_todos 里自己的待办。邮件“转为待办”和手动添加都存到这里；
 * 列表在左侧栏“待办”打开的弹窗里查看、勾选完成。
 */
export const useTodoStore = defineStore(StoresEnum.TODO, () => {
  const user = useUserStore()
  const visible = ref(false)
  const loading = ref(false)
  const loadingMore = ref({ open: false, done: false })
  const hasMore = ref({ open: false, done: false })
  const cursors = ref<{ open: string | null; done: string | null }>({ open: null, done: null })
  const openItems = ref<TodoItem[]>([])
  const doneItems = ref<TodoItem[]>([])
  const dueCount = ref(0)
  let generation = 0
  let countGeneration = 0
  const uid = () => user.userInfo?.uid ?? ''
  const countParams = () => {
    const now = new Date()
    const end = new Date(now)
    end.setHours(23, 59, 59, 999)
    return { day: localTodoDay(now), endAt: end.getTime() }
  }
  const checkAccount = (account: string) => {
    if (!account || uid() !== account) throw new Error('账号已切换，请检查操作结果')
  }

  watch(
    () => uid(),
    (account, previous) => {
      if (account === previous) return
      generation++
      countGeneration++
      openItems.value = []
      doneItems.value = []
      dueCount.value = 0
      cursors.value = { open: null, done: null }
      hasMore.value = { open: false, done: false }
      loading.value = false
      loadingMore.value = { open: false, done: false }
      visible.value = false
    },
    { flush: 'sync' }
  )

  const refresh = async () => {
    const account = uid()
    checkAccount(account)
    const request = ++generation
    const countRequest = ++countGeneration
    loading.value = true
    loadingMore.value = { open: false, done: false }
    try {
      const { day, endAt } = countParams()
      const [open, done, counts] = await Promise.all([
        getTodoPage({ status: 'open', view: 'owned', sort: 'due', pageSize: 50 }),
        getTodoPage({ status: 'done', view: 'owned', sort: 'created', pageSize: 50 }),
        getTodoCounts(day, endAt)
      ])
      if (uid() !== account || request !== generation) return
      openItems.value = open.items
      doneItems.value = done.items
      cursors.value = { open: open.nextCursor, done: done.nextCursor }
      hasMore.value = { open: open.hasMore, done: done.hasMore }
      if (countRequest === countGeneration) dueCount.value = counts.due
    } catch (error) {
      if (uid() === account && request === generation) throw error
    } finally {
      if (uid() === account && request === generation) loading.value = false
    }
  }

  const refreshSilently = async () => {
    const account = uid()
    if (!account) return
    const request = ++countGeneration
    const counts = await imRequestSilent<{ due: number }>({ url: ImUrlEnum.TODO_COUNTS, params: countParams() })
    if (counts && uid() === account && request === countGeneration) dueCount.value = counts.due
  }

  const loadMore = async (status: 'open' | 'done') => {
    const account = uid()
    checkAccount(account)
    const request = generation
    const cursor = cursors.value[status]
    if (loading.value || loadingMore.value[status] || !hasMore.value[status]) return
    if (!cursor) throw new Error('待办分页游标无效，请刷新后重试')
    loadingMore.value[status] = true
    try {
      const page = await getTodoPage({
        status,
        view: 'owned',
        sort: status === 'open' ? 'due' : 'created',
        pageSize: 50,
        cursor
      })
      if (uid() !== account || request !== generation || cursors.value[status] !== cursor) return
      const target = status === 'open' ? openItems : doneItems
      const known = new Set(target.value.map((item) => item.id))
      target.value.push(...page.items.filter((item) => !known.has(item.id)))
      cursors.value[status] = page.nextCursor
      hasMore.value[status] = page.hasMore
    } catch (error) {
      if (uid() === account && request === generation) throw error
    } finally {
      if (uid() === account && request === generation) loadingMore.value[status] = false
    }
  }

  const open = async () => {
    visible.value = true
    await refresh()
  }

  const refreshAfterWrite = async (account: string) => {
    checkAccount(account)
    try {
      await refresh()
    } catch (cause) {
      throw new TodoSavedRefreshError(cause)
    }
    checkAccount(account)
  }

  const add = async (input: Parameters<typeof createTodo>[0]) => {
    const account = uid()
    checkAccount(account)
    const item = await createTodo(input)
    await refreshAfterWrite(account)
    return item
  }

  const update = async (input: Parameters<typeof updateTodo>[0]) => {
    const account = uid()
    checkAccount(account)
    const item = await updateTodo(input)
    await refreshAfterWrite(account)
    return item
  }

  const remove = async (item: Pick<TodoItem, 'id' | 'version'>) => {
    const account = uid()
    checkAccount(account)
    await deleteTodo(item.id, item.version)
    await refreshAfterWrite(account)
  }

  return {
    visible,
    loading,
    loadingMore,
    hasMore,
    openItems,
    doneItems,
    dueCount,
    refresh,
    refreshSilently,
    loadMore,
    open,
    add,
    update,
    remove
  }
})
