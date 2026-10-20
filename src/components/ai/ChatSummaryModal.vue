<template>
  <n-modal v-model:show="visible" :mask-closable="!loading" class="rounded-8px w-520px">
    <div
      class="bg-[--bg-popover] w-520px box-border p-[18px_22px] flex flex-col gap-14px text-[--text-color] max-h-[calc(100vh-4rem)] overflow-y-auto">
      <div class="flex items-center justify-between">
        <span class="text-15px font-600">AI 摘要 · {{ roomName }}</span>
        <svg class="size-12px cursor-pointer select-none" @click="visible = false">
          <title>{{ t('tooltip.close') }}</title>
          <use href="#close"></use>
        </svg>
      </div>

      <n-radio-group :value="range" size="small" :disabled="loading" @update:value="selectRange">
        <n-radio-button v-if="unreadCount > 0" value="unread">未读 {{ unreadCount }} 条</n-radio-button>
        <n-radio-button value="50">最近 50 条</n-radio-button>
        <n-radio-button value="100">最近 100 条</n-radio-button>
        <n-radio-button value="300">最近 300 条</n-radio-button>
      </n-radio-group>

      <div v-if="loading" class="flex flex-col items-center gap-10px py-28px text-13px text-[--chat-text-color]">
        <n-spin size="small" />
        <span>正在用 AI 阅读聊天记录…</span>
      </div>
      <p v-else-if="error" class="text-13px color-#d03553 py-12px">{{ error }}</p>
      <template v-else-if="result">
        <div
          class="summary-text text-14px leading-6 whitespace-pre-wrap break-words rounded-8px p-12px bg-[--center-bg-color] select-text">
          {{ result.summary }}
        </div>
        <p class="text-12px text-[--chat-text-color] leading-5">
          根据 {{ result.messageCount }} 条消息生成
          <span v-if="rangeText">（{{ rangeText }}）</span>
          <span v-if="result.parts > 1">，分 {{ result.parts }} 段阅读后合并</span>
          <span v-if="result.dropped">，会话太长，较早的 {{ result.dropped }} 条未读取</span>
          。图片和文件只看文件名；摘要仅自己可见，不会发到会话里。
        </p>
        <n-flex justify="end" :size="10">
          <n-button size="small" secondary @click="copy">复制</n-button>
          <n-button size="small" color="#034fbc" @click="run">重新生成</n-button>
        </n-flex>
      </template>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import type { ChatSummaryResult } from '@/services/types'
import { useChatStore } from '@/stores/chat'
import { summarizeChat } from '@/utils/ImRequestUtils'
import { formatTimestamp } from '@/utils/ComputedTime.ts'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{ roomId: string; roomName?: string }>()
const visible = defineModel<boolean>('show', { default: false })

const chatStore = useChatStore()
const range = ref('100')
const loading = ref(false)
const error = ref('')
const result = ref<ChatSummaryResult | null>(null)

/** 打开会话前的未读条数，打开会话后服务端已记为已读，所以由客户端记下 */
const unreadCount = computed(() => chatStore.unreadSnapshot[props.roomId] ?? 0)

const rangeText = computed(() => {
  if (!result.value?.firstAt || !result.value.lastAt) return ''
  const first = formatTimestamp(result.value.firstAt)
  const last = formatTimestamp(result.value.lastAt)
  return first === last ? first : `${first} 至 ${last}`
})

const run = async () => {
  if (!props.roomId || loading.value) return
  loading.value = true
  error.value = ''
  try {
    const count = range.value === 'unread' ? unreadCount.value : Number(range.value)
    result.value = await summarizeChat({ roomId: props.roomId, count })
  } catch (err) {
    result.value = null
    error.value = (err as Error)?.message || '摘要生成失败，请稍后再试'
  } finally {
    loading.value = false
  }
}

const selectRange = (value: string) => {
  range.value = value
  run()
}

const copy = async () => {
  if (!result.value) return
  try {
    await navigator.clipboard.writeText(result.value.summary)
    window.$message?.success('已复制')
  } catch {
    window.$message?.error('复制失败')
  }
}

watch(visible, (show) => {
  if (!show) return
  result.value = null
  error.value = ''
  range.value = unreadCount.value > 0 ? 'unread' : '100'
  run()
})
</script>

<style scoped lang="scss">
.summary-text {
  border: 1px solid var(--line-color, #e3e3e3);
}
</style>
