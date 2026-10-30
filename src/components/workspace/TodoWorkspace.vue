<template>
  <section class="todo-workspace flex flex-1 min-w-0 min-h-0 flex-col bg-[--right-bg-color] text-[--text-color]">
    <ActionBar current-label="home">
      <span class="text-12px">{{ t('todo.title') }}</span>
    </ActionBar>
    <div ref="bodyElement" class="todo-body flex flex-1 min-h-0 min-w-0" :class="{ 'has-detail': !!store.selected }">
      <nav class="todo-nav flex flex-col gap-4px w-190px shrink-0 border-r border-[--line-color] p-12px">
        <button
          v-for="entry in smartViews"
          :key="entry.view"
          type="button"
          class="todo-nav-button"
          :class="{ selected: store.view === entry.view && !store.search }"
          @click="changeView(entry.view)">
          {{ t(entry.label) }}
        </button>
        <button type="button" class="todo-nav-button" @click="openReminders">
          {{ t('todo.reminders') }}
          <span v-if="store.reminders.length">({{ store.reminders.length }})</span>
        </button>
        <div class="mt-16px flex items-center justify-between text-12px text-[--chat-text-color]">
          <span>{{ t('todo.lists') }}</span>
          <button
            type="button"
            class="todo-icon"
            :title="t('todo.newList')"
            :aria-label="t('todo.newList')"
            @click="openListEditor()">
            +
          </button>
        </div>
        <n-scrollbar class="min-h-0 flex-1">
          <div v-for="(list, index) in store.lists" :key="list.id" class="todo-list-row flex items-center">
            <button
              type="button"
              class="todo-nav-button flex-1 min-w-0 truncate"
              :class="{ selected: store.view === 'list' && store.listId === list.id && !store.search }"
              @click="changeView('list', list.id)">
              {{ list.name }}
            </button>
            <n-dropdown
              :options="listMenu(index)"
              trigger="click"
              @select="(key: string) => onListMenu(key, list, index)">
              <button type="button" class="todo-icon" :aria-label="list.name">⋯</button>
            </n-dropdown>
          </div>
        </n-scrollbar>
      </nav>

      <main class="flex flex-1 min-w-0 min-h-0 flex-col p-20px">
        <div class="todo-main-header flex items-center justify-between gap-12px">
          <h1 class="text-22px font-600 truncate">{{ heading }}</h1>
          <div class="flex items-center gap-8px">
            <n-select
              :value="store.sort"
              :options="sortOptions"
              class="w-150px"
              size="small"
              @update:value="changeSort" />
            <n-button
              quaternary
              size="small"
              :title="t('todo.refresh')"
              :aria-label="t('todo.refresh')"
              @click="guard(() => runRead(() => store.refresh()))">
              ↻
            </n-button>
          </div>
        </div>
        <n-input
          v-model:value="searchInput"
          :disabled="detailDirty"
          clearable
          :maxlength="100"
          class="mt-14px"
          :placeholder="t('todo.search')"
          @update:value="onSearch" />
        <div v-if="store.view !== 'assigned' && !store.search" class="mt-14px">
          <div class="flex items-center gap-8px">
            <n-input
              v-model:value="newTitle"
              :maxlength="100"
              :placeholder="t('todo.addPlaceholder')"
              class="min-w-0 flex-1"
              @keydown.enter.prevent="addTask" />
            <n-button type="primary" class="shrink-0" :disabled="!newTitle.trim() || busy" @click="addTask">
              {{ t('todo.add') }}
            </n-button>
          </div>
          <div class="flex flex-wrap items-center gap-8px mt-8px">
            <n-date-picker
              v-model:value="newDue"
              :type="newDateOnly ? 'date' : 'datetime'"
              clearable
              :placeholder="t('todo.due')"
              class="todo-add-date" />
            <n-checkbox v-model:checked="newDateOnly" class="shrink-0 whitespace-nowrap">
              {{ t('todo.dateOnly') }}
            </n-checkbox>
          </div>
        </div>
        <div v-if="store.error" role="alert" class="mt-12px color-#c53030 text-12px">
          {{ store.error }}
          <button type="button" class="underline ml-8px" @click="guard(() => runRead(() => store.refresh()))">
            {{ t('todo.retry') }}
          </button>
        </div>
        <n-scrollbar class="flex-1 min-h-0 mt-12px">
          <div v-if="store.loading && !store.items.length" class="text-center p-30px">{{ t('todo.loading') }}</div>
          <div v-else-if="!store.items.length" class="text-center p-30px text-[--chat-text-color]">
            {{ t('todo.empty') }}
          </div>
          <template v-else>
            <div
              v-for="item in openItems"
              :key="item.id"
              class="todo-task"
              :class="{ selected: store.selected?.id === item.id }">
              <n-checkbox
                :checked="item.done"
                :aria-label="t('todo.done')"
                @update:checked="(checked: boolean) => toggleTask(item, checked)" />
              <button type="button" class="flex-1 min-w-0 text-left" @click="openTask(item)">
                <span class="block truncate">{{ item.title }}</span>
                <span v-if="item.dueAt" class="text-12px text-[--chat-text-color]">
                  {{ item.dueDate || formatDue(item.dueAt) }}
                </span>
              </button>
              <button
                v-if="isOwner(item)"
                type="button"
                class="todo-icon text-18px"
                :aria-label="t(item.important ? 'todo.unstar' : 'todo.star')"
                @click="toggleImportant(item)">
                {{ item.important ? '★' : '☆' }}
              </button>
            </div>
            <details v-if="doneItems.length" class="mt-12px">
              <summary class="cursor-pointer text-13px">{{ t('todo.completed') }} ({{ doneItems.length }})</summary>
              <div
                v-for="item in doneItems"
                :key="item.id"
                class="todo-task"
                :class="{ selected: store.selected?.id === item.id }">
                <n-checkbox
                  :checked="true"
                  :aria-label="t('todo.reopen')"
                  @update:checked="(checked: boolean) => toggleTask(item, checked)" />
                <button
                  type="button"
                  class="flex-1 min-w-0 text-left line-through opacity-60 truncate"
                  @click="openTask(item)">
                  {{ item.title }}
                </button>
              </div>
            </details>
          </template>
          <n-button
            v-if="store.hasMore"
            block
            secondary
            class="mt-12px"
            :loading="store.loadingMore"
            @click="runRead(() => store.loadMore())">
            {{ t('todo.loadMore') }}
          </n-button>
        </n-scrollbar>
      </main>

      <aside
        v-if="store.selected"
        class="todo-detail flex flex-col min-h-0 w-310px shrink-0 border-l border-[--line-color] p-16px">
        <div class="flex items-center justify-between">
          <h2 class="font-600">{{ t('todo.details') }}</h2>
          <button
            ref="detailCloseButton"
            type="button"
            class="todo-icon"
            :aria-label="t('todo.closeDetails')"
            @click="closeTask">
            ×
          </button>
        </div>
        <n-scrollbar class="flex-1 min-h-0 mt-12px">
          <label class="text-12px">{{ t('todo.titleLabel') }}</label>
          <n-input
            v-model:value="editTitle"
            :maxlength="100"
            :disabled="busy || store.loading || !isOwner(store.selected)" />
          <label class="block text-12px mt-12px">{{ t('todo.due') }}</label>
          <n-date-picker
            v-model:value="editDue"
            :type="editDateOnly ? 'date' : 'datetime'"
            clearable
            class="w-full"
            :disabled="busy || store.loading || !isOwner(store.selected)" />
          <n-checkbox v-model:checked="editDateOnly" :disabled="busy || store.loading || !isOwner(store.selected)">
            {{ t('todo.dateOnly') }}
          </n-checkbox>
          <label class="block text-12px mt-12px">{{ t('todo.remindAt') }}</label>
          <n-date-picker
            v-model:value="editReminder"
            type="datetime"
            clearable
            class="w-full"
            :disabled="busy || store.loading || !isOwner(store.selected) || store.selected.done" />
          <label class="block text-12px mt-12px">{{ t('todo.repeat') }}</label>
          <n-select
            v-model:value="editRepeat"
            :options="repeatOptions"
            :disabled="busy || store.loading || !isOwner(store.selected) || store.selected.done" />
          <label class="block text-12px mt-12px">{{ t('todo.notes') }}</label>
          <n-input
            v-model:value="editNotes"
            type="textarea"
            :maxlength="2000"
            :autosize="{ minRows: 3, maxRows: 8 }"
            :disabled="busy || store.loading || !isOwner(store.selected)" />
          <div v-if="isOwner(store.selected)" class="flex justify-end gap-8px mt-8px">
            <n-button size="small" :disabled="!detailDirty || busy || store.loading" @click="resetEditor">
              {{ t('todo.cancel') }}
            </n-button>
            <n-button
              size="small"
              type="primary"
              :disabled="!detailDirty || !editTitle.trim() || busy || store.loading"
              @click="saveDetails">
              {{ t('todo.save') }}
            </n-button>
          </div>

          <div class="mt-18px font-600 text-13px">{{ t('todo.steps') }}</div>
          <div v-if="store.stepError" role="alert" class="color-#c53030 text-12px">{{ store.stepError }}</div>
          <div v-if="store.loadingSteps" class="text-12px">{{ t('todo.loading') }}</div>
          <div v-for="step in store.steps" :key="step.id" class="flex items-center gap-8px mt-8px">
            <n-checkbox :checked="step.done" @update:checked="(done: boolean) => updateStep(step, done)" />
            <span class="flex-1 break-words" :class="{ 'line-through opacity-60': step.done }">{{ step.title }}</span>
            <button
              v-if="isOwner(store.selected)"
              type="button"
              class="todo-icon"
              :aria-label="t('todo.removeStep')"
              @click="run(() => store.removeStep(step))">
              ×
            </button>
          </div>
          <div v-if="isOwner(store.selected)" class="flex gap-8px mt-8px">
            <n-input
              v-model:value="newStep"
              size="small"
              :maxlength="100"
              :placeholder="t('todo.addStep')"
              @keydown.enter.prevent="addStep" />
            <n-button size="small" :disabled="!newStep.trim() || busy" @click="addStep">+</n-button>
          </div>

          <div class="mt-18px font-600 text-13px">{{ t('todo.attachments') }}</div>
          <div v-for="attachment in store.attachments" :key="attachment.id" class="flex items-center gap-8px mt-8px">
            <button
              v-if="attachment.available && attachment.path && attachment.name"
              type="button"
              class="flex-1 min-w-0 truncate text-left color-#034fbc underline"
              @click="openAttachment(attachment)">
              {{ attachment.name }}
            </button>
            <span v-else class="flex-1 text-12px text-[--chat-text-color]">{{ t('todo.attachmentUnavailable') }}</span>
            <button
              v-if="isOwner(store.selected)"
              type="button"
              class="todo-icon"
              :aria-label="t('todo.removeAttachment')"
              @click="run(() => store.removeAttachment(attachment))">
              ×
            </button>
          </div>
          <template v-if="isOwner(store.selected)">
            <p class="mt-8px text-12px text-[--chat-text-color]">{{ t('todo.attachmentHelp') }}</p>
            <div class="flex gap-8px mt-8px">
              <n-button size="small" @click="openAttachmentPicker">{{ t('todo.attach') }}</n-button>
              <n-button size="small" text @click="openDrive">{{ t('todo.uploadToDrive') }}</n-button>
            </div>
          </template>

          <n-button block secondary class="mt-16px" @click="toggleDay">
            {{ t(store.selected.myDay === store.today ? 'todo.removeDay' : 'todo.addDay') }}
          </n-button>
          <template v-if="isOwner(store.selected)">
            <label class="block text-12px mt-12px">{{ t('todo.moveTo') }}</label>
            <n-select :value="store.selected.listId ?? ''" :options="listOptions" @update:value="moveTask" />
            <label class="block text-12px mt-12px">{{ t('todo.assignee') }}</label>
            <div class="flex gap-8px">
              <n-select
                v-model:value="assignee"
                filterable
                remote
                clearable
                :options="peopleOptions"
                :loading="searchingPeople"
                :placeholder="t('todo.searchPeople')"
                @search="searchPeople" />
              <n-button :disabled="busy || assignee === store.selected.assigneeId" @click="changeAssignee">
                {{ t(assignee ? 'todo.assign' : 'todo.unassign') }}
              </n-button>
            </div>
          </template>
          <p v-else class="mt-16px text-12px text-[--chat-text-color]">{{ t('todo.assignee') }}</p>
          <button
            v-if="store.selected.sourcePath && store.selected.sourceId"
            type="button"
            class="mt-16px color-#034fbc underline text-left"
            @click="openSource">
            {{ t('todo.source') }}
          </button>
          <p v-else-if="store.selected.sourceType === 'mail'" class="mt-16px text-12px text-[--chat-text-color]">
            {{ t('todo.sourceUnavailable') }}
          </p>
          <n-popconfirm v-if="isOwner(store.selected)" @positive-click="deleteTask">
            <template #trigger>
              <n-button block tertiary type="error" class="mt-16px">{{ t('todo.deleteTask') }}</n-button>
            </template>
            {{ t('todo.deleteTaskConfirm') }}
          </n-popconfirm>
        </n-scrollbar>
      </aside>
    </div>

    <n-modal
      v-model:show="listEditorVisible"
      preset="dialog"
      :title="t(editingList ? 'todo.renameList' : 'todo.newList')">
      <n-input
        v-model:value="listName"
        :maxlength="100"
        :placeholder="t('todo.listName')"
        @keydown.enter.prevent="saveList" />
      <template #action>
        <n-button @click="listEditorVisible = false">{{ t('todo.cancel') }}</n-button>
        <n-button type="primary" :disabled="!listName.trim() || busy" @click="saveList">{{ t('todo.save') }}</n-button>
      </template>
    </n-modal>
    <n-modal v-model:show="remindersVisible" preset="dialog" :title="t('todo.reminders')">
      <p v-if="store.reminderError" role="alert" class="color-#c53030">{{ store.reminderError }}</p>
      <p v-else-if="store.loadingReminders">{{ t('todo.loading') }}</p>
      <p v-else-if="!store.reminders.length">{{ t('todo.noReminders') }}</p>
      <div v-for="reminder in store.reminders" :key="reminder.id" class="flex items-center gap-8px py-8px">
        <div class="flex-1 min-w-0">
          <p class="break-words">{{ reminder.title }}</p>
          <p class="text-12px text-[--chat-text-color]">{{ formatDue(reminder.scheduledAt) }}</p>
        </div>
        <n-button size="small" :disabled="busy" @click="run(() => store.dismissReminder(reminder.id))">
          {{ t('todo.dismissReminder') }}
        </n-button>
      </div>
      <template #action>
        <n-button @click="remindersVisible = false">{{ t('todo.cancel') }}</n-button>
      </template>
    </n-modal>
    <DrivePickerModal v-model:show="attachmentPickerVisible" attach @selected="attachSelected" />
  </section>
</template>

<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import ActionBar from '@/components/windows/ActionBar.vue'
import DrivePickerModal from '@/components/rightBox/chatBox/DrivePickerModal.vue'
import type {
  TodoAttachment,
  TodoItem,
  TodoList,
  TodoRepeatKind,
  TodoSort,
  TodoStep,
  TodoView,
  UserItem
} from '@/services/types'
import { useMailStore } from '@/stores/mail'
import { useTodoWorkspaceStore } from '@/stores/todoWorkspace'
import { useUserStore } from '@/stores/user'
import { searchTodoAssignees } from '@/utils/ImRequestUtils'
import { localTodoDateValue, localTodoDay, localTodoTimeZone, millisecondsUntilNextLocalDay } from '@/utils/TodoDate'
import { TodoSavedRefreshError } from '@/utils/TodoMutationError'

const props = defineProps<{ active: boolean }>()
const { t } = useI18n()
const store = useTodoWorkspaceStore()
const user = useUserStore()
const mail = useMailStore()
const bodyElement = ref<HTMLElement | null>(null)
const detailCloseButton = ref<HTMLButtonElement | null>(null)
let returnTaskFocus: HTMLElement | null = null
let lastMainFocus: HTMLElement | null = null
let bodyResizeObserver: ResizeObserver | undefined
const busy = ref(false)
const searchInput = ref('')
const newTitle = ref('')
const newDue = ref<number | null>(null)
const newDateOnly = ref(false)
const newStep = ref('')
const editTitle = ref('')
const editNotes = ref('')
const editDue = ref<number | null>(null)
const editDateOnly = ref(false)
const editReminder = ref<number | null>(null)
const editRepeat = ref<TodoRepeatKind | 'none'>('none')
const editVersion = ref(0)
const baseline = ref({
  title: '',
  notes: '',
  dueAt: null as number | null,
  dateOnly: false,
  remindAt: null as number | null,
  repeat: 'none' as TodoRepeatKind | 'none'
})
const listEditorVisible = ref(false)
const remindersVisible = ref(false)
const attachmentPickerVisible = ref(false)
const attachmentTaskId = ref<string | null>(null)
const editingList = ref<TodoList | null>(null)
const listName = ref('')
const assignee = ref<string | null>(null)
const people = ref<UserItem[]>([])
const searchingPeople = ref(false)
let peopleSequence = 0
let searchSequence = 0
let workspaceDisposed = false
let midnightTimer: ReturnType<typeof setTimeout> | undefined
let refreshTimer: ReturnType<typeof setInterval> | undefined

const smartViews: { view: TodoView; label: string }[] = [
  { view: 'day', label: 'todo.day' },
  { view: 'important', label: 'todo.important' },
  { view: 'planned', label: 'todo.planned' },
  { view: 'assigned', label: 'todo.assigned' },
  { view: 'tasks', label: 'todo.tasks' }
]
const heading = computed(() => {
  if (store.search) return t('todo.search')
  if (store.view === 'list') return store.lists.find((list) => list.id === store.listId)?.name ?? t('todo.lists')
  return t(smartViews.find((entry) => entry.view === store.view)?.label ?? 'todo.tasks')
})
const openItems = computed(() => store.items.filter((item) => !item.done))
const doneItems = computed(() => store.items.filter((item) => item.done))
const detailDirty = computed(
  () =>
    editTitle.value !== baseline.value.title ||
    editNotes.value !== baseline.value.notes ||
    editDue.value !== baseline.value.dueAt ||
    editDateOnly.value !== baseline.value.dateOnly ||
    editReminder.value !== baseline.value.remindAt ||
    editRepeat.value !== baseline.value.repeat
)
const repeatOptions = computed(() => [
  { label: t('todo.repeatNone'), value: 'none' },
  { label: t('todo.repeatDaily'), value: 'daily' },
  { label: t('todo.repeatWeekly'), value: 'weekly' },
  { label: t('todo.repeatMonthly'), value: 'monthly' },
  { label: t('todo.repeatYearly'), value: 'yearly' }
])
const sortOptions = computed(() => [
  { label: t('todo.sortCreated'), value: 'created' },
  { label: t('todo.sortDue'), value: 'due' },
  { label: t('todo.sortTitle'), value: 'title' }
])
const listOptions = computed(() => [
  { label: t('todo.tasks'), value: '' },
  ...store.lists.map((list) => ({ label: list.name, value: list.id }))
])
const peopleOptions = computed(() => {
  const found = people.value.map((person) => ({ label: person.name || person.account, value: person.uid }))
  const current = store.selected?.assigneeId
  if (current && !found.some((person) => person.value === current)) found.unshift({ label: current, value: current })
  return found
})
const isOwner = (item: TodoItem) => item.ownerId === user.userInfo?.uid
const formatDue = (at: number) => new Date(at).toLocaleString()

const run = async (operation: () => Promise<unknown>) => {
  if (busy.value) return
  busy.value = true
  try {
    await operation()
  } catch (error) {
    if (error instanceof TodoSavedRefreshError) {
      console.warn('待办已保存但刷新失败:', error)
      window.$message?.warning(error.message)
    } else {
      console.error('待办操作失败:', error)
      window.$message?.error(error instanceof Error ? error.message : t('todo.error'))
    }
  } finally {
    busy.value = false
  }
}

const resetAfterSavedMutation = async (operation: () => Promise<unknown>, reset: () => void) => {
  try {
    await operation()
  } catch (error) {
    if (error instanceof TodoSavedRefreshError) reset()
    throw error
  }
  reset()
}

const runRead = async (operation: () => Promise<unknown>) => {
  try {
    await operation()
  } catch (error) {
    console.error('待办读取失败:', error)
    window.$message?.error(error instanceof Error ? error.message : t('todo.error'))
  }
}

const accountStillCurrent = (account: string | undefined) => {
  if (!workspaceDisposed && account && account === user.userInfo?.uid) return true
  window.$message.warning(t('todo.accountChanged'))
  return false
}

const guard = (operation: () => void) => {
  if (!detailDirty.value) return operation()
  const account = user.userInfo?.uid
  window.$dialog.warning({
    title: t('todo.discardTitle'),
    content: t('todo.discardBody'),
    positiveText: t('todo.discard'),
    negativeText: t('todo.cancel'),
    onPositiveClick: () => {
      if (!accountStillCurrent(account)) return
      resetEditor()
      peopleSequence++
      operation()
    }
  })
}

const syncEditor = (item: TodoItem | null) => {
  baseline.value = {
    title: item?.title ?? '',
    notes: item?.notes ?? '',
    dueAt: item?.dueDate ? localTodoDateValue(item.dueDate) : (item?.dueAt ?? null),
    dateOnly: Boolean(item?.dueDate),
    remindAt: item?.remindAt ?? null,
    repeat: item?.repeat?.kind ?? 'none'
  }
  editVersion.value = item?.version ?? 0
  resetEditor()
  assignee.value = item?.assigneeId ?? null
  people.value = []
  newStep.value = ''
}
const resetEditor = () => {
  editTitle.value = baseline.value.title
  editNotes.value = baseline.value.notes
  editDue.value = baseline.value.dueAt
  editDateOnly.value = baseline.value.dateOnly
  editReminder.value = baseline.value.remindAt
  editRepeat.value = baseline.value.repeat
}

watch(
  () => store.selected?.id,
  () => syncEditor(store.selected),
  { immediate: true }
)
watch(
  () => store.selected?.version,
  () => {
    if (!detailDirty.value) syncEditor(store.selected)
  }
)

const changeView = (view: TodoView, listId: string | null = null) =>
  guard(() => {
    searchSequence++
    searchInput.value = ''
    void runRead(() => store.selectView(view, listId))
  })
const openTask = (item: TodoItem) =>
  guard(() => {
    returnTaskFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    void runRead(async () => {
      const request = store.selectTask(item)
      await nextTick()
      const main = bodyElement.value?.querySelector('main')
      if (main && getComputedStyle(main).display === 'none') detailCloseButton.value?.focus()
      await request
    })
  })
const closeTask = () =>
  guard(
    () =>
      void runRead(async () => {
        await store.selectTask(null)
        await nextTick()
        if (returnTaskFocus?.isConnected) returnTaskFocus.focus()
        else bodyElement.value?.querySelector<HTMLInputElement>('main input')?.focus()
        returnTaskFocus = null
      })
  )
const changeSort = (sort: TodoSort) => guard(() => void runRead(() => store.setSort(sort)))
const delayedSearch = useDebounceFn((value: string, sequence: number) => {
  if (sequence !== searchSequence) return
  if (detailDirty.value) {
    searchInput.value = store.search
    window.$message.warning(t('todo.detailsUnsaved'))
    return
  }
  void runRead(() => store.setSearch(value))
}, 300)
const onSearch = (value: string) => void delayedSearch(value, ++searchSequence)

const addTask = () =>
  guard(() => {
    const title = newTitle.value.trim()
    if (!title) return
    if (store.view === 'planned' && !newDue.value) {
      window.$message.warning(t('todo.dueRequired'))
      return
    }
    const rawTitle = newTitle.value
    const due = newDue.value
    const dateOnly = newDateOnly.value
    void run(async () => {
      await resetAfterSavedMutation(
        () => store.add(title, due, dateOnly),
        () => {
          if (newTitle.value !== rawTitle || newDue.value !== due || newDateOnly.value !== dateOnly) return
          newTitle.value = ''
          newDue.value = null
          newDateOnly.value = false
        }
      )
    })
  })

const toggleTask = (item: TodoItem, done: boolean) => guard(() => void run(() => store.update(item, { done })))
const toggleImportant = (item: TodoItem) =>
  guard(() => void run(() => store.update(item, { important: !item.important })))
const saveDetails = () => {
  const item = store.selected
  if (!item || !editTitle.value.trim()) return
  if (editRepeat.value !== 'none' && editDue.value === null) {
    window.$message.warning(t('todo.repeatNeedsDue'))
    return
  }
  void run(async () => {
    const deadlineChanged = editDue.value !== baseline.value.dueAt || editDateOnly.value !== baseline.value.dateOnly
    const dueTimeZone =
      editDateOnly.value && editDue.value !== null ? (deadlineChanged ? localTodoTimeZone() : item.dueTimeZone) : null
    const deadline = deadlineChanged
      ? editDateOnly.value && editDue.value !== null
        ? { dueAt: null, dueDate: localTodoDay(new Date(editDue.value)), dueTimeZone }
        : { dueAt: editDue.value, dueDate: null, dueTimeZone: null }
      : {}
    const repeat =
      editRepeat.value === baseline.value.repeat
        ? {}
        : {
            repeat:
              editRepeat.value === 'none'
                ? null
                : { kind: editRepeat.value, timeZone: dueTimeZone ?? localTodoTimeZone() }
          }
    try {
      const updated = await store.update(
        { ...item, version: editVersion.value },
        { title: editTitle.value.trim(), notes: editNotes.value, remindAt: editReminder.value, ...deadline, ...repeat }
      )
      syncEditor(updated)
    } catch (error) {
      if (error instanceof TodoSavedRefreshError && store.selected?.id === item.id) syncEditor(store.selected)
      throw error
    }
  })
}
const addStep = () => {
  const item = store.selected
  const title = newStep.value.trim()
  if (!item || !title) return
  const rawTitle = newStep.value
  void run(async () => {
    await resetAfterSavedMutation(
      () => store.addStep(item, title),
      () => {
        if (newStep.value === rawTitle) newStep.value = ''
      }
    )
  })
}
const updateStep = (step: TodoStep, done: boolean) => void run(() => store.updateStep(step, { done }))
const toggleDay = () => {
  const item = store.selected
  if (item) guard(() => void run(() => store.setDay(item, item.myDay === store.today ? null : store.today)))
}
const moveTask = (listId: string) => {
  const item = store.selected
  if (item) guard(() => void run(() => store.update(item, { listId: listId || null })))
}
const deleteTask = () => {
  const item = store.selected
  if (item) guard(() => void run(() => store.remove(item)))
}
const openSource = () => {
  const item = store.selected
  if (!item?.sourceId || !item.sourcePath) return
  const { sourceId, sourcePath, sourceTitle } = item
  void run(() => mail.openMailMessage({ id: sourceId, path: sourcePath, subject: sourceTitle }))
}
const openReminders = () => {
  remindersVisible.value = true
  void runRead(() => store.refreshReminders())
}
const openAttachmentPicker = () => {
  attachmentTaskId.value = store.selected?.id ?? null
  attachmentPickerVisible.value = true
}
const attachSelected = (driveItemId: string) => {
  const item = store.selected
  if (!item || item.id !== attachmentTaskId.value || !isOwner(item)) {
    window.$message.error(t('todo.error'))
    return
  }
  void run(() => store.addAttachment(item, driveItemId))
}
const openAttachment = (attachment: TodoAttachment) => {
  if (!attachment.path || !attachment.name) return
  const { id, path, name } = attachment
  void run(() => mail.openMailMessage({ id, path, subject: name }))
}
const openDrive = () => void run(() => mail.openMail('/drive'))

const listMenu = (index: number) => [
  { label: t('todo.renameList'), key: 'rename' },
  { label: t('todo.moveUp'), key: 'up', disabled: index === 0 },
  { label: t('todo.moveDown'), key: 'down', disabled: index === store.lists.length - 1 },
  { label: t('todo.deleteList'), key: 'delete' }
]
const openListEditor = (list: TodoList | null = null) =>
  guard(() => {
    editingList.value = list
    listName.value = list?.name ?? ''
    listEditorVisible.value = true
  })
const saveList = () => {
  const name = listName.value.trim()
  if (!name) return
  const originalName = listName.value
  const list = editingList.value
  void run(async () => {
    await resetAfterSavedMutation(
      () => (list ? store.renameList(list, name) : store.addList(name)),
      () => {
        if (editingList.value === list && listName.value === originalName) listEditorVisible.value = false
      }
    )
  })
}
const onListMenu = (key: string, list: TodoList, index: number) => {
  if (key === 'rename') return openListEditor(list)
  if (key === 'delete') {
    return guard(() => {
      const account = user.userInfo?.uid
      window.$dialog.warning({
        title: t('todo.deleteList'),
        content: t('todo.deleteListConfirm'),
        positiveText: t('todo.deleteList'),
        negativeText: t('todo.cancel'),
        onPositiveClick: () => {
          if (accountStillCurrent(account)) return run(() => store.removeList(list))
        }
      })
    })
  }
  const ids = store.lists.map((entry) => entry.id)
  const other = index + (key === 'up' ? -1 : 1)
  if (other < 0 || other >= ids.length) return
  ;[ids[index], ids[other]] = [ids[other], ids[index]]
  guard(() => void run(() => store.reorderLists(ids)))
}

const delayedPeopleSearch = useDebounceFn(async (key: string, sequence: number, account: string | undefined) => {
  if (!account || sequence !== peopleSequence || account !== user.userInfo?.uid) return
  if (!key.trim()) {
    people.value = []
    searchingPeople.value = false
    return
  }
  searchingPeople.value = true
  try {
    const result = await searchTodoAssignees(key.trim())
    if (sequence === peopleSequence && account === user.userInfo?.uid) people.value = result
  } catch (error) {
    if (sequence === peopleSequence && account === user.userInfo?.uid) {
      console.error('搜索负责人失败:', error)
      window.$message?.error(t('todo.error'))
    }
  } finally {
    if (sequence === peopleSequence) searchingPeople.value = false
  }
}, 300)
const searchPeople = (key: string) => void delayedPeopleSearch(key, ++peopleSequence, user.userInfo?.uid)

const changeAssignee = () => {
  const item = store.selected
  if (!item) return
  guard(() => {
    if (!assignee.value) return void run(() => store.update(item, { assigneeId: null }))
    const account = user.userInfo?.uid
    const assigneeId = assignee.value
    const selected = peopleOptions.value.find((person) => person.value === assigneeId)
    window.$dialog.warning({
      title: t('todo.shareTitle'),
      content: `${selected?.label ?? assigneeId}\n\n${t('todo.shareBody')}`,
      positiveText: t('todo.confirmShare'),
      negativeText: t('todo.cancel'),
      onPositiveClick: () => {
        if (!accountStillCurrent(account)) return
        if (store.selected?.id !== item.id) {
          window.$message.warning(t('todo.error'))
          return
        }
        return run(() => store.update(item, { assigneeId, confirmShare: true }))
      }
    })
  })
}

const syncDay = () => {
  const day = localTodoDay()
  if (day !== store.today) {
    store.today = day
    if (props.active && store.view === 'day' && !store.selected && user.userInfo?.uid)
      void runRead(() => store.refresh())
  }
  if (midnightTimer) clearTimeout(midnightTimer)
  midnightTimer = setTimeout(syncDay, millisecondsUntilNextLocalDay())
}
const refreshIdleWorkspace = (notify: boolean) => {
  if (
    !props.active ||
    document.hidden ||
    !user.userInfo?.uid ||
    busy.value ||
    store.selected ||
    store.loading ||
    store.loadingMore ||
    store.items.length > 50
  )
    return
  const refresh = () => store.refresh()
  if (notify) void runRead(refresh)
  else void refresh().catch((error) => console.error('自动刷新待办失败:', error))
}
const onVisibility = () => {
  if (!document.hidden) {
    syncDay()
    refreshIdleWorkspace(true)
  }
}
const onFocus = () => refreshIdleWorkspace(true)
const rememberMainFocus = (event: FocusEvent) => {
  const target = event.target
  const main = bodyElement.value?.querySelector('main')
  if (target instanceof HTMLElement && main?.contains(target)) lastMainFocus = target
  else if (target !== document.body) lastMainFocus = null
}
const focusVisibleDetail = () => {
  const main = bodyElement.value?.querySelector('main')
  if (!store.selected || !main || getComputedStyle(main).display !== 'none' || !lastMainFocus || !document.hasFocus())
    return
  if (document.activeElement === document.body || main.contains(document.activeElement)) {
    returnTaskFocus = lastMainFocus
    lastMainFocus = null
    detailCloseButton.value?.focus()
  }
}
watch(
  [() => props.active, () => user.userInfo?.uid],
  ([active, account]) => {
    if (active && account) {
      syncDay()
      if (!store.selected) void runRead(() => store.refresh())
      void runRead(() => store.refreshReminders())
    }
  },
  { immediate: true }
)
watch(
  () => user.userInfo?.uid,
  () => {
    peopleSequence++
    searchSequence++
    people.value = []
    searchingPeople.value = false
    searchInput.value = ''
    newTitle.value = ''
    newDue.value = null
    newDateOnly.value = false
    listEditorVisible.value = false
    editingList.value = null
    listName.value = ''
    attachmentPickerVisible.value = false
    attachmentTaskId.value = null
    remindersVisible.value = false
    returnTaskFocus = null
    lastMainFocus = null
    syncEditor(null)
  }
)
onMounted(() => {
  document.addEventListener('visibilitychange', onVisibility)
  document.addEventListener('focusin', rememberMainFocus)
  window.addEventListener('focus', onFocus)
  window.addEventListener('resize', focusVisibleDetail)
  if (typeof ResizeObserver !== 'undefined' && bodyElement.value) {
    bodyResizeObserver = new ResizeObserver(focusVisibleDetail)
    bodyResizeObserver.observe(bodyElement.value)
  }
  refreshTimer = setInterval(() => refreshIdleWorkspace(false), 30_000)
})
onBeforeUnmount(() => {
  workspaceDisposed = true
  returnTaskFocus = null
  lastMainFocus = null
  peopleSequence++
  searchSequence++
  if (midnightTimer) clearTimeout(midnightTimer)
  if (refreshTimer) clearInterval(refreshTimer)
  bodyResizeObserver?.disconnect()
  document.removeEventListener('visibilitychange', onVisibility)
  document.removeEventListener('focusin', rememberMainFocus)
  window.removeEventListener('focus', onFocus)
  window.removeEventListener('resize', focusVisibleDetail)
})
</script>

<style scoped lang="scss">
.todo-workspace {
  container-type: inline-size;
}
.todo-body {
  position: relative;
  overflow: hidden;
}
.todo-nav,
.todo-detail,
.todo-workspace main {
  box-sizing: border-box;
}
.todo-add-date {
  width: min(180px, 100%);
}
.todo-detail :deep(.n-select),
.todo-detail :deep(.n-input),
.todo-detail :deep(.n-date-picker) {
  min-width: 0;
  max-width: 100%;
}
.todo-detail p {
  overflow-wrap: anywhere;
}
.todo-nav-button {
  border: 0;
  border-radius: 6px;
  padding: 8px;
  text-align: left;
  background: transparent;
  color: inherit;
  cursor: pointer;
  &.selected,
  &:hover {
    background: var(--center-bg-color);
  }
}
.todo-icon {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 4px 8px;
}
.todo-task {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 7px;
  border-bottom: 1px solid var(--line-color);
  button {
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  &.selected,
  &:hover {
    background: var(--center-bg-color);
  }
}
@container (max-width: 1000px) {
  .todo-nav {
    width: 150px;
  }
  .todo-detail {
    width: 280px;
  }
}
@container (max-width: 760px) {
  .todo-body.has-detail > main {
    display: none;
  }
  .todo-detail {
    flex: 1 1 0;
    width: auto;
    min-width: 0;
  }
}
@container (max-width: 560px) {
  .todo-nav {
    width: 112px;
    padding: 8px;
  }
  .todo-main-header {
    flex-wrap: wrap;
    h1 {
      flex: 1 1 100%;
    }
  }
}
</style>
