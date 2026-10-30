import { defineStore } from 'pinia'
import { StoresEnum } from '@/enums'
import type { TodoAttachment, TodoItem, TodoList, TodoReminder, TodoSort, TodoStep, TodoView } from '@/services/types'
import { useUserStore } from '@/stores/user'
import { useTodoStore } from '@/stores/todo'
import {
  createTodo,
  createTodoAttachment,
  createTodoList,
  createTodoStep,
  deleteTodo,
  deleteTodoAttachment,
  deleteTodoList,
  deleteTodoStep,
  dismissTodoReminder,
  getTodoLists,
  getTodoAttachments,
  getTodoDetail,
  getTodoPage,
  getTodoReminders,
  getTodoSteps,
  reorderTodoLists,
  setTodoDay,
  updateTodo,
  updateTodoList,
  updateTodoStep
} from '@/utils/ImRequestUtils'
import { localTodoDay, localTodoTimeZone } from '@/utils/TodoDate'
import { TodoSavedRefreshError } from '@/utils/TodoMutationError'

export const useTodoWorkspaceStore = defineStore(StoresEnum.TODO_WORKSPACE, () => {
  const user = useUserStore()
  const badgeStore = useTodoStore()
  const view = ref<TodoView>('day')
  const listId = ref<string | null>(null)
  const search = ref('')
  const sort = ref<TodoSort>('created')
  const today = ref(localTodoDay())
  const items = ref<TodoItem[]>([])
  const lists = ref<TodoList[]>([])
  const steps = ref<TodoStep[]>([])
  const attachments = ref<TodoAttachment[]>([])
  const reminders = ref<TodoReminder[]>([])
  const selectedId = ref<string | null>(null)
  const selectedItem = ref<TodoItem | null>(null)
  const cursor = ref<string | null>(null)
  const hasMore = ref(false)
  const loading = ref(false)
  const loadingMore = ref(false)
  const loadingSteps = ref(false)
  const error = ref('')
  const stepError = ref('')
  const reminderError = ref('')
  const loadingReminders = ref(false)
  const selected = computed(() => selectedItem.value)
  let generation = 0
  let stepGeneration = 0
  let reminderGeneration = 0
  let reminderRequest: Promise<TodoReminder[]> | null = null
  let reminderAccount = ''
  const notifiedReminderIds = new Set<string>()

  const uid = () => user.userInfo?.uid ?? ''
  const current = (account: string, request: number) => Boolean(account) && uid() === account && generation === request
  const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))
  const requireAccount = () => {
    const account = uid()
    if (!account) throw new Error('账号未登录')
    return account
  }
  const requireSameAccount = (account: string) => {
    if (uid() !== account) throw new Error('账号已切换，请检查操作结果')
  }
  const pageParams = (nextCursor?: string) => {
    const selectedView = search.value.trim() ? 'all' : view.value
    return {
      status: 'all' as const,
      pageSize: 50,
      view: selectedView,
      sort: sort.value,
      ...(selectedView === 'list' && listId.value ? { listId: listId.value } : {}),
      ...(selectedView === 'day' ? { day: today.value } : {}),
      ...(search.value.trim() ? { q: search.value.trim() } : {}),
      ...(nextCursor ? { cursor: nextCursor } : {})
    }
  }

  const clear = () => {
    generation++
    stepGeneration++
    reminderGeneration++
    reminderRequest = null
    reminderAccount = ''
    notifiedReminderIds.clear()
    items.value = []
    lists.value = []
    steps.value = []
    attachments.value = []
    reminders.value = []
    selectedId.value = null
    selectedItem.value = null
    cursor.value = null
    hasMore.value = false
    loading.value = false
    loadingMore.value = false
    loadingSteps.value = false
    error.value = ''
    stepError.value = ''
    reminderError.value = ''
    loadingReminders.value = false
  }

  watch(
    () => uid(),
    (account, previous) => {
      if (account !== previous) {
        clear()
        view.value = 'day'
        listId.value = null
        search.value = ''
        sort.value = 'created'
        today.value = localTodoDay()
      }
    },
    { flush: 'sync' }
  )

  const refresh = async () => {
    const account = requireAccount()
    const request = ++generation
    const params = pageParams()
    const selectedAtStart = selectedId.value
    loading.value = true
    loadingMore.value = false
    error.value = ''
    try {
      const [nextLists, page, detail] = await Promise.all([
        getTodoLists(),
        getTodoPage(params),
        selectedAtStart ? getTodoDetail(selectedAtStart) : Promise.resolve(null)
      ])
      if (!current(account, request)) return
      lists.value = nextLists
      items.value = page.items
      cursor.value = page.nextCursor
      hasMore.value = page.hasMore
      if (selectedAtStart && selectedId.value === selectedAtStart && detail) {
        if (detail.available) await selectTask(detail.item)
        else {
          selectedId.value = null
          selectedItem.value = null
          steps.value = []
          attachments.value = []
          loadingSteps.value = false
          stepError.value = ''
          stepGeneration++
          error.value = '任务不可用或访问权限已变更'
        }
      }
    } catch (cause) {
      if (current(account, request)) {
        error.value = message(cause)
        throw cause
      }
    } finally {
      if (current(account, request)) loading.value = false
    }
  }

  const loadMore = async () => {
    if (loading.value || loadingMore.value || !hasMore.value || !cursor.value) return
    const account = requireAccount()
    const request = generation
    const previousCursor = cursor.value
    const params = pageParams(previousCursor)
    loadingMore.value = true
    error.value = ''
    try {
      const page = await getTodoPage(params)
      if (!current(account, request) || cursor.value !== previousCursor) return
      const known = new Set(items.value.map((item) => item.id))
      items.value.push(...page.items.filter((item) => !known.has(item.id)))
      cursor.value = page.nextCursor
      hasMore.value = page.hasMore
    } catch (cause) {
      if (current(account, request)) {
        error.value = message(cause)
        throw cause
      }
    } finally {
      if (current(account, request)) loadingMore.value = false
    }
  }

  const selectView = async (next: TodoView, nextListId: string | null = null) => {
    view.value = next
    listId.value = nextListId
    search.value = ''
    selectedId.value = null
    selectedItem.value = null
    steps.value = []
    attachments.value = []
    loadingSteps.value = false
    stepError.value = ''
    stepGeneration++
    items.value = []
    await refresh()
  }

  const setSearch = async (query: string) => {
    search.value = query.trim()
    selectedId.value = null
    selectedItem.value = null
    steps.value = []
    attachments.value = []
    loadingSteps.value = false
    stepError.value = ''
    stepGeneration++
    items.value = []
    await refresh()
  }

  const setSort = async (value: TodoSort) => {
    sort.value = value
    items.value = []
    await refresh()
  }

  const selectTask = async (item: TodoItem | null) => {
    selectedId.value = item?.id ?? null
    selectedItem.value = item
    steps.value = []
    attachments.value = []
    stepError.value = ''
    loadingSteps.value = false
    const request = ++stepGeneration
    if (!item) return
    const account = requireAccount()
    loadingSteps.value = true
    try {
      const [nextSteps, nextAttachments] = await Promise.all([getTodoSteps(item.id), getTodoAttachments(item.id)])
      if (uid() === account && request === stepGeneration && selectedId.value === item.id) {
        steps.value = nextSteps
        attachments.value = nextAttachments
      }
    } catch (cause) {
      if (uid() === account && request === stepGeneration) {
        stepError.value = message(cause)
        throw cause
      }
    } finally {
      if (uid() === account && request === stepGeneration) loadingSteps.value = false
    }
  }

  const afterMutation = async (account: string, reload: () => Promise<void> = refresh) => {
    requireSameAccount(account)
    try {
      await reload()
    } catch (cause) {
      throw new TodoSavedRefreshError(cause)
    }
    requireSameAccount(account)
    void badgeStore.refreshSilently()
  }

  const refreshReminders = () => {
    const account = requireAccount()
    if (reminderRequest && reminderAccount === account) return reminderRequest
    const request = ++reminderGeneration
    reminderAccount = account
    loadingReminders.value = true
    reminderError.value = ''
    const pending = getTodoReminders()
      .then((result) => {
        if (uid() !== account || request !== reminderGeneration) return []
        reminders.value = result
        return result
      })
      .catch((cause: unknown) => {
        if (uid() === account && request === reminderGeneration) {
          reminderError.value = message(cause)
          throw cause
        }
        return []
      })
      .finally(() => {
        if (reminderRequest === pending) reminderRequest = null
        if (uid() === account && request === reminderGeneration) loadingReminders.value = false
      })
    reminderRequest = pending
    return pending
  }

  const receiveReminders = async (payload: unknown) => {
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('ids' in payload) ||
      !Array.isArray(payload.ids) ||
      payload.ids.some((id: unknown) => typeof id !== 'string')
    ) {
      throw new Error('提醒事件格式无效')
    }
    const account = requireAccount()
    const ids = new Set<string>(payload.ids)
    const available = await refreshReminders()
    if (uid() !== account) return []
    const fresh = available.filter((reminder) => ids.has(reminder.id) && !notifiedReminderIds.has(reminder.id))
    for (const reminder of fresh) notifiedReminderIds.add(reminder.id)
    return fresh
  }

  const dismissReminder = async (id: string) => {
    const account = requireAccount()
    await dismissTodoReminder(id)
    reminderGeneration++
    reminderRequest = null
    await afterMutation(account, async () => {
      await refreshReminders()
    })
  }

  const add = async (title: string, dueAt: number | null, dateOnly = false) => {
    const account = requireAccount()
    const item = await createTodo({
      title,
      ...(dateOnly && dueAt !== null
        ? { dueDate: localTodoDay(new Date(dueAt)), dueTimeZone: localTodoTimeZone() }
        : { dueAt }),
      ...(view.value === 'list' ? { listId: listId.value } : {}),
      ...(view.value === 'important' ? { important: true } : {}),
      ...(view.value === 'day' ? { myDay: today.value } : {})
    })
    await afterMutation(account)
    return item
  }

  const update = async (item: TodoItem, patch: Omit<Parameters<typeof updateTodo>[0], 'id' | 'expectedVersion'>) => {
    const account = requireAccount()
    const updated = await updateTodo({ id: item.id, expectedVersion: item.version, ...patch })
    requireSameAccount(account)
    if (selectedId.value === item.id) selectedItem.value = updated
    await afterMutation(account)
    return updated
  }

  const remove = async (item: TodoItem) => {
    const account = requireAccount()
    await deleteTodo(item.id, item.version)
    requireSameAccount(account)
    if (selectedId.value === item.id) {
      selectedId.value = null
      selectedItem.value = null
      steps.value = []
      attachments.value = []
      stepGeneration++
      loadingSteps.value = false
    }
    await afterMutation(account)
  }

  const setDay = async (item: TodoItem, day: string | null) => {
    const account = requireAccount()
    await setTodoDay(item.id, day)
    await afterMutation(account)
  }

  const addList = async (name: string) => {
    const account = requireAccount()
    const list = await createTodoList(name)
    await afterMutation(account, () => selectView('list', list.id))
  }

  const renameList = async (list: TodoList, name: string) => {
    const account = requireAccount()
    await updateTodoList({ id: list.id, name })
    await afterMutation(account)
  }

  const removeList = async (list: TodoList) => {
    const account = requireAccount()
    await deleteTodoList(list.id)
    requireSameAccount(account)
    if (listId.value === list.id) await afterMutation(account, () => selectView('tasks'))
    else await afterMutation(account)
  }

  const reorderLists = async (ids: string[]) => {
    const account = requireAccount()
    await reorderTodoLists(ids)
    await afterMutation(account)
  }

  const addStep = async (item: TodoItem, title: string) => {
    const account = requireAccount()
    await createTodoStep(item.id, title)
    await afterMutation(account, () => (selectedId.value === item.id ? selectTask(item) : Promise.resolve()))
  }

  const updateStep = async (step: TodoStep, patch: { done?: boolean; title?: string; position?: number }) => {
    const account = requireAccount()
    await updateTodoStep({ id: step.id, todoId: step.todoId, expectedVersion: step.version, ...patch })
    await afterMutation(account, () =>
      selected.value?.id === step.todoId ? selectTask(selected.value) : Promise.resolve()
    )
  }

  const removeStep = async (step: TodoStep) => {
    const account = requireAccount()
    await deleteTodoStep(step.todoId, step.id, step.version)
    await afterMutation(account, () =>
      selected.value?.id === step.todoId ? selectTask(selected.value) : Promise.resolve()
    )
  }

  const addAttachment = async (item: TodoItem, driveItemId: string) => {
    const account = requireAccount()
    await createTodoAttachment(item.id, driveItemId)
    await afterMutation(account, () => (selectedId.value === item.id ? selectTask(item) : Promise.resolve()))
  }

  const removeAttachment = async (attachment: TodoAttachment) => {
    const account = requireAccount()
    await deleteTodoAttachment(attachment.todoId, attachment.id)
    await afterMutation(account, () =>
      selected.value?.id === attachment.todoId ? selectTask(selected.value) : Promise.resolve()
    )
  }

  return {
    view,
    listId,
    search,
    sort,
    today,
    items,
    lists,
    steps,
    attachments,
    reminders,
    selected,
    cursor,
    hasMore,
    loading,
    loadingMore,
    loadingSteps,
    error,
    stepError,
    reminderError,
    loadingReminders,
    refresh,
    loadMore,
    selectView,
    setSearch,
    setSort,
    selectTask,
    add,
    update,
    remove,
    setDay,
    addList,
    renameList,
    removeList,
    reorderLists,
    addStep,
    updateStep,
    removeStep,
    addAttachment,
    removeAttachment,
    refreshReminders,
    receiveReminders,
    dismissReminder,
    clear
  }
})
