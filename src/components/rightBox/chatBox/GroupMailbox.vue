<template>
  <div v-if="state" class="box-item cursor-default">
    <n-flex vertical :size="10">
      <div class="flex-between-center">
        <p class="text-(14px --text-color)">{{ t('home.chat_header.sidebar.group.mailbox.title') }}</p>
        <p v-if="state.address && !state.enabled" class="text-(12px [--text-muted-color])">
          {{ t('home.chat_header.sidebar.group.mailbox.off') }}
        </p>
      </div>

      <!-- 已有地址 -->
      <template v-if="state.address">
        <n-flex align="center" :size="8">
          <p class="flex-1 min-w-0 truncate text-(13px --text-color)" :class="{ 'opacity-50': !state.enabled }">
            {{ state.address }}
          </p>
          <n-tooltip v-if="state.enabled" trigger="hover">
            <template #trigger>
              <svg class="size-12px shrink-0 cursor-pointer hover:color-#909090" @click="handleCopy">
                <use href="#copy"></use>
              </svg>
            </template>
            <span>{{ t('home.chat_header.sidebar.group.mailbox.copy') }}</span>
          </n-tooltip>
        </n-flex>
        <p class="text-(12px [--text-muted-color]) leading-5">
          {{
            state.enabled
              ? t('home.chat_header.sidebar.group.mailbox.desc')
              : t('home.chat_header.sidebar.group.mailbox.disabled_hint')
          }}
        </p>
        <n-flex v-if="state.canManage" justify="end">
          <n-button v-if="state.enabled" size="small" secondary :loading="saving" @click="handleDisable">
            {{ t('home.chat_header.sidebar.group.mailbox.disable') }}
          </n-button>
          <n-button v-else size="small" color="#034fbc" text-color="#ffffff" :loading="saving" @click="handleEnable">
            {{ t('home.chat_header.sidebar.group.mailbox.enable') }}
          </n-button>
        </n-flex>
      </template>

      <!-- 还没有地址 -->
      <template v-else-if="state.canManage">
        <p class="text-(12px [--text-muted-color]) leading-5">{{ t('home.chat_header.sidebar.group.mailbox.desc') }}</p>
        <template v-if="state.domain">
          <n-input
            v-model:value="localPart"
            size="small"
            class="border-(solid 1px [--line-color])"
            :maxlength="64"
            spellCheck="false"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            :placeholder="t('home.chat_header.sidebar.group.mailbox.placeholder')">
            <template #suffix>
              <span class="text-(12px [--text-muted-color])">@{{ state.domain }}</span>
            </template>
          </n-input>
          <n-button size="small" color="#034fbc" text-color="#ffffff" :loading="saving" :disabled="!localPart.trim()" @click="handleEnable">
            {{ t('home.chat_header.sidebar.group.mailbox.create') }}
          </n-button>
        </template>
        <p v-else class="text-(12px [--text-muted-color]) leading-5">{{ t('home.chat_header.sidebar.group.mailbox.no_domain') }}</p>
      </template>

      <p v-else class="text-(12px [--text-muted-color]) leading-5">{{ t('home.chat_header.sidebar.group.mailbox.member_hint') }}</p>
    </n-flex>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { RoomMailboxState } from '@/services/types'
import { disableRoomMailbox, enableRoomMailbox, getRoomMailbox } from '@/utils/ImRequestUtils'

const props = defineProps<{ roomId: string }>()

const { t } = useI18n()
const state = ref<RoomMailboxState | null>(null)
const localPart = ref('')
const saving = ref(false)

const load = async (roomId: string) => {
  state.value = null
  if (!roomId) return
  try {
    const result = await getRoomMailbox(roomId)
    if (roomId !== props.roomId) return
    state.value = result
    localPart.value = result.suggestedLocalPart
  } catch (error) {
    console.error('[GroupMailbox] 获取群邮箱失败:', error)
  }
}

watch(() => props.roomId, load, { immediate: true })

const save = async (action: () => Promise<RoomMailboxState>) => {
  saving.value = true
  try {
    state.value = await action()
    return true
  } catch (error) {
    console.error('[GroupMailbox] 设置群邮箱失败:', error)
    return false
  } finally {
    saving.value = false
  }
}

const handleEnable = async () => {
  const ok = await save(() => enableRoomMailbox({ roomId: props.roomId, localPart: localPart.value.trim() }))
  if (ok) window.$message?.success(t('home.chat_header.sidebar.group.mailbox.enabled'))
}

const handleDisable = () => {
  window.$dialog.warning({
    title: t('home.chat_header.sidebar.group.mailbox.title'),
    content: t('home.chat_header.sidebar.group.mailbox.confirm_disable', { address: state.value?.address ?? '' }),
    positiveText: t('home.chat_header.sidebar.group.mailbox.disable'),
    negativeText: t('home.chat_header.modal.cancel'),
    onPositiveClick: () => save(() => disableRoomMailbox(props.roomId))
  })
}

const handleCopy = async () => {
  if (!state.value?.address) return
  await navigator.clipboard.writeText(state.value.address)
  window.$message?.success(t('home.chat_header.sidebar.group.mailbox.copied'))
}
</script>
