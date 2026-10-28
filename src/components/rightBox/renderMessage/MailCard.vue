<template>
  <main class="mail-card" :title="t('message.mail_card.open')" @click.stop="handleOpen">
    <n-flex align="center" :size="8" class="pb-8px">
      <svg class="size-16px color-[--link-color] shrink-0">
        <use href="#mail"></use>
      </svg>
      <p class="text-12px color-[--text-muted-color] truncate" :title="body?.mailbox">
        {{ body?.via === 'mailbox' ? t('message.mail_card.via_mailbox') : t('message.mail_card.label') }}
      </p>
      <p v-if="body?.attachmentCount" class="ml-auto text-11px color-[--text-muted-color]">
        {{ t('message.mail_card.attachments', { count: body.attachmentCount }) }}
      </p>
      <span
        v-if="body?.shareId"
        class="to-todo shrink-0 text-11px color-[--link-color]"
        :class="{ 'ml-auto': !body?.attachmentCount }"
        title="用 AI 把这封邮件转成我的待办"
        @click.stop="showTodo = true">
        转待办
      </span>
    </n-flex>

    <p class="text-14px font-medium color-[--text-color] leading-5 line-clamp-2 break-all">
      {{ body?.subject || t('message.mail_card.no_subject') }}
    </p>
    <p class="text-12px color-[--chat-text-color] pt-4px truncate">
      {{ sender }}
      <span v-if="dateText" class="pl-8px">{{ dateText }}</span>
    </p>
    <p
      v-if="body?.snippet"
      class="text-12px color-[--chat-text-color] pt-6px leading-5 line-clamp-3 break-all">
      {{ body.snippet }}
    </p>
  </main>
  <MailTodoModal v-if="body?.shareId" v-model:show="showTodo" :share-id="body.shareId" :subject="body.subject" />
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import MailTodoModal from '@/components/ai/MailTodoModal.vue'
import type { MailCardBody } from '@/services/types'
import { useMailStore } from '@/stores/mail'
import { formatTimestamp } from '@/utils/ComputedTime.ts'

defineOptions({
  inheritAttrs: false
})

const props = withDefaults(defineProps<{ body?: MailCardBody }>(), { body: undefined })

const { t } = useI18n()
const mailStore = useMailStore()
const showTodo = ref(false)

const sender = computed(() => {
  if (!props.body) return ''
  return props.body.fromName && props.body.fromName !== props.body.from
    ? `${props.body.fromName} <${props.body.from}>`
    : props.body.from
})

const dateText = computed(() => (props.body?.date ? formatTimestamp(props.body.date) : ''))

const handleOpen = async () => {
  if (!props.body?.url) return
  try {
    await mailStore.openMailShare(props.body)
  } catch (error) {
    console.error('[MailCard] 打开邮件失败:', error)
    window.$message?.error(t('message.mail_card.open_failed'))
  }
}
</script>

<style scoped lang="scss">
.to-todo {
  cursor: pointer;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--link-color);
  &:hover {
    background: var(--icon-hover-color);
  }
}

.mail-card {
  cursor: pointer;
  user-select: none;
  @apply w-280px flex flex-col h-fit bg-[--group-notice-bg]
  border-(1px solid [--line-color])
  hover:bg-[--list-hover-color] rounded-8px p-10px box-border
  custom-shadow transition-colors duration-200;
}
</style>
