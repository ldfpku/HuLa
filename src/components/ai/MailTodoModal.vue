<template>
  <n-modal v-model:show="visible" :mask-closable="!saving" :close-on-esc="!saving" class="rounded-8px w-480px">
    <div
      class="bg-[--bg-popover] w-480px box-border p-[18px_22px] flex flex-col gap-14px text-[--text-color] max-h-[calc(100vh-4rem)] overflow-y-auto">
      <div class="flex items-center justify-between">
        <span class="text-15px font-600">邮件转待办</span>
        <svg class="size-12px cursor-pointer select-none" @click="!saving && (visible = false)">
          <title>{{ t('tooltip.close') }}</title>
          <use href="#close"></use>
        </svg>
      </div>
      <p class="text-12px text-[--chat-text-color] truncate" :title="subject">邮件：{{ subject || '(无主题)' }}</p>
      <p class="text-12px text-[--chat-text-color] leading-5">
        可以手动填写；使用 AI 会将邮件内容发送给 AI 服务，可能消耗额度或产生费用。
      </p>

      <div v-if="drafting" class="flex flex-col items-center gap-10px py-28px text-13px text-[--chat-text-color]">
        <n-spin size="small" />
        <span>AI 正在根据邮件生成待办…</span>
      </div>
      <template v-else>
        <p v-if="draftError" class="text-12px color-#d03553">{{ draftError }}，可以直接手动填写。</p>
        <n-form label-placement="left" label-width="72" :show-feedback="false" class="flex flex-col gap-12px">
          <n-form-item label="待办">
            <n-input v-model:value="title" :maxlength="100" placeholder="要做的事" clearable :disabled="saving" />
          </n-form-item>
          <n-form-item label="截止时间">
            <n-date-picker
              v-model:value="dueAt"
              type="datetime"
              format="yyyy-MM-dd HH:mm"
              clearable
              class="w-full"
              :disabled="saving" />
          </n-form-item>
          <n-form-item label="要点">
            <n-input
              v-model:value="notes"
              type="textarea"
              :maxlength="2000"
              :disabled="saving"
              :autosize="{ minRows: 3, maxRows: 8 }"
              placeholder="完成这件事需要知道的信息" />
          </n-form-item>
        </n-form>
        <n-flex justify="end" :size="10">
          <n-button size="small" secondary :disabled="saving" @click="generate">确认使用 AI 生成</n-button>
          <n-button size="small" secondary :disabled="saving" @click="visible = false">取消</n-button>
          <n-button
            size="small"
            color="#034fbc"
            text-color="#ffffff"
            :loading="saving"
            :disabled="!title.trim()"
            @click="save">
            保存到我的待办
          </n-button>
        </n-flex>
      </template>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { useTodoStore } from '@/stores/todo'
import { draftMailTodo } from '@/utils/ImRequestUtils'
import { TodoSavedRefreshError } from '@/utils/TodoMutationError'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

/** 邮件卡片或邮件里的“转待办”：AI 生成草稿，确认或修改后存到我的待办 */
const props = defineProps<{ shareId?: string; mailId?: string; subject?: string }>()
const visible = defineModel<boolean>('show', { default: false })

const todoStore = useTodoStore()
const drafting = ref(false)
const saving = ref(false)
const draftError = ref('')
const title = ref('')
const dueAt = ref<number | null>(null)
const notes = ref('')

const source = () => (props.shareId ? { shareId: props.shareId } : { mailId: props.mailId })

let requestVersion = 0
watch(visible, (show) => {
  requestVersion++
  if (!show) return
  title.value = `处理邮件：${props.subject || '(无主题)'}`.slice(0, 100)
  dueAt.value = null
  notes.value = ''
  draftError.value = ''
  drafting.value = false
})

const generate = async () => {
  if (drafting.value || saving.value) return
  const version = ++requestVersion
  draftError.value = ''
  drafting.value = true
  try {
    const draft = await draftMailTodo({ ...source(), confirmed: true })
    if (version !== requestVersion) return
    title.value = draft.title
    dueAt.value = draft.dueAt
    notes.value = draft.notes
  } catch (err) {
    if (version === requestVersion) draftError.value = (err as Error)?.message || 'AI 生成失败'
  } finally {
    if (version === requestVersion) drafting.value = false
  }
}

const save = async () => {
  if (saving.value) return
  saving.value = true
  try {
    await todoStore.add({ title: title.value.trim(), notes: notes.value, dueAt: dueAt.value, ...source() })
    window.$message?.success('已保存到我的待办')
    visible.value = false
  } catch (err) {
    if (err instanceof TodoSavedRefreshError) {
      console.warn('[MailTodo] 待办已保存但刷新失败:', err)
      visible.value = false
      window.$message?.warning(err.message)
    } else {
      console.error('[MailTodo] 保存待办失败:', err)
      window.$message?.error(err instanceof Error ? err.message : t('todo.error'))
    }
  } finally {
    saving.value = false
  }
}
</script>
