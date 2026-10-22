import { defineStore } from 'pinia'
import { ImUrlEnum, StoresEnum } from '@/enums'
import type { TodoItem } from '@/services/types'
import { createTodo, deleteTodo, getTodoList, imRequestSilent, updateTodo } from '@/utils/ImRequestUtils'

/**
 * 我的待办：服务端 im_todos 里自己的待办。邮件“转为待办”和手动添加都存到这里；
 * 列表在左侧栏“待办”打开的弹窗里查看、勾选完成。
 */
export const useTodoStore = defineStore(StoresEnum.TODO, () => {
  const visible = ref(false)
  const loading = ref(false)
  const openItems = ref<TodoItem[]>([])
  const doneItems = ref<TodoItem[]>([])
  const now = ref(Date.now())

  /** 已过期或今天到期的未完成待办数，显示在左侧栏角标上 */
  const dueCount = computed(() => {
    const end = new Date(now.value)
    end.setHours(23, 59, 59, 999)
    return openItems.value.filter((item) => item.dueAt !== null && item.dueAt <= end.getTime()).length
  })

  const refresh = async () => {
    loading.value = true
    try {
      const [open, done] = await Promise.all([getTodoList('open'), getTodoList('done')])
      openItems.value = open ?? []
      doneItems.value = done ?? []
      now.value = Date.now()
    } finally {
      loading.value = false
    }
  }

  /** 启动时刷新角标用，失败不提示 */
  const refreshSilently = async () => {
    const open = await imRequestSilent<TodoItem[]>({ url: ImUrlEnum.TODO_LIST, params: { status: 'open' } })
    if (open) {
      openItems.value = open
      now.value = Date.now()
    }
  }

  const open = async () => {
    visible.value = true
    await refresh()
  }

  const add = async (input: Parameters<typeof createTodo>[0]) => {
    const item = await createTodo(input)
    await refresh()
    return item
  }

  const update = async (input: Parameters<typeof updateTodo>[0]) => {
    const item = await updateTodo(input)
    await refresh()
    return item
  }

  const remove = async (id: string) => {
    await deleteTodo(id)
    await refresh()
  }

  return { visible, loading, openItems, doneItems, dueCount, refresh, refreshSilently, open, add, update, remove }
})
