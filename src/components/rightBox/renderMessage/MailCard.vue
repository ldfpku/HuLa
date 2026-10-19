<template>
  <main class="mail-card" :title="t('message.mail_card.open')" @click.stop="handleOpen">
    <n-flex align="center" :size="8" class="pb-8px">
      <svg class="size-16px color-#034fbc shrink-0">
        <use href="#mail"></use>
      </svg>
      <p class="text-12px color-[--text-color] opacity-70 truncate" :title="body?.mailbox">
        {{ body?.via === 'mailbox' ? t('message.mail_card.via_mailbox') : t('message.mail_card.label') }}
      </p>
      <p v-if="body?.attachmentCount" class="ml-auto text-11px color-[--text-color] opacity-70">
        {{ t('message.mail_card.attachments', { count: body.attachmentCount }) }}
      </p>
    </n-flex>

    <p class="text-14px font-medium color-[--text-color] leading-5 line-clamp-2 break-all">
      {{ body?.subject || t('message.mail_card.no_subject') }}
    </p>
    <p class="text-12px color-[--chat-text-color] pt-4px truncate">
      {{ sender }}<span v-if="dateText" class="pl-8px opacity-70">{{ dateText }}</span>
    </p>
    <p v-if="body?.snippet" class="text-12px color-[--chat-text-color] opacity-80 pt-6px leading-5 line-clamp-3 break-all">
      {{ body.snippet }}
    </p>
  </main>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { MailCardBody } from '@/services/types'
import { useMailStore } from '@/stores/mail'
import { formatTimestamp } from '@/utils/ComputedTime.ts'

defineOptions({
  inheritAttrs: false
})

const props = withDefaults(defineProps<{ body?: MailCardBody }>(), { body: undefined })

const { t } = useI18n()
const mailStore = useMailStore()

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
.mail-card {
  cursor: pointer;
  user-select: none;
  @apply: w-280px flex flex-col h-fit bg-[--group-notice-bg]
  border-(1px solid #e3e3e3) dark:border-(1px solid #404040)
  hover:bg-#fefefe99 dark:hover:bg-#60606040 rounded-8px p-10px box-border
  custom-shadow transition-colors duration-200;
}
</style>
