<template>
  <n-modal v-model:show="todoStore.visible" class="rounded-8px w-560px">
    <div
      class="bg-[--bg-popover] w-560px box-border p-[18px_22px] flex flex-col gap-12px text-[--text-color] h-[min(640px,calc(100vh-4rem))]">
      <div class="flex items-center justify-between">
        <span class="text-15px font-600">我的待办</span>
        <svg class="size-12px cursor-pointer select-none" @click="todoStore.visible = false">
          <use href="#close"></use>
        </svg>
      </div>

      <!-- 手动添加 -->
      <n-flex :size="8" :wrap="false" align="center">
        <n-input
          v-model:value="newTitle"
          :maxlength="100"
          placeholder="添加待办，回车保存"
          clearable
          class="flex-1"
          @keydown.enter.prevent="addNew" />
        <n-date-picker
          v-model:value="newDue"
          type="datetime"
          format="MM-dd HH:mm"
          clearable
          placeholder="截止时间"
          class="w-150px" />
        <n-button color="#034fbc" :disabled="!newTitle.trim()" :loading="adding" @click="addNew">添加</n-button>
      </n-flex>

      <n-tabs v-model:value="tab" type="line" size="small" animated>
        <n-tab name="open">未完成 {{ todoStore.openItems.length || '' }}</n-tab>
        <n-tab name="done">已完成</n-tab>
      </n-tabs>

      <n-scrollbar class="flex-1 min-h-0">
        <div v-if="todoStore.loading && !items.length" class="flex justify-center py-32px"><n-spin size="small" /></div>
        <p v-else-if="!items.length" class="text-13px text-[--chat-text-color] text-center py-32px">
          {{
            tab === 'open' ? '没有未完成的待办。在邮件或聊天里的邮件卡片上点“转待办”可以快速添加。' : '还没有完成的待办'
          }}
        </p>
        <div v-for="item in items" :key="item.id" class="todo-item flex gap-10px p-[10px_8px] rounded-8px">
          <n-checkbox :checked="item.done" class="pt-2px" @update:checked="(value: boolean) => toggle(item, value)" />
          <div class="flex-1 min-w-0 flex flex-col gap-4px">
            <template v-if="editingId === item.id">
              <n-input v-model:value="editTitle" size="small" :maxlength="100" />
              <n-date-picker v-model:value="editDue" size="small" type="datetime" format="yyyy-MM-dd HH:mm" clearable />
              <n-input
                v-model:value="editNotes"
                size="small"
                type="textarea"
                :maxlength="2000"
                :autosize="{ minRows: 2, maxRows: 6 }"
                placeholder="要点" />
              <n-flex justify="end" :size="8">
                <n-button size="tiny" secondary @click="editingId = ''">取消</n-button>
                <n-button size="tiny" color="#034fbc" :disabled="!editTitle.trim()" @click="saveEdit(item)">
                  保存
                </n-button>
              </n-flex>
            </template>
            <template v-else>
              <p class="text-14px leading-5 break-words" :class="{ 'line-through opacity-60': item.done }">
                {{ item.title }}
              </p>
              <p
                v-if="item.dueAt"
                class="text-12px"
                :class="!item.done && item.dueAt < now ? 'color-#d03553' : 'text-[--chat-text-color]'">
                截止 {{ formatDue(item.dueAt) }}
                <span v-if="!item.done && item.dueAt < now">（已过期）</span>
              </p>
              <p v-if="item.notes" class="text-12px text-[--chat-text-color] leading-5 whitespace-pre-wrap break-words">
                {{ item.notes }}
              </p>
              <p
                v-if="item.sourceType === 'mail'"
                class="text-12px color-#034fbc cursor-pointer truncate"
                :title="item.sourceTitle"
                @click="openSource(item)">
                来自邮件：{{ item.sourceTitle }}
              </p>
            </template>
          </div>
          <n-flex v-if="editingId !== item.id" :size="10" class="actions pt-2px" :wrap="false">
            <svg class="size-14px cursor-pointer" @click="startEdit(item)"><use href="#edit"></use></svg>
            <n-popconfirm @positive-click="todoStore.remove(item.id)">
              <template #trigger>
                <svg class="size-14px cursor-pointer"><use href="#delete"></use></svg>
              </template>
              删除这条待办？
            </n-popconfirm>
          </n-flex>
        </div>
      </n-scrollbar>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import type { TodoItem } from '@/services/types'
import { useMailStore } from '@/stores/mail'
import { useTodoStore } from '@/stores/todo'

const todoStore = useTodoStore()
const mailStore = useMailStore()
const tab = ref<'open' | 'done'>('open')
const newTitle = ref('')
const newDue = ref<number | null>(null)
const adding = ref(false)
const editingId = ref('')
const editTitle = ref('')
const editDue = ref<number | null>(null)
const editNotes = ref('')
const now = ref(Date.now())

const items = computed(() => (tab.value === 'open' ? todoStore.openItems : todoStore.doneItems))

const pad = (value: number) => String(value).padStart(2, '0')
const formatDue = (at: number) => {
  const date = new Date(at)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return `${sameYear ? '' : `${date.getFullYear()}-`}${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const addNew = async () => {
  const title = newTitle.value.trim()
  if (!title || adding.value) return
  adding.value = true
  try {
    await todoStore.add({ title, dueAt: newDue.value })
    newTitle.value = ''
    newDue.value = null
    tab.value = 'open'
  } finally {
    adding.value = false
  }
}

const toggle = (item: TodoItem, done: boolean) => todoStore.update({ id: item.id, done })

const startEdit = (item: TodoItem) => {
  editingId.value = item.id
  editTitle.value = item.title
  editDue.value = item.dueAt
  editNotes.value = item.notes
}

const saveEdit = async (item: TodoItem) => {
  await todoStore.update({ id: item.id, title: editTitle.value.trim(), dueAt: editDue.value, notes: editNotes.value })
  editingId.value = ''
}

const openSource = (item: TodoItem) => {
  if (!item.sourceId || !item.sourcePath) return
  mailStore
    .openMailMessage({ id: item.sourceId, path: item.sourcePath, subject: item.sourceTitle })
    .catch(() => window.$message?.error('打开邮件失败，请稍后重试'))
}

watch(
  () => todoStore.visible,
  (show) => {
    if (!show) return
    now.value = Date.now()
    editingId.value = ''
  }
)
</script>

<style scoped lang="scss">
.todo-item {
  .actions {
    opacity: 0;
    color: var(--icon-color, #666);
  }
  &:hover {
    background: var(--center-bg-color);
    .actions {
      opacity: 1;
    }
  }
}
</style>
